import { create } from 'zustand';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export type IncomingEventSeverity = 'debug' | 'info' | 'warn' | 'error';

export type IncomingEventSource = {
  agentId: string;
  workspaceId: string;
  laneId: string;
  sessionId: string;
};

export type IncomingEvent = {
  version: '1.0';
  eventId: string;
  occurredAt: string;
  eventType: string;
  severity: IncomingEventSeverity;
  source: IncomingEventSource;
  payload: Record<string, unknown>;
};

type EventStoreState = {
  connectionState: ConnectionState;
  events: IncomingEvent[];
  setConnectionState: (state: ConnectionState) => void;
  addEvent: (event: IncomingEvent) => void;
  clearEvents: () => void;
};

const initialState = {
  connectionState: 'idle' as ConnectionState,
  events: [] as IncomingEvent[]
};

export const useEventStore = create<EventStoreState>((set) => ({
  ...initialState,
  setConnectionState: (connectionState) => set({ connectionState }),
  addEvent: (event) =>
    set((state) => ({
      events: [...state.events, event]
    })),
  clearEvents: () => set({ events: [] })
}));

export const resetEventStore = (): void => {
  useEventStore.setState(initialState);
};
