import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";

import type { DropPolicy } from "./backpressureQueue.ts";
import {
  createActionPolicyPackManager,
  type ActionPolicyPackInput,
  type ActionPolicyPackManager,
} from "./actionPolicyEngine.ts";
import { BridgeCore } from "./bridgeCore.ts";
import type {
  BridgeIngestMode,
  BridgeIngestResult,
  BridgeIngestRoute,
} from "./ingestPipeline.ts";
import type { BridgeMetrics } from "./metrics.ts";
import {
  BridgeOperationalEventMetricsRegistry,
  type BridgeEventOperationalSnapshot,
} from "./operationalEventMetrics.ts";
import {
  createBridgeSecurityGuardrails,
  type BridgeSecurityGuardrails,
  type BridgeSecurityOptions,
  type SecurityAuditEvent,
} from "./securityGuardrails.ts";
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
  readonly security: BridgeSecurityOptions;
  readonly pluginIngestMaxBodyBytes: number;
  readonly ingestPluginPayload?: (
    payload: Record<string, unknown>,
  ) => BridgeIngestResult;
}

export interface BridgeOperationalMetrics
  extends BridgeMetrics,
    BridgeEventOperationalSnapshot {
  readonly bridge_authn_failures_total: number;
  readonly bridge_authz_denies_total: number;
  readonly bridge_redaction_applied_total: number;
  readonly bridge_redaction_failures_total: number;
  readonly bridge_action_gate_decisions_total: {
    readonly allow: number;
    readonly deny: number;
  };
  readonly bridge_action_receipts_total: {
    readonly accepted: number;
    readonly duplicate: number;
    readonly rejected: number;
  };
  readonly bridge_action_idempotency_replays_total: number;
  readonly bridge_policy_pack_state: {
    readonly active_pack_id: string;
    readonly active_pack_version: number;
    readonly history_depth: number;
  };
  readonly bridge_policy_pack_operations_total: {
    readonly validate: {
      readonly accepted: number;
      readonly rejected: number;
    };
    readonly apply: {
      readonly accepted: number;
      readonly rejected: number;
    };
    readonly rollback: {
      readonly accepted: number;
      readonly rejected: number;
    };
  };
}

interface RuntimeSecurityCredentials {
  activeToken: string;
  activeScopes: readonly string[];
  previousToken: string | null;
  previousScopes: readonly string[];
  previousTokenExpiresAtMs: number | null;
}

type ActionReceiptStatus = "accepted" | "duplicate" | "rejected";

interface ActionExecutionReceipt {
  readonly receiptId: string;
  readonly action: string;
  readonly status: ActionReceiptStatus;
  readonly allowed: boolean;
  readonly reason: string;
  readonly scope: string;
  readonly statusCode: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly requestHash: string;
  readonly createdAt: string;
  readonly lastAttemptAt: string;
  readonly attempts: number;
}

const DEFAULT_OPTIONS: WebSocketBridgeServerOptions = {
  host: "127.0.0.1",
  port: 3000,
  heartbeatIntervalMs: 10_000,
  heartbeatTimeoutMs: 30_000,
  queueCapacity: 128,
  dropPolicy: "drop-oldest",
  security: {},
  pluginIngestMaxBodyBytes: 256_000,
};

