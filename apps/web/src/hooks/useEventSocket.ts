import { useEffect } from 'react';
import { useEventStore } from '../store/eventStore';
import { ReconnectingWebSocketClient, type WebSocketFactory } from '../ws/ReconnectingWebSocketClient';

type UseEventSocketOptions = {
  webSocketFactory?: WebSocketFactory;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
};

const DEFAULT_WS_URL = import.meta.env.VITE_EVENT_WS_URL ?? 'ws://localhost:8080/events';

const normalizeEvent = (raw: unknown) => {
  if (typeof raw === 'object' && raw !== null && 'type' in raw && typeof (raw as { type: unknown }).type === 'string') {
    const event = raw as {
      type: string;
      id?: string;
      payload?: unknown;
      receivedAt?: number;
    };

    return {
      id: event.id,
      type: event.type,
      payload: event.payload,
      receivedAt: event.receivedAt
    };
  }

  return {
    type: 'unknown.event',
    payload: raw
  };
};

export const useEventSocket = (url: string = DEFAULT_WS_URL, options: UseEventSocketOptions = {}): void => {
  const addEvent = useEventStore((state) => state.addEvent);
  const setConnectionState = useEventStore((state) => state.setConnectionState);

  useEffect(() => {
    const client = new ReconnectingWebSocketClient({
      url,
      onEvent: (event) => addEvent(normalizeEvent(event)),
      onConnectionStateChange: setConnectionState,
      webSocketFactory: options.webSocketFactory,
      baseDelayMs: options.baseDelayMs,
      maxDelayMs: options.maxDelayMs,
      backoffFactor: options.backoffFactor
    });

    client.start();

    return () => {
      client.stop();
    };
  }, [
    addEvent,
    options.backoffFactor,
    options.baseDelayMs,
    options.maxDelayMs,
    options.webSocketFactory,
    setConnectionState,
    url
  ]);
};
