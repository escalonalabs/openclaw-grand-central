import type { BridgeEvent } from "./types.ts";

export type BridgeEventQos = "best_effort" | "stateful" | "critical";

export interface BridgeLatencyStats {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface BridgeEventOperationalSnapshot {
  readonly bridge_events_total: number;
  readonly bridge_events_qos_total: {
    readonly best_effort: number;
    readonly stateful: number;
    readonly critical: number;
  };
  readonly bridge_events_lane_total: Record<string, number>;
  readonly bridge_events_session_total: Record<string, number>;
  readonly bridge_event_e2e_latency_ms: {
    readonly total: BridgeLatencyStats;
    readonly by_qos: {
      readonly best_effort: BridgeLatencyStats;
      readonly stateful: BridgeLatencyStats;
      readonly critical: BridgeLatencyStats;
    };
  };
}

export interface BridgeOperationalEventMetricsOptions {
  readonly maxLatencySamples: number;
}

const DEFAULT_OPTIONS: BridgeOperationalEventMetricsOptions = {
  maxLatencySamples: 4096,
};

export class BridgeOperationalEventMetricsRegistry {
  private eventsTotal = 0;
  private readonly eventsByQos = {
    best_effort: 0,
    stateful: 0,
    critical: 0,
  };
  private readonly eventsByLane = new Map<string, number>();
  private readonly eventsBySession = new Map<string, number>();
  private readonly totalLatencyWindow: RollingLatencyWindow;
  private readonly latencyByQos: Record<BridgeEventQos, RollingLatencyWindow>;

  public constructor(
    options: Partial<BridgeOperationalEventMetricsOptions> = {},
  ) {
    const resolvedOptions = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    const maxLatencySamples = normalizeMaxSamples(resolvedOptions.maxLatencySamples);
    this.totalLatencyWindow = new RollingLatencyWindow(maxLatencySamples);
    this.latencyByQos = {
      best_effort: new RollingLatencyWindow(maxLatencySamples),
      stateful: new RollingLatencyWindow(maxLatencySamples),
      critical: new RollingLatencyWindow(maxLatencySamples),
    };
  }

  public recordEmitAttempt(event: BridgeEvent, emittedAtMs: number): void {
    const qos = resolveBridgeEventQos(event);
    this.eventsTotal += 1;
    this.eventsByQos[qos] += 1;
    const laneId = normalizeLaneId(event.source.laneId);
    const laneCount = this.eventsByLane.get(laneId) ?? 0;
    this.eventsByLane.set(laneId, laneCount + 1);
    const sessionId = normalizeSessionId(event.source.sessionId);
    const sessionCount = this.eventsBySession.get(sessionId) ?? 0;
    this.eventsBySession.set(sessionId, sessionCount + 1);

    const occurredAtMs = toUnixTimeMs(event.occurredAt);
    if (occurredAtMs === null) {
      return;
    }

    const latencyMs = Math.max(0, emittedAtMs - occurredAtMs);
    this.totalLatencyWindow.add(latencyMs);
    this.latencyByQos[qos].add(latencyMs);
  }

  public snapshot(): BridgeEventOperationalSnapshot {
    return {
      bridge_events_total: this.eventsTotal,
      bridge_events_qos_total: {
        best_effort: this.eventsByQos.best_effort,
        stateful: this.eventsByQos.stateful,
        critical: this.eventsByQos.critical,
      },
      bridge_events_lane_total: this.snapshotLaneTotals(),
      bridge_events_session_total: this.snapshotSessionTotals(),
      bridge_event_e2e_latency_ms: {
        total: this.totalLatencyWindow.snapshot(),
        by_qos: {
          best_effort: this.latencyByQos.best_effort.snapshot(),
          stateful: this.latencyByQos.stateful.snapshot(),
          critical: this.latencyByQos.critical.snapshot(),
        },
      },
    };
  }

  private snapshotLaneTotals(): Record<string, number> {
    const sortedLanes = [...this.eventsByLane.keys()].sort();
    const snapshot: Record<string, number> = {};
    for (const laneId of sortedLanes) {
      snapshot[laneId] = this.eventsByLane.get(laneId) ?? 0;
    }
    return snapshot;
  }

  private snapshotSessionTotals(): Record<string, number> {
    const sortedSessions = [...this.eventsBySession.keys()].sort();
    const snapshot: Record<string, number> = {};
    for (const sessionId of sortedSessions) {
      snapshot[sessionId] = this.eventsBySession.get(sessionId) ?? 0;
    }
    return snapshot;
  }
}

export function resolveBridgeEventQos(event: BridgeEvent): BridgeEventQos {
  const payloadQos = normalizeQosToken(readPayloadQos(event.payload));
  if (payloadQos) {
    return payloadQos;
  }

  const eventType = event.eventType.trim().toLowerCase();
  if (
    eventType.startsWith("approval.") ||
    eventType === "exec.approval" ||
    eventType.startsWith("security.")
  ) {
    return "critical";
  }

  if (
    eventType.startsWith("lane.") ||
    eventType.startsWith("session.") ||
    eventType.endsWith(".state")
  ) {
    return "stateful";
  }

  return "best_effort";
}

class RollingLatencyWindow {
  private readonly maxSamples: number;
  private readonly samples: number[] = [];
  private sampleStart = 0;

  public constructor(maxSamples: number) {
    this.maxSamples = normalizeMaxSamples(maxSamples);
  }

  public add(sample: number): void {
    const normalized = Number.isFinite(sample) ? Math.max(0, sample) : 0;
    if (this.samples.length < this.maxSamples) {
      this.samples.push(normalized);
      return;
    }

    this.samples[this.sampleStart] = normalized;
    this.sampleStart = (this.sampleStart + 1) % this.maxSamples;
  }

  public snapshot(): BridgeLatencyStats {
    if (this.samples.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const ordered = this.readOrderedSamples();
    const count = ordered.length;
    const sorted = [...ordered].sort((left, right) => left - right);
    const total = ordered.reduce((sum, item) => sum + item, 0);

    return {
      count,
      min: roundMetric(sorted[0]),
      max: roundMetric(sorted[count - 1]),
      avg: roundMetric(total / count),
      p50: roundMetric(percentile(sorted, 0.5)),
      p95: roundMetric(percentile(sorted, 0.95)),
      p99: roundMetric(percentile(sorted, 0.99)),
    };
  }

  private readOrderedSamples(): number[] {
    if (this.samples.length < this.maxSamples || this.sampleStart === 0) {
      return [...this.samples];
    }

    return [
      ...this.samples.slice(this.sampleStart),
      ...this.samples.slice(0, this.sampleStart),
    ];
  }
}

function toUnixTimeMs(value: string): number | null {
  const parsed = new Date(value).valueOf();
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const rank = quantile * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(3));
}

function normalizeMaxSamples(value: number): number {
  if (Number.isInteger(value) && value >= 16) {
    return value;
  }
  return DEFAULT_OPTIONS.maxLatencySamples;
}

function readPayloadQos(payload: Record<string, unknown>): string {
  const candidate = payload.qos;
  return typeof candidate === "string" ? candidate : "";
}

function normalizeQosToken(rawValue: string): BridgeEventQos | null {
  const normalized = rawValue.trim().toLowerCase();
  if (
    normalized === "best_effort" ||
    normalized === "stateful" ||
    normalized === "critical"
  ) {
    return normalized;
  }
  return null;
}

function normalizeLaneId(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "unknown-lane";
}

function normalizeSessionId(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "unknown-session";
}