const DEFAULT_ROTATION_GRACE_MS = 30_000;
const MAX_ROTATION_GRACE_MS = 300_000;
const DEFAULT_SCOPE_SET = ["telemetry:read", "metrics:read"];

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
  private readonly security: BridgeSecurityGuardrails;
  private readonly actionPolicyManager: ActionPolicyPackManager;
  private readonly eventMetrics = new BridgeOperationalEventMetricsRegistry();
  private readonly securityMetrics = {
    authnFailuresTotal: 0,
    authzDeniesTotal: 0,
    redactionAppliedTotal: 0,
    redactionFailuresTotal: 0,
    actionGateAllowTotal: 0,
    actionGateDenyTotal: 0,
    actionReceiptAcceptedTotal: 0,
    actionReceiptDuplicateTotal: 0,
    actionReceiptRejectedTotal: 0,
    actionIdempotencyReplaysTotal: 0,
    policyValidateAcceptedTotal: 0,
    policyValidateRejectedTotal: 0,
    policyApplyAcceptedTotal: 0,
    policyApplyRejectedTotal: 0,
    policyRollbackAcceptedTotal: 0,
    policyRollbackRejectedTotal: 0,
  };
  private readonly actionReceiptsByKey = new Map<string, ActionExecutionReceipt>();
  private readonly clients = new Map<string, RawWebSocketClient>();
  private readonly runtimeSecurityCredentials: RuntimeSecurityCredentials;
  private readonly resolveFallbackToken: () => string | readonly string[];
  private readonly resolveFallbackScopes: (token: string) => readonly string[];
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private nextClientOrdinal = 1;
  private started = false;

  public constructor(options: Partial<WebSocketBridgeServerOptions> = {}) {
    const mergedSecurityOptions = {
      ...DEFAULT_OPTIONS.security,
      ...(options.security ?? {}),
    };
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      security: mergedSecurityOptions,
    };

    this.resolveFallbackToken =
      this.options.security.tokenResolver ??
      (() => resolveRuntimeEnv().OPENCLAW_BRIDGE_TOKEN ?? "");
    this.resolveFallbackScopes =
      this.options.security.scopesResolver ??
      (() => parseScopes(resolveRuntimeEnv().OPENCLAW_BRIDGE_SCOPES));
    this.runtimeSecurityCredentials = this.buildInitialRuntimeSecurityCredentials();

    this.bridgeCore = new BridgeCore({
      queueCapacity: this.options.queueCapacity,
      dropPolicy: this.options.dropPolicy,
      autoFlush: true,
      onEventEmitAttempt: (event, emittedAtMs) => {
        this.eventMetrics.recordEmitAttempt(event, emittedAtMs);
      },
    });
    this.actionPolicyManager = createActionPolicyPackManager({
      allowlist: this.options.security.actionAllowlist,
      initialPackId: "runtime-default",
      initialDescription: "boot baseline policy pack",
    });
    this.security = createBridgeSecurityGuardrails({
      ...this.options.security,
      tokenResolver: () => this.resolveAcceptedSecurityTokens(),
      scopesResolver: (token) => this.resolveScopesForToken(token),
      actionPolicy: (action) => this.actionPolicyManager.decide(action),
      auditHook: (auditEvent) => {
        this.handleSecurityAudit(auditEvent);
        this.options.security.auditHook?.(auditEvent);
      },
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
    const redacted = this.security.redactEvent(event);
    if (!redacted) {
      return;
    }

    this.bridgeCore.publish(redacted);
  }

  public getMetrics(): BridgeMetrics {
    return this.bridgeCore.getMetrics();
  }

  public getOperationalMetrics(): BridgeOperationalMetrics {
    const policyState = this.actionPolicyManager.getState();
    return {
      ...this.bridgeCore.getMetrics(),
      ...this.eventMetrics.snapshot(),
      bridge_authn_failures_total: this.securityMetrics.authnFailuresTotal,
      bridge_authz_denies_total: this.securityMetrics.authzDeniesTotal,
      bridge_redaction_applied_total: this.securityMetrics.redactionAppliedTotal,
      bridge_redaction_failures_total: this.securityMetrics.redactionFailuresTotal,
      bridge_action_gate_decisions_total: {
        allow: this.securityMetrics.actionGateAllowTotal,
        deny: this.securityMetrics.actionGateDenyTotal,
      },
      bridge_action_receipts_total: {
        accepted: this.securityMetrics.actionReceiptAcceptedTotal,
        duplicate: this.securityMetrics.actionReceiptDuplicateTotal,
        rejected: this.securityMetrics.actionReceiptRejectedTotal,
      },
      bridge_action_idempotency_replays_total:
        this.securityMetrics.actionIdempotencyReplaysTotal,
      bridge_policy_pack_state: {
        active_pack_id: policyState.activePack.packId,
        active_pack_version: policyState.activePack.version,
        history_depth: policyState.historyDepth,
      },
      bridge_policy_pack_operations_total: {
        validate: {
          accepted: this.securityMetrics.policyValidateAcceptedTotal,
          rejected: this.securityMetrics.policyValidateRejectedTotal,
        },
        apply: {
          accepted: this.securityMetrics.policyApplyAcceptedTotal,
          rejected: this.securityMetrics.policyApplyRejectedTotal,
        },
        rollback: {
          accepted: this.securityMetrics.policyRollbackAcceptedTotal,
          rejected: this.securityMetrics.policyRollbackRejectedTotal,
        },
      },
    };
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
    const authorizationHeader = request.headers.authorization;

    if (request.method === "GET" && request.url === "/metrics/prometheus") {
      const authResult = this.security.authorize(
        authorizationHeader,
        this.security.requiredScopes.metricsRead,
      );
      if (!authResult.allowed) {
        response.statusCode = authResult.statusCode;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: authResult.reason }));
        return;
      }

      const snapshot = this.getOperationalMetrics();
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      response.end(renderPrometheusMetrics(snapshot));
      return;
    }

    if (request.method === "GET" && request.url === "/metrics") {
      const authResult = this.security.authorize(
        authorizationHeader,
        this.security.requiredScopes.metricsRead,
      );
      if (!authResult.allowed) {
        response.statusCode = authResult.statusCode;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: authResult.reason }));
        return;
      }

      const snapshot = this.getOperationalMetrics();
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(snapshot));
      return;
    }

    if (request.method === "POST" && request.url === "/ingest/plugin") {
      void this.handlePluginIngestRequest(request, response, authorizationHeader);
      return;
    }

    if (request.method === "POST" && request.url === "/security/rotate") {
      void this.handleSecurityRotateRequest(request, response, authorizationHeader);
      return;
    }

    if (request.method === "GET" && request.url === "/policy/packs") {
      this.handlePolicyPackStateRequest(response, authorizationHeader);
      return;
    }

    if (request.method === "POST" && request.url === "/policy/packs/validate") {
      void this.handlePolicyPackValidateRequest(request, response, authorizationHeader);
      return;
    }

    if (request.method === "POST" && request.url === "/policy/packs/apply") {
      void this.handlePolicyPackApplyRequest(request, response, authorizationHeader);
      return;
    }

    if (request.method === "POST" && request.url === "/policy/packs/rollback") {
      void this.handlePolicyPackRollbackRequest(request, response, authorizationHeader);
      return;
    }

    const actionName = this.parseActionName(request.url);
    if (request.method === "POST" && actionName) {
      void this.handleActionRequest(
        request,
        response,
        authorizationHeader,
        actionName,
      );
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

    const authResult = this.security.authorize(
      request.headers.authorization,
      this.security.requiredScopes.telemetryRead,
    );
    if (!authResult.allowed) {
      socket.write(
        `HTTP/1.1 ${authResult.statusCode} ${toStatusText(authResult.statusCode)}\r\n\r\n`,
      );
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

  private parseActionName(rawUrl: string | undefined): string {
    if (typeof rawUrl !== "string" || !rawUrl.startsWith("/actions/")) {
      return "";
    }

    const withoutPrefix = rawUrl.slice("/actions/".length).split("?")[0];
    const decoded = decodeURIComponent(withoutPrefix).trim();
    return decoded;
  }

  private async handleActionRequest(
    request: IncomingMessage,
    response: ServerResponse,
    authorizationHeader: string | readonly string[] | undefined,
    actionName: string,
  ): Promise<void> {
    const bodyPayload = await readOptionalJsonObjectBody(
      request,
      this.options.pluginIngestMaxBodyBytes,
    );
    if (!bodyPayload.ok) {
      response.statusCode = bodyPayload.statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: bodyPayload.error }));
      return;
    }

    const actionRequest = parseActionRequestPayload(bodyPayload.payload);
    if (!actionRequest) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "invalid_payload" }));
      return;
    }

    const idempotencyKey = resolveActionIdempotencyKey(
      request.headers["idempotency-key"],
      actionRequest.idempotencyKey,
      actionName,
    );
    if (idempotencyKey.length > 160) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "idempotency_key_too_long" }));
      return;
    }

    const correlationId = resolveCorrelationId(
      request.headers["x-correlation-id"],
      actionRequest.correlationId,
      actionName,
    );
    if (correlationId.length > 160) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "correlation_id_too_long" }));
      return;
    }

    const receiptKey = `${actionName}::${idempotencyKey}`;
    const currentAttemptAt = new Date().toISOString();
    const existing = this.actionReceiptsByKey.get(receiptKey);
    if (existing) {
      const duplicateReceipt: ActionExecutionReceipt = {
        ...existing,
        status: "duplicate",
        lastAttemptAt: currentAttemptAt,
        attempts: existing.attempts + 1,
      };
      this.actionReceiptsByKey.set(receiptKey, duplicateReceipt);
      this.securityMetrics.actionReceiptDuplicateTotal += 1;
      this.securityMetrics.actionIdempotencyReplaysTotal += 1;

      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          action: actionName,
          allowed: duplicateReceipt.allowed,
          reason: duplicateReceipt.reason,
          scope: duplicateReceipt.scope,
          duplicate: true,
          idempotencyKey,
          correlationId: duplicateReceipt.correlationId,
          receipt: duplicateReceipt,
        }),
      );
      return;
    }

    const gateDecision = this.security.decideAction(
      actionName,
      authorizationHeader,
    );
    const receipt: ActionExecutionReceipt = {
      receiptId: createActionReceiptId(actionName, idempotencyKey),
      action: actionName,
      status: gateDecision.allowed ? "accepted" : "rejected",
      allowed: gateDecision.allowed,
      reason: gateDecision.reason,
      scope: gateDecision.scope,
      statusCode: gateDecision.statusCode,
      idempotencyKey,
      correlationId,
      requestHash: hashActionRequest(actionName, actionRequest.payload),
      createdAt: currentAttemptAt,
      lastAttemptAt: currentAttemptAt,
      attempts: 1,
    };
    this.actionReceiptsByKey.set(receiptKey, receipt);
    if (receipt.allowed) {
      this.securityMetrics.actionReceiptAcceptedTotal += 1;
    } else {
      this.securityMetrics.actionReceiptRejectedTotal += 1;
    }

    response.statusCode = gateDecision.statusCode;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        action: actionName,
        allowed: gateDecision.allowed,
        reason: gateDecision.reason,
        scope: gateDecision.scope,
        duplicate: false,
        idempotencyKey,
        correlationId,
        receipt,
      }),
    );
  }

  private async handlePluginIngestRequest(
    request: IncomingMessage,
    response: ServerResponse,
    authorizationHeader: string | readonly string[] | undefined,
  ): Promise<void> {
    const authResult = this.security.authorize(
      authorizationHeader,
      this.security.requiredScopes.actionWrite,
    );
    if (!authResult.allowed) {
      response.statusCode = authResult.statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: authResult.reason }));
      return;
    }

    if (!this.options.ingestPluginPayload) {
      response.statusCode = 503;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "plugin_ingest_not_configured" }));
      return;
    }

    let body = "";
    let bodySizeBytes = 0;
    let responded = false;
    request.setEncoding("utf8");

    request.on("data", (chunk) => {
      if (responded) {
        return;
      }

      const fragment = String(chunk);
      body += fragment;
      bodySizeBytes += fragment.length;
      if (bodySizeBytes > this.options.pluginIngestMaxBodyBytes) {
        responded = true;
        response.statusCode = 413;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "payload_too_large" }));
      }
    });

    request.on("error", () => {
      if (responded) {
        return;
      }
      responded = true;
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "request_stream_error" }));
    });

    request.on("end", () => {
      if (responded) {
        return;
      }

      const payload = parsePluginPayload(body);
      if (!payload) {
        responded = true;
        response.statusCode = 400;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "invalid_payload" }));
        return;
      }

      let rawResult: BridgeIngestResult | null = null;
      try {
        rawResult = this.options.ingestPluginPayload?.(payload) ?? null;
      } catch {
        responded = true;
        response.statusCode = 503;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(createPluginIngestHandlerErrorPayload()));
        return;
      }

      const normalizedResult = normalizePluginIngestResult(rawResult);
      if (!normalizedResult.ok) {
        const failure = normalizedResult.value;
        responded = true;
        response.statusCode = 503;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(failure));
        return;
      }

      const accepted = normalizedResult.value;
      this.publish(accepted.event);
      responded = true;
      response.statusCode = 202;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          accepted: true,
          eventId: accepted.event.eventId,
          route: accepted.route,
          source: accepted.source,
          mode: accepted.mode,
        }),
      );
    });
  }

  private async handleSecurityRotateRequest(
    request: IncomingMessage,
    response: ServerResponse,
    authorizationHeader: string | readonly string[] | undefined,
  ): Promise<void> {
    const authResult = this.security.authorize(
      authorizationHeader,
      this.security.requiredScopes.actionWrite,
    );
    if (!authResult.allowed) {
      response.statusCode = authResult.statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: authResult.reason }));
      return;
    }

    let body = "";
    let bodySizeBytes = 0;
    let responded = false;
    request.setEncoding("utf8");

    request.on("data", (chunk) => {
      if (responded) {
        return;
      }

      const fragment = String(chunk);
      body += fragment;
      bodySizeBytes += fragment.length;
      if (bodySizeBytes > this.options.pluginIngestMaxBodyBytes) {
        responded = true;
        response.statusCode = 413;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "payload_too_large" }));
      }
    });

    request.on("error", () => {
      if (responded) {
        return;
      }
      responded = true;
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "request_stream_error" }));
    });

    request.on("end", () => {
      if (responded) {
        return;
      }

      const payload = parseSecurityRotatePayload(body);
      if (!payload) {
        responded = true;
        response.statusCode = 400;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "invalid_payload" }));
        return;
      }

      const nextToken = payload.token.trim();
      if (nextToken.length === 0) {
        responded = true;
        response.statusCode = 400;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "token_required" }));
        return;
      }

      const explicitScopes = payload.scopes;
      const nextScopes = explicitScopes
        ? toUniqueScopes(explicitScopes)
        : this.runtimeSecurityCredentials.activeScopes;
      if (nextScopes.length === 0) {
        responded = true;
        response.statusCode = 400;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ error: "scopes_required" }));
        return;
      }

      const graceMs = resolveRotationGraceMs(payload.graceMs);
      const now = Date.now();
      const activeTokenBeforeRotation = this.runtimeSecurityCredentials.activeToken;
      const activeScopesBeforeRotation = this.runtimeSecurityCredentials.activeScopes;

      this.runtimeSecurityCredentials.activeToken = nextToken;
      this.runtimeSecurityCredentials.activeScopes = nextScopes;

      if (graceMs > 0 && activeTokenBeforeRotation !== nextToken) {
        this.runtimeSecurityCredentials.previousToken = activeTokenBeforeRotation;
        this.runtimeSecurityCredentials.previousScopes = activeScopesBeforeRotation;
        this.runtimeSecurityCredentials.previousTokenExpiresAtMs = now + graceMs;
      } else {
        this.runtimeSecurityCredentials.previousToken = null;
        this.runtimeSecurityCredentials.previousScopes = [];
        this.runtimeSecurityCredentials.previousTokenExpiresAtMs = null;
      }

      responded = true;
      response.statusCode = 202;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          rotated: true,
          activeTokenFingerprint: maskToken(nextToken),
          activeScopes: nextScopes,
          graceMsApplied: graceMs,
          previousTokenValidUntil:
            this.runtimeSecurityCredentials.previousTokenExpiresAtMs === null
              ? null
              : new Date(
                  this.runtimeSecurityCredentials.previousTokenExpiresAtMs,
                ).toISOString(),
        }),
      );
    });
  }

  private handlePolicyPackStateRequest(
    response: ServerResponse,
    authorizationHeader: string | readonly string[] | undefined,
  ): void {
    const authResult = this.security.authorize(
      authorizationHeader,
      this.security.requiredScopes.policyAdmin,
    );
    if (!authResult.allowed) {
      response.statusCode = authResult.statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: authResult.reason }));
      return;
    }

    const state = this.actionPolicyManager.getState();
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        activePack: state.activePack,
        history: state.history,
        historyDepth: state.historyDepth,
      }),
    );
  }

  private async handlePolicyPackValidateRequest(
    request: IncomingMessage,
    response: ServerResponse,
    authorizationHeader: string | readonly string[] | undefined,
  ): Promise<void> {
    const authResult = this.security.authorize(
      authorizationHeader,
      this.security.requiredScopes.policyAdmin,
    );
    if (!authResult.allowed) {
      response.statusCode = authResult.statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: authResult.reason }));
      return;
    }

    const bodyPayload = await readOptionalJsonObjectBody(
      request,
      this.options.pluginIngestMaxBodyBytes,
    );
    if (!bodyPayload.ok) {
      response.statusCode = bodyPayload.statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: bodyPayload.error }));
      return;
    }

    const input = parsePolicyPackInputPayload(bodyPayload.payload);
    if (!input) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "invalid_payload" }));
      return;
    }

    const validation = this.actionPolicyManager.validate(input);
    if (validation.valid) {
      this.securityMetrics.policyValidateAcceptedTotal += 1;
    } else {
      this.securityMetrics.policyValidateRejectedTotal += 1;
    }

    const state = this.actionPolicyManager.getState();
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        operation: "validate",
        valid: validation.valid,
        packId: validation.packId,
        allowlist: validation.allowlist,
        issues: validation.issues,
        activePack: state.activePack,
        historyDepth: state.historyDepth,
      }),
    );
  }

  private async handlePolicyPackApplyRequest(
    request: IncomingMessage,
    response: ServerResponse,
    authorizationHeader: string | readonly string[] | undefined,
  ): Promise<void> {
    const authResult = this.security.authorize(
      authorizationHeader,
      this.security.requiredScopes.policyAdmin,
    );
    if (!authResult.allowed) {
      response.statusCode = authResult.statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: authResult.reason }));
      return;
    }

    const bodyPayload = await readOptionalJsonObjectBody(
      request,
      this.options.pluginIngestMaxBodyBytes,
    );
    if (!bodyPayload.ok) {
      response.statusCode = bodyPayload.statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: bodyPayload.error }));
      return;
    }

    const input = parsePolicyPackInputPayload(bodyPayload.payload);
    if (!input) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "invalid_payload" }));
      return;
    }

    const applyResult = this.actionPolicyManager.apply(input);
    if (applyResult.applied) {
      this.securityMetrics.policyApplyAcceptedTotal += 1;
    } else {
      this.securityMetrics.policyApplyRejectedTotal += 1;
    }

    response.statusCode = applyResult.applied ? 202 : 400;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        operation: "apply",
        applied: applyResult.applied,
        reason: applyResult.reason,
        activePack: applyResult.activePack,
        previousPack: applyResult.previousPack,
        validation: applyResult.validation,
        historyDepth: applyResult.historyDepth,
      }),
    );
  }

  private async handlePolicyPackRollbackRequest(
    request: IncomingMessage,
    response: ServerResponse,
    authorizationHeader: string | readonly string[] | undefined,
  ): Promise<void> {
    const authResult = this.security.authorize(
      authorizationHeader,
      this.security.requiredScopes.policyAdmin,
    );
    if (!authResult.allowed) {
      response.statusCode = authResult.statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: authResult.reason }));
      return;
    }

    const bodyPayload = await readOptionalJsonObjectBody(
      request,
      this.options.pluginIngestMaxBodyBytes,
    );
    if (!bodyPayload.ok) {
      response.statusCode = bodyPayload.statusCode;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: bodyPayload.error }));
      return;
    }

    const rollbackPayload = parsePolicyPackRollbackPayload(bodyPayload.payload);
    if (!rollbackPayload) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "invalid_payload" }));
      return;
    }

    const rollbackResult = this.actionPolicyManager.rollback(
      rollbackPayload.targetPackId,
    );
    if (rollbackResult.rolledBack) {
      this.securityMetrics.policyRollbackAcceptedTotal += 1;
    } else {
      this.securityMetrics.policyRollbackRejectedTotal += 1;
    }

    response.statusCode = rollbackResult.rolledBack ? 202 : 409;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        operation: "rollback",
        rolledBack: rollbackResult.rolledBack,
        reason: rollbackResult.reason,
        activePack: rollbackResult.activePack,
        rolledBackFromPackId: rollbackResult.rolledBackFromPackId,
        rolledBackToPackId: rollbackResult.rolledBackToPackId,
        historyDepth: rollbackResult.historyDepth,
      }),
    );
  }

  private buildInitialRuntimeSecurityCredentials(): RuntimeSecurityCredentials {
    const fallbackToken = resolveExpectedTokens(this.resolveFallbackToken())[0] ?? "";
    const activeToken =
      fallbackToken.length > 0
        ? fallbackToken
        : "dev-openclaw-bridge-token";
    const activeScopes = toUniqueScopes(this.resolveFallbackScopes(activeToken));

    return {
      activeToken,
      activeScopes,
      previousToken: null,
      previousScopes: [],
      previousTokenExpiresAtMs: null,
    };
  }

  private resolveAcceptedSecurityTokens(): readonly string[] {
    const activeToken = this.runtimeSecurityCredentials.activeToken;
    const previousToken = this.runtimeSecurityCredentials.previousToken;
    const previousTokenExpiresAtMs =
      this.runtimeSecurityCredentials.previousTokenExpiresAtMs;
    if (
      !previousToken ||
      previousTokenExpiresAtMs === null ||
      previousTokenExpiresAtMs <= Date.now()
    ) {
      return [activeToken];
    }

    return [activeToken, previousToken];
  }

  private resolveScopesForToken(token: string): readonly string[] {
    if (token === this.runtimeSecurityCredentials.activeToken) {
      return this.runtimeSecurityCredentials.activeScopes;
    }

    const previousToken = this.runtimeSecurityCredentials.previousToken;
    if (
      previousToken &&
      token === previousToken &&
      this.runtimeSecurityCredentials.previousTokenExpiresAtMs !== null &&
      this.runtimeSecurityCredentials.previousTokenExpiresAtMs > Date.now()
    ) {
      return this.runtimeSecurityCredentials.previousScopes;
    }

    return this.resolveFallbackScopes(token);
  }

  private handleSecurityAudit(event: SecurityAuditEvent): void {
    if (event.control === "authn" && event.decision === "deny") {
      this.securityMetrics.authnFailuresTotal += 1;
      return;
    }

    if (event.control === "authz" && event.decision === "deny") {
      this.securityMetrics.authzDeniesTotal += 1;
      return;
    }

    if (event.control === "redaction" && event.decision === "applied") {
      this.securityMetrics.redactionAppliedTotal += 1;
      return;
    }

    if (event.control === "redaction" && event.decision === "deny") {
      this.securityMetrics.redactionFailuresTotal += 1;
      return;
    }

    if (event.control === "action-gate") {
      if (event.decision === "allow") {
        this.securityMetrics.actionGateAllowTotal += 1;
      } else if (event.decision === "deny") {
        this.securityMetrics.actionGateDenyTotal += 1;
      }
    }
  }
}

