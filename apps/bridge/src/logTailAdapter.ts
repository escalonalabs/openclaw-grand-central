import { assertAdapterContract } from "./adapterContract.ts";
import { normalizeStationEvent } from "./normalizeStationEvent.ts";
import type {
  BridgeEvent,
  BridgeEventEmitter,
  LogTailAdapter,
  ParsedLogRecord,
} from "./types.ts";

const KV_PAIR_PATTERN = /([A-Za-z_][\w.-]*)=("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\s]+)/g;
const ISO_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2}T[^\s]+)\s*(.*)$/;

const KNOWN_KEYS = new Set([
  "event",
  "type",
  "action",
  "timestamp",
  "ts",
  "time",
  "level",
  "severity",
  "message",
  "msg",
  "lane",
  "laneId",
  "lane_id",
  "agent",
  "agentId",
  "agent_id",
  "station",
  "stationId",
  "station_id",
  "workspace",
  "workspaceId",
  "session",
  "sessionId",
  "session_id",
  "meta",
  "metadata",
  "raw",
]);

export interface LogTailAdapterOptions {
  readonly sourceDefaults?: {
    readonly agentId?: string;
    readonly workspaceId?: string;
    readonly laneId?: string;
    readonly sessionId?: string;
  };
}

export function createLogTailAdapter(options: LogTailAdapterOptions = {}): LogTailAdapter {
  const sourceDefaults = {
    agentId: options.sourceDefaults?.agentId ?? "log-tail",
    workspaceId: options.sourceDefaults?.workspaceId ?? "workspace-unknown",
    laneId: options.sourceDefaults?.laneId ?? "lane-unknown",
    sessionId: options.sourceDefaults?.sessionId ?? "session-unknown",
  };

  let emit: BridgeEventEmitter | null = null;
  let running = false;

  const adapter: LogTailAdapter = {
    name: "log-tail",
    kind: "log-tail",
    async start(handler) {
      if (typeof handler !== "function") {
        throw new TypeError("log-tail adapter start(handler) requires a function.");
      }

      emit = handler;
      running = true;
    },
    async stop() {
      emit = null;
      running = false;
    },
    ingestLine(line) {
      const parsed = parseLogLine(line);
      if (!parsed) {
        return null;
      }

      const event = normalizeStationEvent({
        timestamp: parsed.timestamp,
        eventType: parsed.event,
        level: parsed.level,
        source: {
          agentId: parsed.agentId ?? sourceDefaults.agentId,
          workspaceId: parsed.workspaceId ?? sourceDefaults.workspaceId,
          laneId: parsed.laneId ?? sourceDefaults.laneId,
          sessionId: parsed.sessionId ?? sourceDefaults.sessionId,
        },
        payload: {
          ...(parsed.message ? { message: parsed.message } : {}),
          ...parsed.metadata,
        },
        raw: parsed.raw,
      });

      if (running && emit) {
        emit(event);
      }

      return event;
    },
  };

  return assertAdapterContract(adapter);
}

export function parseLogLine(line: string): ParsedLogRecord | null {
  if (typeof line !== "string") {
    return null;
  }

  const trimmed = line.trim();
  if (trimmed === "") {
    return null;
  }

  const parsedJson = parseJsonObject(trimmed);
  if (parsedJson) {
    return fromStructuredObject(parsedJson, line);
  }

  return fromKeyValueLine(trimmed, line);
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  if (!line.startsWith("{") || !line.endsWith("}")) {
    return null;
  }

  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function fromStructuredObject(payload: Record<string, unknown>, rawLine: string): ParsedLogRecord {
  const metadata = {
    ...pickMetadata(payload.meta),
    ...pickMetadata(payload.metadata),
    ...extractObjectRemainder(payload),
  };

  return {
    timestamp: toString(payload.timestamp ?? payload.ts ?? payload.time),
    event: toString(payload.event ?? payload.type ?? payload.action),
    level: toString(payload.level ?? payload.severity),
    message: toString(payload.message ?? payload.msg),
    laneId: toString(payload.laneId ?? payload.lane ?? payload.lane_id),
    agentId: toString(payload.agentId ?? payload.agent ?? payload.agent_id),
    workspaceId: toString(
      payload.workspaceId ?? payload.workspace ?? payload.stationId ?? payload.station,
    ),
    sessionId: toString(payload.sessionId ?? payload.session ?? payload.session_id),
    metadata,
    raw: payload.raw ?? payload ?? rawLine,
  };
}

function fromKeyValueLine(trimmedLine: string, rawLine: string): ParsedLogRecord {
  let rest = trimmedLine;
  let timestamp: string | undefined;
  const timestampMatch = rest.match(ISO_PREFIX_PATTERN);
  if (timestampMatch) {
    timestamp = timestampMatch[1];
    rest = timestampMatch[2];
  }

  const entries = parseKeyValuePairs(rest);
  const message = toString(entries.message ?? entries.msg);
  const event = toString(entries.event ?? entries.type ?? entries.action) ?? inferEventType(message);

  return {
    timestamp,
    event,
    level: toString(entries.level ?? entries.severity),
    message,
    laneId: toString(entries.laneId ?? entries.lane ?? entries.lane_id),
    agentId: toString(entries.agentId ?? entries.agent ?? entries.agent_id),
    workspaceId: toString(
      entries.workspaceId ?? entries.workspace ?? entries.stationId ?? entries.station,
    ),
    sessionId: toString(entries.sessionId ?? entries.session ?? entries.session_id),
    metadata: extractEntryRemainder(entries),
    raw: rawLine,
  };
}

function parseKeyValuePairs(text: string): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};

  KV_PAIR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = KV_PAIR_PATTERN.exec(text)) !== null) {
    const key = match[1];
    const token = match[2];
    output[key] = coerceScalar(unquote(token));
  }

  return output;
}

function toString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized === "" ? undefined : normalized;
}

function pickMetadata(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const metadata: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value)) {
    metadata[key] = normalizeMetadataValue(raw);
  }

  return metadata;
}

function extractObjectRemainder(payload: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const remainder: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (KNOWN_KEYS.has(key)) {
      continue;
    }

    remainder[key] = normalizeMetadataValue(value);
  }

  return remainder;
}

function extractEntryRemainder(payload: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const remainder: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (KNOWN_KEYS.has(key)) {
      continue;
    }

    remainder[key] = normalizeMetadataValue(value);
  }

  return remainder;
}

function inferEventType(message: string | undefined): string {
  if (!message) {
    return "telemetry.unknown";
  }

  const lowered = message.toLowerCase();
  if (lowered.includes("approval")) {
    return "approval.requested";
  }
  if (lowered.includes("enqueue") || lowered.includes("queued")) {
    return "lane.enqueue";
  }

  return "telemetry.unknown";
}

function normalizeMetadataValue(value: unknown): string | number | boolean | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return "";
    }
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const maybeNumber = Number(trimmed);
      if (Number.isFinite(maybeNumber)) {
        return maybeNumber;
      }
    }
    return trimmed;
  }

  return JSON.stringify(value);
}

function unquote(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function coerceScalar(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const maybeNumber = Number(trimmed);
    if (Number.isFinite(maybeNumber)) {
      return maybeNumber;
    }
  }

  return trimmed;
}
