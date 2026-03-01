export type StationLevel = 'debug' | 'info' | 'warn' | 'error';

export type MetadataValue = string | number | boolean | null;

export interface StationEvent {
  id: string;
  ts: string;
  source: string;
  type: string;
  level: StationLevel;
  message: string;
  laneId: string | null;
  agentId: string | null;
  stationId: string | null;
  metadata: Record<string, MetadataValue>;
  raw: unknown;
}

export interface StationEventInput {
  ts?: string;
  timestamp?: string;
  time?: string;
  createdAt?: string;
  source?: string;
  type?: string;
  event?: string;
  action?: string;
  level?: string;
  severity?: string;
  message?: string;
  msg?: string;
  laneId?: string;
  lane?: string;
  lane_id?: string;
  agentId?: string;
  agent?: string;
  agent_id?: string;
  runtimeId?: string;
  stationId?: string;
  station?: string;
  station_id?: string;
  workspace?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  raw?: unknown;
}

export interface ParsedLogRecord {
  timestamp?: string;
  event?: string;
  level?: string;
  message?: string;
  laneId?: string;
  agentId?: string;
  stationId?: string;
  metadata: Record<string, MetadataValue>;
  raw: unknown;
}

export type BridgeEventEmitter = (event: StationEvent) => void;

export interface BridgeAdapter {
  name: string;
  kind: string;
  start(handler: BridgeEventEmitter): void | Promise<void>;
  stop(): void | Promise<void>;
}

export interface LogTailAdapter extends BridgeAdapter {
  name: 'log-tail';
  kind: 'log-tail';
  ingestLine(line: string): StationEvent | null;
}

export interface PluginAdapter extends BridgeAdapter {
  name: 'plugin';
  kind: 'plugin-stub';
  emitPluginEvent(payload: Record<string, unknown>): {
    stub: true;
    reason: string;
    event: StationEvent;
  };
}

export declare function assertAdapterContract<T extends BridgeAdapter>(adapter: T): T;
export declare function normalizeStationEvent(input?: StationEventInput): StationEvent;
export declare function createLogTailAdapter(options?: { source?: string }): LogTailAdapter;
export declare function parseLogLine(line: string): ParsedLogRecord | null;
export declare function createPluginAdapter(options?: { source?: string }): PluginAdapter;