interface ParsedActionRequestPayload {
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  readonly payload: Record<string, unknown>;
}

interface ParsedPolicyPackRollbackPayload {
  readonly targetPackId?: string;
}

interface OptionalJsonBodyReadResult {
  readonly ok: boolean;
  readonly statusCode: number;
  readonly error?: string;
  readonly payload: Record<string, unknown>;
}

interface PluginIngestFailurePayload {
  readonly error: string;
  readonly reasonCode: string;
  readonly mode: BridgeIngestMode;
  readonly route: BridgeIngestRoute;
}

interface NormalizedPluginIngestSuccess {
  readonly route: BridgeIngestRoute;
  readonly source: "native-plugin" | "log-tail-parser" | "none";
  readonly mode: BridgeIngestMode;
  readonly event: BridgeEvent;
}

type NormalizedPluginIngestResult =
  | {
      readonly ok: true;
      readonly value: NormalizedPluginIngestSuccess;
    }
  | {
      readonly ok: false;
      readonly value: PluginIngestFailurePayload;
    };

async function readOptionalJsonObjectBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<OptionalJsonBodyReadResult> {
  let body = "";
  let bodySizeBytes = 0;

  return await new Promise<OptionalJsonBodyReadResult>((resolve) => {
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      const fragment = String(chunk);
      body += fragment;
      bodySizeBytes += fragment.length;
      if (bodySizeBytes > maxBodyBytes) {
        resolve({
          ok: false,
          statusCode: 413,
          error: "payload_too_large",
          payload: {},
        });
      }
    });
    request.on("error", () => {
      resolve({
        ok: false,
        statusCode: 400,
        error: "request_stream_error",
        payload: {},
      });
    });
    request.on("end", () => {
      if (body.trim().length === 0) {
        resolve({
          ok: true,
          statusCode: 200,
          payload: {},
        });
        return;
      }

      const parsed = parsePluginPayload(body);
      if (!parsed) {
        resolve({
          ok: false,
          statusCode: 400,
          error: "invalid_payload",
          payload: {},
        });
        return;
      }

      resolve({
        ok: true,
        statusCode: 200,
        payload: parsed,
      });
    });
  });
}

