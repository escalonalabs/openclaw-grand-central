import { create } from 'zustand';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export type IncomingEvent = {
  id: string;
  type: string;
  payload: unknown;
  receivedAt: number;
};

type AddEventInput = {
  id?: string;
  type: string;
  payload?: unknown;
  receivedAt?: number;
};

type EventStoreState = {
  connectionState: ConnectionState;
  events: IncomingEvent[];
  setConnectionState: (state: ConnectionState) => void;
  addEvent: (event: AddEventInput) => void;
  clearEvents: () => void;
};

const initialState = {
  connectionState: 'idle' as ConnectionState,
  events: [] as IncomingEvent[]
};

const buildEvent = (event: AddEventInput): IncomingEvent => {
  return {
    id: event.id ?? `${event.type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: event.type,
    payload: event.payload ?? null,
    receivedAt: event.receivedAt ?? Date.now()
  };
};

export const useEventStore = create<EventStoreState>((set) => ({
  ...initialState,
  setConnectionState: (connectionState) => set({ connectionState }),
  addEvent: (event) =>
    set((state) => ({
      events: [...state.events, buildEvent(event)]
    })),
  clearEvents: () => set({ events: [] })
}));

export const resetEventStore = (): void => {
  useEventStore.setState(initialState);
};
