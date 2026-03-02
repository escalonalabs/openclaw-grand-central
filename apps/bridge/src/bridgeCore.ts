import type {
  DropPolicy,
  EnqueueResult,
} from "./backpressureQueue.ts";
import {
  BridgeMetricsRegistry,
  type BridgeMetrics,
} from "./metrics.ts";
import {
  resolveBridgeEventQos,
  type BridgeEventQos,
} from "./operationalEventMetrics.ts";
import type { BridgeEvent } from "./types.ts";

export interface BridgeClient {
  readonly id: string;
  send(payload: string): void;
  close?(code?: number, reason?: string): void;
}

export interface BridgeCoreOptions {
  readonly queueCapacity: number;
  readonly dropPolicy: DropPolicy;
  readonly autoFlush: boolean;
  readonly now: () => number;
  readonly laneQosWeights: Readonly<Record<BridgeEventQos, number>>;
  readonly onEventEmitAttempt?: (event: BridgeEvent, emittedAtMs: number) => void;
}

export interface AddClientResult {
  readonly replaced: boolean;
}

const DEFAULT_OPTIONS: BridgeCoreOptions = {
  queueCapacity: 128,
  dropPolicy: "drop-oldest",
  autoFlush: true,
  now: () => Date.now(),
  laneQosWeights: {
    critical: 4,
    stateful: 2,
    best_effort: 1,
  },
};

export class BridgeCore {
  private readonly clients = new Map<string, BridgeClient>();
  private readonly queue: LaneFairSchedulerQueue;
  private readonly metrics = new BridgeMetricsRegistry();
  private readonly autoFlush: boolean;
  private readonly now: () => number;
  private readonly onEventEmitAttempt?: (event: BridgeEvent, emittedAtMs: number) => void;
  private isFlushing = false;
  private flushScheduled = false;

  public constructor(options: Partial<BridgeCoreOptions> = {}) {
    const resolvedOptions: BridgeCoreOptions = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    this.queue = new LaneFairSchedulerQueue({
      capacity: resolvedOptions.queueCapacity,
      dropPolicy: resolvedOptions.dropPolicy,
      qosWeights: resolvedOptions.laneQosWeights,
    });
    this.autoFlush = resolvedOptions.autoFlush;
    this.now = resolvedOptions.now;
    this.onEventEmitAttempt = resolvedOptions.onEventEmitAttempt;
    this.metrics.setQueueDepth(this.queue.depth);
  }

  public addOrReplaceClient(client: BridgeClient): AddClientResult {
    const existing = this.clients.get(client.id);

    if (existing && existing !== client) {
      existing.close?.(4001, "reconnected");
      this.clients.delete(client.id);
      this.clients.set(client.id, client);
      this.metrics.setConnectedClients(this.clients.size);
      return { replaced: true };
    }

    this.clients.set(client.id, client);
    this.metrics.setConnectedClients(this.clients.size);
    return { replaced: false };
  }

  public removeClient(clientId: string): boolean {
    const removed = this.clients.delete(clientId);
    this.metrics.setConnectedClients(this.clients.size);
    return removed;
  }

  public publish(event: BridgeEvent): void {
    this.queue.enqueue(event);
    this.refreshQueueMetrics();

    if (this.autoFlush) {
      this.scheduleFlush();
    }
  }

  public flushNow(): void {
    this.flushScheduled = false;
    this.flush();
  }

  public getMetrics(): BridgeMetrics {
    return this.metrics.snapshot();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) {
      return;
    }

    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  private flush(): void {
    if (this.isFlushing) {
      return;
    }

    this.isFlushing = true;

    try {
      for (;;) {
        const queuedEvent = this.queue.dequeue();
        if (!queuedEvent) {
          break;
        }

        const emitAttemptAtMs = this.now();
        try {
          this.onEventEmitAttempt?.(queuedEvent, emitAttemptAtMs);
        } catch {
          // Metrics callbacks must not affect delivery.
        }

        const payload = JSON.stringify(queuedEvent);
        const disconnectedClients: string[] = [];

        for (const [clientId, client] of this.clients) {
          try {
            client.send(payload);
          } catch {
            disconnectedClients.push(clientId);
          }
        }

        for (const disconnectedClient of disconnectedClients) {
          this.clients.delete(disconnectedClient);
        }

        this.metrics.setConnectedClients(this.clients.size);
        this.refreshQueueMetrics();
      }
    } finally {
      this.isFlushing = false;
      this.refreshQueueMetrics();
    }
  }

  private refreshQueueMetrics(): void {
    this.metrics.setDroppedEvents(this.queue.getDroppedEvents());
    this.metrics.setQueueDepth(this.queue.depth);
  }
}

interface LaneFairSchedulerQueueOptions {
  readonly capacity: number;
  readonly dropPolicy: DropPolicy;
  readonly qosWeights: Readonly<Record<BridgeEventQos, number>>;
}

interface ScheduledEvent {
  readonly sequence: number;
  readonly event: BridgeEvent;
  readonly laneId: string;
  readonly qos: BridgeEventQos;
}