function parseActionRequestPayload(
  payload: Record<string, unknown>,
): ParsedActionRequestPayload | null {
  const rawIdempotencyKey = payload.idempotencyKey;
  if (
    rawIdempotencyKey !== undefined &&
    typeof rawIdempotencyKey !== "string"
  ) {
    return null;
  }

  const rawCorrelationId = payload.correlationId;
  if (rawCorrelationId !== undefined && typeof rawCorrelationId !== "string") {
    return null;
  }

  const rawActionPayload = payload.payload;
  if (
    rawActionPayload !== undefined &&
    (!rawActionPayload || typeof rawActionPayload !== "object" || Array.isArray(rawActionPayload))
  ) {
    return null;
  }

  const actionPayload =
    rawActionPayload && typeof rawActionPayload === "object"
      ? (rawActionPayload as Record<string, unknown>)
      : {};
  const idempotencyKey =
    typeof rawIdempotencyKey === "string" ? rawIdempotencyKey.trim() : undefined;
  const correlationId =
    typeof rawCorrelationId === "string" ? rawCorrelationId.trim() : undefined;

  return {
    idempotencyKey,
    correlationId,
    payload: actionPayload,
  };
}

function parsePolicyPackInputPayload(
  payload: Record<string, unknown>,
): ActionPolicyPackInput | null {
  const rawPackId = payload.packId;
  if (rawPackId !== undefined && typeof rawPackId !== "string") {
    return null;
  }

  const rawDescription = payload.description;
  if (rawDescription !== undefined && typeof rawDescription !== "string") {
    return null;
  }

  const rawAllowlist = payload.allowlist;
  if (rawAllowlist !== undefined) {
    if (!Array.isArray(rawAllowlist)) {
      return null;
    }

    const allowlist = rawAllowlist
      .map((item) => (typeof item === "string" ? item.trim() : null));
    if (allowlist.some((item) => item === null)) {
      return null;
    }

    return {
      packId: typeof rawPackId === "string" ? rawPackId.trim() : undefined,
      allowlist: allowlist as readonly string[],
      description:
        typeof rawDescription === "string" ? rawDescription.trim() : undefined,
    };
  }

  return {
    packId: typeof rawPackId === "string" ? rawPackId.trim() : undefined,
    description: typeof rawDescription === "string" ? rawDescription.trim() : undefined,
  };
}

