type BufferEncoding = "utf8" | "hex" | "base64";

declare class Buffer extends Uint8Array {
  public readonly length: number;

  public static alloc(size: number): Buffer;
  public static from(
    data: string | ReadonlyArray<number> | ArrayBuffer | ArrayLike<number>,
    encoding?: BufferEncoding,
  ): Buffer;
  public static concat(list: readonly Uint8Array[]): Buffer;

  public copy(target: Uint8Array, targetStart?: number): number;
  public readUInt16BE(offset?: number): number;
  public readBigUInt64BE(offset?: number): bigint;
  public subarray(start?: number, end?: number): Buffer;
  public writeUInt16BE(value: number, offset?: number): number;
  public writeBigUInt64BE(value: bigint, offset?: number): number;
}

declare var Buffer: typeof Buffer;

declare module "node:crypto" {
  interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding: BufferEncoding): string;
  }

  export function createHash(algorithm: string): Hash;
}

declare module "node:net" {
  export interface Socket {
    setNoDelay(noDelay?: boolean): this;
    on(event: "data", listener: (chunk: Buffer) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: () => void): this;
    write(data: string | Buffer): boolean;
    end(data?: string | Buffer): this;
    destroy(): this;
  }
}

declare module "node:http" {
  import type { Socket } from "node:net";

  export interface IncomingHttpHeaders {
    [header: string]: string | string[] | undefined;
    upgrade?: string | undefined;
  }

  export interface IncomingMessage {
    method?: string | undefined;
    url?: string | undefined;
    headers: IncomingHttpHeaders;
    on(event: "data", listener: (chunk: Buffer | string) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    setEncoding(encoding: BufferEncoding): this;
  }

  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(chunk?: string): void;
  }

  export interface AddressInfo {
    port: number;
  }

  export interface Server {
    on(
      event: "upgrade",
      listener: (request: IncomingMessage, socket: Socket) => void,
    ): this;
    on(event: "error", listener: (error: Error) => void): this;
    off(event: "error", listener: (error: Error) => void): this;
    listen(port: number, host: string, callback?: () => void): this;
    close(callback: (error?: Error) => void): void;
    address(): AddressInfo | string | null;
  }

  export function createServer(
    listener: (request: IncomingMessage, response: ServerResponse) => void,
  ): Server;
}