interface LaneBucket {
  readonly key: string;
  readonly laneId: string;
  readonly qos: BridgeEventQos;
  readonly events: ScheduledEvent[];
}

class LaneFairSchedulerQueue {
  private static readonly QOS_ORDER: readonly BridgeEventQos[] = [
    "critical",
    "stateful",
    "best_effort",
  ];

  private readonly capacity: number;
  private readonly dropPolicy: DropPolicy;
  private readonly qosWeights: Readonly<Record<BridgeEventQos, number>>;
  private droppedEvents = 0;
  private sequence = 0;
  private readonly buckets = new Map<string, LaneBucket>();
  private readonly bucketOrderByQos: Record<BridgeEventQos, string[]> = {
    critical: [],
    stateful: [],
    best_effort: [],
  };
  private readonly bucketCursorByQos: Record<BridgeEventQos, number> = {
    critical: 0,
    stateful: 0,
    best_effort: 0,
  };
  private readonly availableCredits: Record<BridgeEventQos, number> = {
    critical: 0,
    stateful: 0,
    best_effort: 0,
  };
  private qosCursor = 0;
  private readonly bySequence = new Map<number, ScheduledEvent>();
  private readonly sequenceOrder: number[] = [];

  public constructor(options: LaneFairSchedulerQueueOptions) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) {
      throw new Error("Lane fair queue capacity must be an integer >= 1");
    }

    this.capacity = options.capacity;
    this.dropPolicy = options.dropPolicy;
    this.qosWeights = normalizeWeights(options.qosWeights);
    this.resetCredits();
  }

  public enqueue(event: BridgeEvent): EnqueueResult {
    if (this.depth >= this.capacity) {
      this.droppedEvents += 1;
      if (this.dropPolicy === "drop-newest") {
        return {
          accepted: false,
          dropped: this.droppedEvents,
          depth: this.depth,
        };
      }

      this.dropOldest();
    }

    const laneId = normalizeLaneId(event.source.laneId);
    const qos = resolveSchedulingQos(event);
    const sequence = this.sequence;
    this.sequence += 1;
    const scheduledEvent: ScheduledEvent = {
      sequence,
      event,
      laneId,
      qos,
    };

    const bucket = this.ensureBucket(laneId, qos);
    bucket.events.push(scheduledEvent);
    this.bySequence.set(sequence, scheduledEvent);
    this.sequenceOrder.push(sequence);

    return {
      accepted: true,
      dropped: this.droppedEvents,
      depth: this.depth,
    };
  }

  public dequeue(): BridgeEvent | undefined {
    if (this.depth === 0) {
      return undefined;
    }

    const readyQos = this.readReadyQosTiers();
    if (readyQos.length === 0) {
      return undefined;
    }

    if (this.totalCreditsFor(readyQos) === 0) {
      this.resetCredits();
    }

    for (let attempts = 0; attempts < LaneFairSchedulerQueue.QOS_ORDER.length; attempts += 1) {
      const qos = LaneFairSchedulerQueue.QOS_ORDER[this.qosCursor];
      this.qosCursor = (this.qosCursor + 1) % LaneFairSchedulerQueue.QOS_ORDER.length;

      if (!this.hasEventsForQos(qos)) {
        continue;
      }

      if (this.availableCredits[qos] <= 0) {
        continue;
      }

      const event = this.dequeueFromQos(qos);
      if (!event) {
        continue;
      }

      this.availableCredits[qos] = Math.max(0, this.availableCredits[qos] - 1);
      return event.event;
    }

    this.resetCredits();
    for (const qos of LaneFairSchedulerQueue.QOS_ORDER) {
      if (!this.hasEventsForQos(qos)) {
        continue;
      }

      const event = this.dequeueFromQos(qos);
      if (event) {
        this.availableCredits[qos] = Math.max(0, this.availableCredits[qos] - 1);
        return event.event;
      }
    }

    return undefined;
  }

  public get depth(): number {
    return this.sequenceOrder.length;
  }

  public getDroppedEvents(): number {
    return this.droppedEvents;
  }

  private hasEventsForQos(qos: BridgeEventQos): boolean {
    for (const bucketKey of this.bucketOrderByQos[qos]) {
      const bucket = this.buckets.get(bucketKey);
      if (bucket && bucket.events.length > 0) {
        return true;
      }
    }

    return false;
  }

  private readReadyQosTiers(): BridgeEventQos[] {
    return LaneFairSchedulerQueue.QOS_ORDER.filter((qos) => this.hasEventsForQos(qos));
  }

  private totalCreditsFor(qosTiers: readonly BridgeEventQos[]): number {
    return qosTiers.reduce((sum, qos) => {
      return sum + Math.max(0, this.availableCredits[qos]);
    }, 0);
  }

  private resetCredits(): void {
    this.availableCredits.critical = this.qosWeights.critical;
    this.availableCredits.stateful = this.qosWeights.stateful;
    this.availableCredits.best_effort = this.qosWeights.best_effort;
  }

  private ensureBucket(laneId: string, qos: BridgeEventQos): LaneBucket {
    const key = `${qos}:${laneId}`;
    const existing = this.buckets.get(key);
    if (existing) {
      return existing;
    }

    const bucket: LaneBucket = {
      key,
      laneId,
      qos,
      events: [],
    };
    this.buckets.set(key, bucket);
    this.bucketOrderByQos[qos].push(key);
    return bucket;
  }

  private dequeueFromQos(qos: BridgeEventQos): ScheduledEvent | undefined {
    const bucketOrder = this.bucketOrderByQos[qos];
    if (bucketOrder.length === 0) {
      this.bucketCursorByQos[qos] = 0;
      return undefined;
    }

    let cursor = this.bucketCursorByQos[qos] % bucketOrder.length;
    for (let offset = 0; offset < bucketOrder.length; offset += 1) {
      const index = (cursor + offset) % bucketOrder.length;
      const bucketKey = bucketOrder[index];
      const bucket = this.buckets.get(bucketKey);
      if (!bucket || bucket.events.length === 0) {
        this.removeEmptyBucket(qos, bucketKey, index);
        return this.dequeueFromQos(qos);
      }

      const scheduled = bucket.events.shift();
      if (!scheduled) {
        continue;
      }

      this.removeFromSequenceIndex(scheduled.sequence);
      this.bySequence.delete(scheduled.sequence);

      if (bucket.events.length === 0) {
        this.removeEmptyBucket(qos, bucketKey, index);
      } else {
        this.bucketCursorByQos[qos] = (index + 1) % bucketOrder.length;
      }

      return scheduled;
    }

    return undefined;
  }

  private removeEmptyBucket(
    qos: BridgeEventQos,
    bucketKey: string,
    fallbackIndex: number,
  ): void {
    this.buckets.delete(bucketKey);
    const bucketOrder = this.bucketOrderByQos[qos];
    const index = bucketOrder.indexOf(bucketKey);
    const removeIndex = index >= 0 ? index : fallbackIndex;
    if (removeIndex >= 0 && removeIndex < bucketOrder.length) {
      bucketOrder.splice(removeIndex, 1);
    }

    if (bucketOrder.length === 0) {
      this.bucketCursorByQos[qos] = 0;
      return;
    }

    this.bucketCursorByQos[qos] = removeIndex % bucketOrder.length;
  }

  private dropOldest(): void {
    const oldestSequence = this.sequenceOrder.shift();
    if (oldestSequence === undefined) {
      return;
    }

    const oldest = this.bySequence.get(oldestSequence);
    if (!oldest) {
      return;
    }

    this.bySequence.delete(oldestSequence);
    const bucketKey = `${oldest.qos}:${oldest.laneId}`;
    const bucket = this.buckets.get(bucketKey);
    if (!bucket || bucket.events.length === 0) {
      return;
    }

    if (bucket.events[0]?.sequence === oldestSequence) {
      bucket.events.shift();
    } else {
      const staleIndex = bucket.events.findIndex((item) => item.sequence === oldestSequence);
      if (staleIndex >= 0) {
        bucket.events.splice(staleIndex, 1);
      }
    }

    if (bucket.events.length === 0) {
      this.removeEmptyBucket(oldest.qos, bucketKey, 0);
    }
  }

  private removeFromSequenceIndex(sequence: number): void {
    const index = this.sequenceOrder.indexOf(sequence);
    if (index >= 0) {
      this.sequenceOrder.splice(index, 1);
    }
  }
}

