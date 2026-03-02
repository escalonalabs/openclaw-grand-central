export type BridgeEventSeverity = "debug" | "info" | "warn" | "error";

export interface BridgeEventSource {
  readonly agentId: string;
  readonly workspaceId: string;
  readonly laneId: string;
  readonly sessionId: string;
}

export interface BridgeEvent {
  readonly version: "1.0";
  readonly eventId: string;
  readonly occurredAt: string;
  readonly eventType: string;
  readonly severity: BridgeEventSeverity;
  readonly source: BridgeEventSource;
  readonly payload: Record<string, unknown>;
}

export interface BridgeEventInput {
  readonly timestamp?: string | number | Date;
  readonly ts?: string | number | Date;
  readonly time?: string | number | Date;
  readonly eventType?: string;
  readonly event?: string;
  readonly type?: string;
  readonly action?: string;
  readonly severity?: string;
  readonly level?: string;
  readonly source?: {
    readonly agentId?: string;
    readonly workspaceId?: string;
    readonly laneId?: string;
    readonly sessionId?: string;
  };
  readonly laneId?: string;
  readonly agentId?: string;
  readonly workspaceId?: string;
  readonly stationId?: string;
  readonly sessionId?: string;
  readonly message?: string;
  readonly payload?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly raw?: unknown;
}

export interface ParsedLogRecord {
  readonly timestamp?: string;
  readonly event?: string;
  readonly level?: string;
  readonly message?: string;
  readonly laneId?: string;
  readonly agentId?: string;
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly metadata: Record<string, string | number | boolean | null>;
  readonly raw: unknown;
}

export type BridgeEventEmitter = (event: BridgeEvent) => void;

export interface BridgeAdapter {
  readonly name: string;
  readonly kind: string;
  start(handler: BridgeEventEmitter): void | Promise<void>;
  stop(): void | Promise<void>;
}

export interface LogTailAdapter extends BridgeAdapter {
  readonly name: "log-tail";
  readonly kind: "log-tail";
  ingestLine(line: string): BridgeEvent | null;
}

export type PluginAdapterKind = "plugin-stub" | "plugin-native";

export interface PluginEmitResult {
  readonly accepted?: boolean;
  readonly stub: boolean;
  readonly reason?: string;
  readonly reasonCode?: string;
  readonly event: BridgeEvent;
}

export interface PluginAdapter extends BridgeAdapter {
  readonly name: "plugin";
  readonly kind: PluginAdapterKind;
  emitPluginEvent(payload: Record<string, unknown>): PluginEmitResult;
}
