import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";

import type { DropPolicy } from "./backpressureQueue.ts";
import { BridgeCore } from "./bridgeCore.ts";
import type { BridgeMetrics } from "./metrics.ts";
import {
  parseRequestedClientId,
  resolveClientId,
} from "./reconnect.ts";
import type { BridgeEvent } from "./types.ts";

type ControlOpcode = 0x8 | 0x9 | 0xA;
type DataOpcode = 0x1;
type SupportedOpcode = ControlOpcode | DataOpcode;

interface DecodedFrame {
  readonly fin: boolean;
  readonly opcode: number;
  readonly payload: Buffer;
}

export interface WebSocketBridgeServerOptions {
  readonly host: string;
  readonly port: number;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTimeoutMs: number;
  readonly queueCapacity: number;
  readonly dropPolicy: DropPolicy;
}

const DEFAULT_OPTIONS: WebSocketBridgeServerOptions = {
  host: "127.0.0.1",
  port: 3000,
  heartbeatIntervalMs: 10_000,
  heartbeatTimeoutMs: 30_000,
  queueCapacity: 128,
  dropPolicy: "drop-oldest",
};

const WEBSOCKET_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

class RawWebSocketClient {
  private readBuffer = Buffer.alloc(0);
  private closed = false;
  private readonly closeHandlers: Array<() => void> = [];
  public readonly id: string;
  private readonly socket: Socket;
  public awaitingPong = false;
  public lastPingAt = 0;

  public constructor(id: string, socket: Socket) {
    this.id = id;
    this.socket = socket;
    this.socket.setNoDelay(true);
    this.socket.on("data", (chunk) => {
      this.handleData(chunk);
    });
    this.socket.on("error", () => {
      this.terminate();
    });
    this.socket.on("close", () => {
      this.closed = true;
      for (const handler of this.closeHandlers) {
        handler();
      }
    });
  }

  public onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  public send(payload: string): void {
    this.sendFrame(0x1, Buffer.from(payload, "utf8"));
  }

  public sendPing(now: number): void {
    this.awaitingPong = true;
    this.lastPingAt = now;
    this.sendFrame(0x9, Buffer.alloc(0));
  }

  public close(code = 1000, reason = ""): void {
    if (this.closed) {
      return;
    }

    const reasonBuffer = Buffer.from(reason, "utf8");
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    this.sendFrame(0x8, payload);
    this.socket.end();
    this.closed = true;
  }

  public terminate(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.socket.destroy();
  }

  private handleData(chunk: Buffer): void {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);

    for (;;) {
      const frame = this.tryReadFrame();
      if (!frame) {
        break;
      }

      this.handleFrame(frame);
    }
  }

  private handleFrame(frame: DecodedFrame): void {
    if (!frame.fin) {
      this.close(1002, "fragmented frames unsupported");
      return;
    }

    const opcode = frame.opcode as SupportedOpcode;

    switch (opcode) {
      case 0x1:
        return;
      case 0x8:
        this.close();
        return;
      case 0x9:
        this.sendFrame(0xA, frame.payload);
        return;
      case 0xA:
        this.awaitingPong = false;
        return;
      default:
        this.close(1002, "unsupported opcode");
    }
  }

  private tryReadFrame(): DecodedFrame | null {
    if (this.readBuffer.length < 2) {
      return null;
    }

    const firstByte = this.readBuffer[0];
    const secondByte = this.readBuffer[1];
    const fin = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (this.readBuffer.length < offset + 2) {
        return null;
      }
      payloadLength = this.readBuffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (this.readBuffer.length < offset + 8) {
        return null;
      }
      const length64 = this.readBuffer.readBigUInt64BE(offset);
      if (length64 > BigInt(Number.MAX_SAFE_INTEGER)) {
        this.close(1009, "payload too large");
        return null;
      }
      payloadLength = Number(length64);
      offset += 8;
    }

    if (!masked) {
      this.close(1002, "client frames must be masked");
      return null;
    }

    const frameSize = offset + 4 + payloadLength;
    if (this.readBuffer.length < frameSize) {
      return null;
    }

    const mask = this.readBuffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = this.readBuffer.subarray(offset, offset + payloadLength);
    const decodedPayload = Buffer.alloc(payloadLength);

    for (let index = 0; index < payloadLength; index += 1) {
      decodedPayload[index] = payload[index] ^ mask[index % 4];
    }

    this.readBuffer = this.readBuffer.subarray(frameSize);
    return {
      fin,
      opcode,
      payload: decodedPayload,
    };
  }

  private sendFrame(opcode: SupportedOpcode, payload: Buffer): void {
    if (this.closed) {
      return;
    }

    if (payload.length < 126) {
      const header = Buffer.from([0x80 | opcode, payload.length]);
      this.socket.write(Buffer.concat([header, payload]));
      return;
    }

    if (payload.length < 65536) {
      const header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
      this.socket.write(Buffer.concat([header, payload]));
      return;
    }

    const header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
    this.socket.write(Buffer.concat([header, payload]));
  }
}

