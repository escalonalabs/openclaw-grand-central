export interface BridgeMetrics {
  readonly droppedEvents: number;
  readonly connectedClients: number;
  readonly queueDepth: number;
}

export class BridgeMetricsRegistry {
  private droppedEvents = 0;
  private connectedClients = 0;
  private queueDepth = 0;

  public setDroppedEvents(value: number): void {
    this.droppedEvents = Math.max(0, Math.floor(value));
  }

  public setConnectedClients(value: number): void {
    this.connectedClients = Math.max(0, Math.floor(value));
  }

  public setQueueDepth(value: number): void {
    this.queueDepth = Math.max(0, Math.floor(value));
  }

  public snapshot(): BridgeMetrics {
    return {
      droppedEvents: this.droppedEvents,
      connectedClients: this.connectedClients,
      queueDepth: this.queueDepth,
    };
  }
}