function normalizeWeights(
  rawWeights: Readonly<Record<BridgeEventQos, number>>,
): Readonly<Record<BridgeEventQos, number>> {
  return {
    critical: normalizeWeight(rawWeights.critical, 4),
    stateful: normalizeWeight(rawWeights.stateful, 2),
    best_effort: normalizeWeight(rawWeights.best_effort, 1),
  };
}

function normalizeWeight(value: number, fallback: number): number {
  if (Number.isInteger(value) && value >= 1) {
    return value;
  }
  return fallback;
}

function normalizeLaneId(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "unknown-lane";
}

function resolveSchedulingQos(event: BridgeEvent): BridgeEventQos {
  const payload = event.payload;
  const rawQos = typeof payload.qos === "string" ? payload.qos.trim().toLowerCase() : "";
  if (
    rawQos === "critical" ||
    rawQos === "stateful" ||
    rawQos === "best_effort"
  ) {
    return rawQos;
  }

  const rawPriority =
    typeof payload.priority === "string" ? payload.priority.trim().toLowerCase() : "";
  if (rawPriority === "urgent" || rawPriority === "high" || rawPriority === "p1") {
    return "critical";
  }
  if (rawPriority === "medium" || rawPriority === "normal" || rawPriority === "p2") {
    return "stateful";
  }
  if (rawPriority === "low" || rawPriority === "background" || rawPriority === "p3") {
    return "best_effort";
  }

  return resolveBridgeEventQos(event);
}
