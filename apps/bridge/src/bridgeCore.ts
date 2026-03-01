import { BackpressureQueue, type DropPolicy } from "./backpressureQueue.ts";
import {
  BridgeMetricsRegistry,
  type BridgeMetrics,
} from "./metrics.ts";
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
}

export interface AddClientResult {
  readonly replaced: boolean;
}

const DEFAULT_OPTIONS: BridgeCoreOptions = {
  queueCapacity: 128,
  dropPolicy: "drop-oldest",
  autoFlush: true,
};

export class BridgeCore {
  private readonly clients = new Map<string, BridgeClient>();
  private readonly queue: BackpressureQueue<BridgeEvent>;
  private readonly metrics = new BridgeMetricsRegistry();
  private readonly autoFlush: boolean;
  private isFlushing = false;
  private flushScheduled = false;

  public constructor(options: Partial<BridgeCoreOptions> = {}) {
    const resolvedOptions: BridgeCoreOptions = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    this.queue = new BackpressureQueue<BridgeEvent>({
      capacity: resolvedOptions.queueCapacity,
      dropPolicy: resolvedOptions.dropPolicy,
    });
    this.autoFlush = resolvedOptions.autoFlush;
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