function parsePolicyPackRollbackPayload(
  payload: Record<string, unknown>,
): ParsedPolicyPackRollbackPayload | null {
  const rawTargetPackId = payload.targetPackId;
  if (rawTargetPackId !== undefined && typeof rawTargetPackId !== "string") {
    return null;
  }

  if (typeof rawTargetPackId === "string" && rawTargetPackId.trim().length > 0) {
    return {
      targetPackId: rawTargetPackId.trim(),
    };
  }

  return {};
}

function resolveActionIdempotencyKey(
  headerValue: string | readonly string[] | undefined,
  bodyValue: string | undefined,
  action: string,
): string {
  const fromHeader = readSingleHeaderValue(headerValue);
  if (fromHeader.length > 0) {
    return fromHeader;
  }

  if (typeof bodyValue === "string" && bodyValue.length > 0) {
    return bodyValue;
  }

  return `auto-${createHash("sha1")
    .update(action)
    .update(":")
    .update(String(Date.now()))
    .update(":")
    .update(String(Math.random()))
    .digest("hex")
    .slice(0, 20)}`;
}

function resolveCorrelationId(
  headerValue: string | readonly string[] | undefined,
  bodyValue: string | undefined,
  action: string,
): string {
  const fromHeader = readSingleHeaderValue(headerValue);
  if (fromHeader.length > 0) {
    return fromHeader;
  }
  if (typeof bodyValue === "string" && bodyValue.length > 0) {
    return bodyValue;
  }
  return `corr-${createHash("sha1").update(`${action}:${Date.now()}`).digest("hex").slice(0, 12)}`;
}

