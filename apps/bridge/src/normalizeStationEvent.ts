import { createHash } from "node:crypto";

import type {
  BridgeEvent,
  BridgeEventInput,
  BridgeEventSeverity,
  BridgeEventSource,
} from "./types.ts";

const SEVERITY_LEVELS = new Set<BridgeEventSeverity>([
  "debug",
  "info",
  "warn",
  "error",
]);

export function normalizeStationEvent(input: BridgeEventInput = {}): BridgeEvent {
  const occurredAt = toIsoTimestamp(input.timestamp ?? input.ts ?? input.time);
  const eventType = normalizeEventType(input.eventType ?? input.event ?? input.type ?? input.action);
  const severity = normalizeSeverity(input.severity ?? input.level);
  const source = normalizeSource(input);
  const payload = normalizePayload(input, eventType);
  const eventId = makeEventId({
    occurredAt,
    eventType,
    severity,
    source,
    payload,
  });

  return {
    version: "1.0",
    eventId,
    occurredAt,
    eventType,
    severity,
    source,
    payload,
  };
}

function normalizeSeverity(value: unknown): BridgeEventSeverity {
  const normalized = String(value ?? "info").trim().toLowerCase();
  if (normalized === "warning") {
    return "warn";
  }
  if (SEVERITY_LEVELS.has(normalized as BridgeEventSeverity)) {
    return normalized as BridgeEventSeverity;
  }

  return "info";
}

function normalizeEventType(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  return "telemetry.unknown";
}

function normalizeSource(input: BridgeEventInput): BridgeEventSource {
  const sourceInput = input.source ?? {};
  return {
    agentId: toNonEmptyString(sourceInput.agentId ?? input.agentId, "unknown-agent"),
    workspaceId: toNonEmptyString(
      sourceInput.workspaceId ?? input.workspaceId ?? input.stationId,
      "unknown-workspace",
    ),
    laneId: toNonEmptyString(sourceInput.laneId ?? input.laneId, "unknown-lane"),
    sessionId: toNonEmptyString(sourceInput.sessionId ?? input.sessionId, "unknown-session"),
  };
}

function normalizePayload(input: BridgeEventInput, eventType: string): Record<string, unknown> {
  const payload = asObject(input.payload);
  if (Object.keys(payload).length > 0) {
    return normalizePayloadForEventType(eventType, payload);
  }

  const fallbackPayload: Record<string, unknown> = {};
  if (typeof input.message === "string" && input.message.trim() !== "") {
    fallbackPayload.message = input.message.trim();
  }

  if (input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)) {
    for (const [key, value] of Object.entries(input.metadata)) {
      fallbackPayload[key] = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, "raw")) {
    fallbackPayload.raw = input.raw;
  }

  return normalizePayloadForEventType(eventType, fallbackPayload);
}

function normalizePayloadForEventType(
  eventType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (eventType === "lane.enqueue") {
    return {
      queueDepth: toNonNegativeInteger(payload.queueDepth ?? payload.queue_depth, 0),
      position: toNonNegativeInteger(payload.position ?? payload.index ?? payload.pos, 0),
    };
  }

  if (eventType === "approval.requested") {
    return {
      approvalId: toNonEmptyString(
        payload.approvalId ?? payload.approval_id ?? payload.requestId ?? payload.id,
        "unknown-approval",
      ),
      command: toNonEmptyString(
        payload.command ?? payload.cmd ?? payload.message,
        "unknown-command",
      ),
    };
  }

  return payload;
}

function toNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return fallback;
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function toNonEmptyString(value: unknown, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).trim();
  return normalized === "" ? fallback : normalized;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function makeEventId(seed: Record<string, unknown>): string {
  return createHash("sha1").update(JSON.stringify(seed)).digest("hex").slice(0, 16);
}
