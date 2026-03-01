export type DropPolicy = "drop-oldest" | "drop-newest";

export interface BackpressureQueueOptions {
  readonly capacity: number;
  readonly dropPolicy: DropPolicy;
}

export interface EnqueueResult {
  readonly accepted: boolean;
  readonly dropped: number;
  readonly depth: number;
}

export class BackpressureQueue<T> {
  private readonly items: T[] = [];
  private droppedEvents = 0;
  private readonly options: BackpressureQueueOptions;

  public constructor(options: BackpressureQueueOptions) {
    this.options = options;

    if (!Number.isInteger(options.capacity) || options.capacity < 1) {
      throw new Error("Backpressure queue capacity must be an integer >= 1");
    }
  }

  public enqueue(item: T): EnqueueResult {
    if (this.items.length < this.options.capacity) {
      this.items.push(item);
      return {
        accepted: true,
        dropped: this.droppedEvents,
        depth: this.items.length,
      };
    }

    this.droppedEvents += 1;

    if (this.options.dropPolicy === "drop-oldest") {
      this.items.shift();
      this.items.push(item);
      return {
        accepted: true,
        dropped: this.droppedEvents,
        depth: this.items.length,
      };
    }

    return {
      accepted: false,
      dropped: this.droppedEvents,
      depth: this.items.length,
    };
  }

  public dequeue(): T | undefined {
    return this.items.shift();
  }

  public get depth(): number {
    return this.items.length;
  }

  public get capacity(): number {
    return this.options.capacity;
  }

  public getDroppedEvents(): number {
    return this.droppedEvents;
  }
}
