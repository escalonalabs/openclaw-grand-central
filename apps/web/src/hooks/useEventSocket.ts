import { useEffect } from 'react';
import { useEventStore, type IncomingEvent } from '../store/eventStore';
import { ReconnectingWebSocketClient, type WebSocketFactory } from '../ws/ReconnectingWebSocketClient';

type UseEventSocketOptions = {
  webSocketFactory?: WebSocketFactory;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
};

const DEFAULT_WS_URL = import.meta.env.VITE_EVENT_WS_URL ?? 'ws://localhost:3000/events';

const DEFAULT_SOURCE: IncomingEvent['source'] = {
  agentId: 'unknown-agent',
  workspaceId: 'unknown-workspace',
  laneId: 'unknown-lane',
  sessionId: 'unknown-session'
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toNonEmptyString = (value: unknown, fallback: string): string => {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return fallback;
};

const toIsoTimestamp = (value: unknown): string => {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
};

const normalizeSeverity = (value: unknown): IncomingEvent['severity'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'info';
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  if (normalized === 'warning') {
    return 'warn';
  }
  return 'info';
};

const normalizePayload = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const normalizeEvent = (raw: unknown): IncomingEvent => {
  const fallbackEventId = `evt-${Date.now()}`;

  if (isRecord(raw) && typeof raw.eventType === 'string') {
    const source = isRecord(raw.source) ? raw.source : {};
    return {
      version: '1.0',
      eventId: toNonEmptyString(raw.eventId, fallbackEventId),
      occurredAt: toIsoTimestamp(raw.occurredAt),
      eventType: toNonEmptyString(raw.eventType, 'telemetry.unknown'),
      severity: normalizeSeverity(raw.severity),
      source: {
        agentId: toNonEmptyString(source.agentId, DEFAULT_SOURCE.agentId),
        workspaceId: toNonEmptyString(source.workspaceId, DEFAULT_SOURCE.workspaceId),
        laneId: toNonEmptyString(source.laneId, DEFAULT_SOURCE.laneId),
        sessionId: toNonEmptyString(source.sessionId, DEFAULT_SOURCE.sessionId)
      },
      payload: normalizePayload(raw.payload)
    };
  }

  if (isRecord(raw) && typeof raw.type === 'string') {
    return {
      version: '1.0',
      eventId: toNonEmptyString(raw.id, fallbackEventId),
      occurredAt: toIsoTimestamp(raw.receivedAt),
      eventType: toNonEmptyString(raw.type, 'telemetry.unknown'),
      severity: 'info',
      source: DEFAULT_SOURCE,
      payload: normalizePayload(raw.payload)
    };
  }

  return {
    version: '1.0',
    eventId: fallbackEventId,
    occurredAt: new Date().toISOString(),
    eventType: 'unknown.event',
    severity: 'info',
    source: DEFAULT_SOURCE,
    payload: { raw }
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
