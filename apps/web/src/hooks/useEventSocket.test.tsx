import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEventStore, useEventStore } from '../store/eventStore';
import { useEventSocket } from './useEventSocket';
import type { WebSocketLike } from '../ws/ReconnectingWebSocketClient';

class MockWebSocket implements WebSocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  close = vi.fn();

  emitOpen(): void {
    this.onopen?.(new Event('open'));
  }

  emitMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  emitClose(): void {
    this.onclose?.(new CloseEvent('close'));
  }
}

describe('useEventSocket', () => {
  beforeEach(() => {
    resetEventStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects, stores inbound events, and reconnects with backoff', () => {
    const sockets: MockWebSocket[] = [];
    const factory = vi.fn(() => {
      const socket = new MockWebSocket();
      sockets.push(socket);
      return socket;
    });

    renderHook(() =>
      useEventSocket('ws://example.test/events', {
        webSocketFactory: factory,
        baseDelayMs: 25,
        maxDelayMs: 50,
        backoffFactor: 2
      })
    );

    expect(factory).toHaveBeenCalledTimes(1);
    expect(useEventStore.getState().connectionState).toBe('connecting');

    act(() => {
      sockets[0].emitOpen();
    });

    expect(useEventStore.getState().connectionState).toBe('open');

    act(() => {
      sockets[0].emitMessage(
        JSON.stringify({
          eventId: 'evt-9',
          eventType: 'station.updated',
          occurredAt: '2026-03-01T18:00:00.000Z',
          payload: { stationId: 'S1' }
        })
      );
    });

    expect(useEventStore.getState().events).toHaveLength(1);
    expect(useEventStore.getState().events[0]?.eventType).toBe('station.updated');

    act(() => {
      sockets[0].emitClose();
    });

    expect(useEventStore.getState().connectionState).toBe('closed');

    act(() => {
      vi.advanceTimersByTime(24);
    });
    expect(factory).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('closes the socket when unmounted', () => {
    const sockets: MockWebSocket[] = [];
    const factory = vi.fn(() => {
      const socket = new MockWebSocket();
      sockets.push(socket);
      return socket;
    });

    const { unmount } = renderHook(() =>
      useEventSocket('ws://example.test/events', {
        webSocketFactory: factory,
        baseDelayMs: 25
      })
    );

    unmount();

    expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
    expect(useEventStore.getState().connectionState).toBe('closed');
  });
});
