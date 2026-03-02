import { beforeEach, describe, expect, it } from 'vitest';
import { resetEventStore, useEventStore } from './eventStore';

describe('eventStore', () => {
  beforeEach(() => {
    resetEventStore();
  });

  it('stores incoming events', () => {
    useEventStore.getState().addEvent({
      version: '1.0',
      eventId: 'evt-1',
      occurredAt: '2026-03-01T18:00:00.000Z',
      eventType: 'train.arrived',
      severity: 'info',
      source: {
        agentId: 'agent-1',
        workspaceId: 'workspace-omnia',
        laneId: 'lane-1',
        sessionId: 'session-1'
      },
      payload: { trainId: 'A1' },
    });

    expect(useEventStore.getState().events).toEqual([
      {
        version: '1.0',
        eventId: 'evt-1',
        occurredAt: '2026-03-01T18:00:00.000Z',
        eventType: 'train.arrived',
        severity: 'info',
        source: {
          agentId: 'agent-1',
          workspaceId: 'workspace-omnia',
          laneId: 'lane-1',
          sessionId: 'session-1'
        },
        payload: { trainId: 'A1' },
      }
    ]);
  });

  it('clears stored events', () => {
    useEventStore.getState().addEvent({
      version: '1.0',
      eventId: 'evt-2',
      occurredAt: '2026-03-01T18:01:00.000Z',
      eventType: 'station.ready',
      severity: 'info',
      source: {
        agentId: 'agent-1',
        workspaceId: 'workspace-omnia',
        laneId: 'lane-1',
        sessionId: 'session-1'
      },
      payload: {}
    });
    useEventStore.getState().clearEvents();

    expect(useEventStore.getState().events).toHaveLength(0);
  });

  it('tracks connection state transitions', () => {
    useEventStore.getState().setConnectionState('connecting');
    useEventStore.getState().setConnectionState('open');

    expect(useEventStore.getState().connectionState).toBe('open');
  });
});