export class WebSocketBridgeServer {
  private readonly options: WebSocketBridgeServerOptions;
  private readonly server: Server;
  private readonly bridgeCore: BridgeCore;
  private readonly clients = new Map<string, RawWebSocketClient>();
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private nextClientOrdinal = 1;
  private started = false;

  public constructor(options: Partial<WebSocketBridgeServerOptions> = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    this.bridgeCore = new BridgeCore({
      queueCapacity: this.options.queueCapacity,
      dropPolicy: this.options.dropPolicy,
      autoFlush: true,
    });

    this.server = createServer((request, response) => {
      this.handleHttpRequest(request, response);
    });
    this.server.on("upgrade", (request, socket) => {
      this.handleUpgrade(request, socket);
    });
  }

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off("error", onError);
        reject(error);
      };

      this.server.on("error", onError);
      this.server.listen(
        this.options.port,
        this.options.host,
        () => {
          this.server.off("error", onError);
          resolve();
        },
      );
    });

    this.started = true;
    this.startHeartbeat();
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    for (const [clientId, client] of this.clients) {
      client.close(1001, "server shutdown");
      this.removeClient(clientId);
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    this.started = false;
  }

  public publish(event: BridgeEvent): void {
    this.bridgeCore.publish(event);
  }

  public getMetrics(): BridgeMetrics {
    return this.bridgeCore.getMetrics();
  }

  public getPort(): number {
    const address = this.server.address();
    if (!address || typeof address === "string") {
      return this.options.port;
    }

    return address.port;
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();

      for (const [clientId, client] of this.clients) {
        const heartbeatLag = now - client.lastPingAt;

        if (client.awaitingPong && heartbeatLag >= this.options.heartbeatTimeoutMs) {
          client.terminate();
          this.removeClient(clientId);
          continue;
        }

        try {
          client.sendPing(now);
        } catch {
          client.terminate();
          this.removeClient(clientId);
        }
      }
    }, this.options.heartbeatIntervalMs);
  }

  private handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    if (request.method === "GET" && request.url === "/metrics") {
      const snapshot = this.getMetrics();
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(snapshot));
      return;
    }

    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "Not found" }));
  }

  private handleUpgrade(request: IncomingMessage, socket: Socket): void {
    if (!this.validateUpgradeRequest(request)) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const websocketKey = request.headers["sec-websocket-key"] as string;
    const acceptKey = createHash("sha1")
      .update(`${websocketKey}${WEBSOCKET_MAGIC_GUID}`)
      .digest("base64");

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
        "\r\n",
    );

    const requestedClientId = parseRequestedClientId(request.url);
    const activeClientIds = new Set(this.clients.keys());
    const { clientId, reconnect } = resolveClientId(
      requestedClientId,
      activeClientIds,
      () => this.generateClientId(),
    );

    if (reconnect) {
      const existingClient = this.clients.get(clientId);
      if (existingClient) {
        existingClient.close(1001, "reconnected");
        this.removeClient(clientId);
      }
    }

    const websocketClient = new RawWebSocketClient(clientId, socket);
    websocketClient.onClose(() => {
      this.removeClient(clientId);
    });

    this.clients.set(clientId, websocketClient);
    this.bridgeCore.addOrReplaceClient({
      id: clientId,
      send: (payload) => {
        websocketClient.send(payload);
      },
      close: (code, reason) => {
        websocketClient.close(code, reason);
      },
    });
  }

  private removeClient(clientId: string): void {
    this.clients.delete(clientId);
    this.bridgeCore.removeClient(clientId);
  }

  private validateUpgradeRequest(request: IncomingMessage): boolean {
    if (request.method !== "GET") {
      return false;
    }

    const upgrade = request.headers.upgrade;
    const websocketKey = request.headers["sec-websocket-key"];

    if (typeof upgrade !== "string" || upgrade.toLowerCase() !== "websocket") {
      return false;
    }

    if (typeof websocketKey !== "string" || websocketKey.length === 0) {
      return false;
    }

    return true;
  }

  private generateClientId(): string {
    const id = `client-${this.nextClientOrdinal}`;
    this.nextClientOrdinal += 1;
    return id;
  }
}
