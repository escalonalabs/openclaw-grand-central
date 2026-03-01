import type { ConnectionState } from '../store/eventStore';

export interface WebSocketLike {
  close: () => void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

type ReconnectingWebSocketOptions = {
  url: string;
  onEvent: (event: unknown) => void;
  onConnectionStateChange?: (state: ConnectionState) => void;
  webSocketFactory?: WebSocketFactory;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
};

const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10_000;
const DEFAULT_BACKOFF_FACTOR = 2;

export class ReconnectingWebSocketClient {
  private readonly url: string;
  private readonly onEvent: (event: unknown) => void;
  private readonly onConnectionStateChange: (state: ConnectionState) => void;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly backoffFactor: number;

  private socket: WebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private started = false;
  private stopping = false;

  constructor(options: ReconnectingWebSocketOptions) {
    this.url = options.url;
    this.onEvent = options.onEvent;
    this.onConnectionStateChange = options.onConnectionStateChange ?? (() => undefined);
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.backoffFactor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.stopping = false;
    this.connect();
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.stopping = true;
    this.clearReconnectTimer();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.onConnectionStateChange('closed');
    this.reconnectAttempt = 0;
    this.stopping = false;
  }

  private connect(): void {
    this.onConnectionStateChange('connecting');
    const socket = this.webSocketFactory(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.onConnectionStateChange('open');
    };

    socket.onmessage = (event) => {
      this.onEvent(this.parsePayload(event.data));
    };

    socket.onerror = () => {
      this.onConnectionStateChange('error');
    };

    socket.onclose = () => {
      this.socket = null;
      this.onConnectionStateChange('closed');

      if (!this.started || this.stopping) {
        return;
      }

      this.scheduleReconnect();
    };
  }

  private parsePayload(data: unknown): unknown {
    if (typeof data !== 'string') {
      return data;
    }

    try {
      return JSON.parse(data) as unknown;
    } catch {
      return {
        type: 'raw.message',
        payload: data
      };
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = this.getReconnectDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      if (!this.started) {
        return;
      }

      this.connect();
    }, delay);
  }

  private getReconnectDelay(attempt: number): number {
    const nextDelay = this.baseDelayMs * this.backoffFactor ** attempt;
    return Math.min(nextDelay, this.maxDelayMs);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