function readSingleHeaderValue(
  headerValue: string | readonly string[] | undefined,
): string {
  const rawValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof rawValue !== "string") {
    return "";
  }
  return rawValue.trim();
}

function hashActionRequest(action: string, payload: Record<string, unknown>): string {
  return createHash("sha256")
    .update(action)
    .update(":")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function createActionReceiptId(action: string, idempotencyKey: string): string {
  return `rct-${createHash("sha1")
    .update(action)
    .update(":")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 20)}`;
}

function toStatusText(statusCode: number): string {
  if (statusCode === 401) {
    return "Unauthorized";
  }
  if (statusCode === 403) {
    return "Forbidden";
  }
  if (statusCode === 503) {
    return "Service Unavailable";
  }
  return "Bad Request";
}

function parsePluginPayload(rawBody: string): Record<string, unknown> | null {
  if (typeof rawBody !== "string") {
    return null;
  }

  const trimmed = rawBody.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const payload = JSON.parse(trimmed);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

const VALID_PLUGIN_INGEST_ROUTES = new Set<BridgeIngestRoute>([
  "plugin-primary",
  "fallback-log-tail",
  "blocked",
]);

const VALID_PLUGIN_INGEST_MODES = new Set<BridgeIngestMode>([
  "primary",
  "fallback",
  "blocked",
]);

const VALID_PLUGIN_INGEST_SOURCES = new Set<NormalizedPluginIngestSuccess["source"]>([
  "native-plugin",
  "log-tail-parser",
  "none",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePluginFailureField(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? value : null;
}

function parsePluginIngestMode(value: unknown): BridgeIngestMode | null {
  if (typeof value !== "string") {
    return null;
  }
  if (!VALID_PLUGIN_INGEST_MODES.has(value as BridgeIngestMode)) {
    return null;
  }
  return value as BridgeIngestMode;
}

function parsePluginIngestRoute(value: unknown): BridgeIngestRoute | null {
  if (typeof value !== "string") {
    return null;
  }
  if (!VALID_PLUGIN_INGEST_ROUTES.has(value as BridgeIngestRoute)) {
    return null;
  }
  return value as BridgeIngestRoute;
}

function createPluginIngestInvalidResultPayload(): PluginIngestFailurePayload {
  return {
    error: "plugin_ingest_invalid_result",
    reasonCode: "plugin_ingest_invalid_result",
    mode: "blocked",
    route: "blocked",
  };
}

export function createPluginIngestHandlerErrorPayload(): PluginIngestFailurePayload {
  return {
    error: "plugin_ingest_handler_error",
    reasonCode: "plugin_ingest_handler_error",
    mode: "blocked",
    route: "blocked",
  };
}

export function normalizePluginIngestResult(
  rawResult: BridgeIngestResult | null,
): NormalizedPluginIngestResult {
  if (!isRecord(rawResult)) {
    return {
      ok: false,
      value: {
        error: "plugin_ingest_unavailable",
        reasonCode: "plugin_ingest_unavailable",
        mode: "blocked",
        route: "blocked",
      },
    };
  }

  const normalizedReason = parsePluginFailureField(rawResult.reason);
  const normalizedReasonCode = parsePluginFailureField(rawResult.reasonCode);
  if (normalizedReason === null || normalizedReasonCode === null) {
    return {
      ok: false,
      value: createPluginIngestInvalidResultPayload(),
    };
  }

  const normalizedMode = parsePluginIngestMode(rawResult.mode);
  const normalizedRoute = parsePluginIngestRoute(rawResult.route);
  if (!normalizedMode || !normalizedRoute) {
    return {
      ok: false,
      value: createPluginIngestInvalidResultPayload(),
    };
  }

  const rawSource = rawResult.source;
  if (
    typeof rawSource !== "string" ||
    !VALID_PLUGIN_INGEST_SOURCES.has(rawSource as NormalizedPluginIngestSuccess["source"])
  ) {
    return {
      ok: false,
      value: createPluginIngestInvalidResultPayload(),
    };
  }

  if (!isRecord(rawResult.event)) {
    return {
      ok: false,
      value: {
        error: normalizedReason ?? "plugin_ingest_unavailable",
        reasonCode: normalizedReasonCode ?? "plugin_ingest_unavailable",
        mode: normalizedMode,
        route: normalizedRoute,
      },
    };
  }

  return {
    ok: true,
    value: {
      route: normalizedRoute,
      source: rawSource as NormalizedPluginIngestSuccess["source"],
      mode: normalizedMode,
      event: rawResult.event as BridgeEvent,
    },
  };
}

function parseSecurityRotatePayload(rawBody: string): {
  token: string;
  scopes?: readonly string[];
  graceMs?: number;
} | null {
  const parsedPayload = parsePluginPayload(rawBody);
  if (!parsedPayload) {
    return null;
  }

  const rawToken = parsedPayload.token;
  if (typeof rawToken !== "string") {
    return null;
  }

  const rawScopes = parsedPayload.scopes;
  if (rawScopes !== undefined) {
    if (!Array.isArray(rawScopes)) {
      return null;
    }

    const scopes = rawScopes
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
    if (scopes.length === 0) {
      return null;
    }

    const rawGraceMs = parsedPayload.graceMs;
    if (rawGraceMs !== undefined && !isFiniteNonNegativeNumber(rawGraceMs)) {
      return null;
    }

    return {
      token: rawToken,
      scopes,
      graceMs:
        typeof rawGraceMs === "number" ? Math.floor(rawGraceMs) : undefined,
    };
  }

  const rawGraceMs = parsedPayload.graceMs;
  if (rawGraceMs !== undefined && !isFiniteNonNegativeNumber(rawGraceMs)) {
    return null;
  }

  return {
    token: rawToken,
    graceMs: typeof rawGraceMs === "number" ? Math.floor(rawGraceMs) : undefined,
  };
}

function resolveRotationGraceMs(rawGraceMs: number | undefined): number {
  if (rawGraceMs === undefined) {
    return DEFAULT_ROTATION_GRACE_MS;
  }

  const bounded = Math.max(0, Math.min(MAX_ROTATION_GRACE_MS, rawGraceMs));
  return Math.floor(bounded);
}

function maskToken(token: string): string {
  const normalized = token.trim();
  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}***`;
  }
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function resolveExpectedTokens(
  resolvedTokenValue: string | readonly string[],
): readonly string[] {
  if (typeof resolvedTokenValue === "string") {
    const token = resolvedTokenValue.trim();
    return token.length > 0 ? [token] : [];
  }

  return resolvedTokenValue
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toUniqueScopes(scopes: readonly string[]): readonly string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
}

function parseScopes(rawValue: string | undefined): readonly string[] {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return DEFAULT_SCOPE_SET;
  }

  const scopes = rawValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return scopes.length > 0 ? scopes : DEFAULT_SCOPE_SET;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function resolveRuntimeEnv(): Record<string, string | undefined> {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return maybeProcess.process?.env ?? {};
}

function renderPrometheusMetrics(snapshot: BridgeOperationalMetrics): string {
  const lines: string[] = [];

  pushMetric(lines, "bridge_dropped_events", Number(snapshot.droppedEvents));
  pushMetric(lines, "bridge_connected_clients", Number(snapshot.connectedClients));
  pushMetric(lines, "bridge_queue_depth", Number(snapshot.queueDepth));
  pushMetric(lines, "bridge_events_total", Number(snapshot.bridge_events_total));

  for (const [qos, value] of Object.entries(snapshot.bridge_events_qos_total)) {
    pushMetric(lines, "bridge_events_qos_total", Number(value), { qos });
  }
  for (const [lane, value] of Object.entries(snapshot.bridge_events_lane_total)) {
    pushMetric(lines, "bridge_events_lane_total", Number(value), { lane });
  }
  for (const [session, value] of Object.entries(snapshot.bridge_events_session_total)) {
    pushMetric(lines, "bridge_events_session_total", Number(value), { session });
  }

  for (const [stat, value] of Object.entries(snapshot.bridge_event_e2e_latency_ms.total)) {
    pushMetric(lines, "bridge_event_e2e_latency_ms_total", Number(value), { stat });
  }

  for (const [qos, stats] of Object.entries(snapshot.bridge_event_e2e_latency_ms.by_qos)) {
    for (const [stat, value] of Object.entries(stats)) {
      pushMetric(lines, "bridge_event_e2e_latency_ms_by_qos", Number(value), {
        qos,
        stat,
      });
    }
  }

  pushMetric(
    lines,
    "bridge_authn_failures_total",
    Number(snapshot.bridge_authn_failures_total),
  );
  pushMetric(
    lines,
    "bridge_authz_denies_total",
    Number(snapshot.bridge_authz_denies_total),
  );
  pushMetric(
    lines,
    "bridge_redaction_applied_total",
    Number(snapshot.bridge_redaction_applied_total),
  );
  pushMetric(
    lines,
    "bridge_redaction_failures_total",
    Number(snapshot.bridge_redaction_failures_total),
  );

  pushMetric(
    lines,
    "bridge_action_gate_decisions_total",
    Number(snapshot.bridge_action_gate_decisions_total.allow),
    { decision: "allow" },
  );
  pushMetric(
    lines,
    "bridge_action_gate_decisions_total",
    Number(snapshot.bridge_action_gate_decisions_total.deny),
    { decision: "deny" },
  );
  pushMetric(
    lines,
    "bridge_action_receipts_total",
    Number(snapshot.bridge_action_receipts_total.accepted),
    { status: "accepted" },
  );
  pushMetric(
    lines,
    "bridge_action_receipts_total",
    Number(snapshot.bridge_action_receipts_total.duplicate),
    { status: "duplicate" },
  );
  pushMetric(
    lines,
    "bridge_action_receipts_total",
    Number(snapshot.bridge_action_receipts_total.rejected),
    { status: "rejected" },
  );
  pushMetric(
    lines,
    "bridge_action_idempotency_replays_total",
    Number(snapshot.bridge_action_idempotency_replays_total),
  );
  pushMetric(
    lines,
    "bridge_policy_pack_active_version",
    Number(snapshot.bridge_policy_pack_state.active_pack_version),
  );
  pushMetric(
    lines,
    "bridge_policy_pack_history_depth",
    Number(snapshot.bridge_policy_pack_state.history_depth),
  );
  pushMetric(
    lines,
    "bridge_policy_pack_active_info",
    1,
    {
      pack_id: snapshot.bridge_policy_pack_state.active_pack_id,
      version: String(snapshot.bridge_policy_pack_state.active_pack_version),
    },
  );
  pushMetric(
    lines,
    "bridge_policy_pack_operations_total",
    Number(snapshot.bridge_policy_pack_operations_total.validate.accepted),
    {
      operation: "validate",
      result: "accepted",
    },
  );
  pushMetric(
    lines,
    "bridge_policy_pack_operations_total",
    Number(snapshot.bridge_policy_pack_operations_total.validate.rejected),
    {
      operation: "validate",
      result: "rejected",
    },
  );
  pushMetric(
    lines,
    "bridge_policy_pack_operations_total",
    Number(snapshot.bridge_policy_pack_operations_total.apply.accepted),
    {
      operation: "apply",
      result: "accepted",
    },
  );
  pushMetric(
    lines,
    "bridge_policy_pack_operations_total",
    Number(snapshot.bridge_policy_pack_operations_total.apply.rejected),
    {
      operation: "apply",
      result: "rejected",
    },
  );
  pushMetric(
    lines,
    "bridge_policy_pack_operations_total",
    Number(snapshot.bridge_policy_pack_operations_total.rollback.accepted),
    {
      operation: "rollback",
      result: "accepted",
    },
  );
  pushMetric(
    lines,
    "bridge_policy_pack_operations_total",
    Number(snapshot.bridge_policy_pack_operations_total.rollback.rejected),
    {
      operation: "rollback",
      result: "rejected",
    },
  );

  return `${lines.join("\n")}\n`;
}

function pushMetric(
  lines: string[],
  name: string,
  rawValue: number,
  labels: Record<string, string> = {},
): void {
  const value = Number.isFinite(rawValue) ? rawValue : 0;
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    lines.push(`${name} ${value}`);
    return;
  }

  const formattedLabels = entries
    .map(([key, labelValue]) => `${key}="${escapePrometheusLabelValue(labelValue)}"`)
    .join(",");
  lines.push(`${name}{${formattedLabels}} ${value}`);
}

function escapePrometheusLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}
