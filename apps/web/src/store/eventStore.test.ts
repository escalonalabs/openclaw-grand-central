import { beforeEach, describe, expect, it } from 'vitest';
import { resetEventStore, useEventStore } from './eventStore';

describe('eventStore', () => {
  beforeEach(() => {
    resetEventStore();
  });

  it('stores incoming events', () => {
    useEventStore.getState().addEvent({
      id: 'evt-1',
      type: 'train.arrived',
      payload: { trainId: 'A1' },
      receivedAt: 1700000000
    });

    expect(useEventStore.getState().events).toEqual([
      {
        id: 'evt-1',
        type: 'train.arrived',
        payload: { trainId: 'A1' },
        receivedAt: 1700000000
      }
    ]);
  });

  it('clears stored events', () => {
    useEventStore.getState().addEvent({ type: 'station.ready' });
    useEventStore.getState().clearEvents();

    expect(useEventStore.getState().events).toHaveLength(0);
  });

  it('tracks connection state transitions', () => {
    useEventStore.getState().setConnectionState('connecting');
    useEventStore.getState().setConnectionState('open');

    expect(useEventStore.getState().connectionState).toBe('open');
  });
});
