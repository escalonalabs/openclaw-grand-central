import { describe, expect, it } from 'vitest';
import type { IncomingEvent } from '../store/eventStore';
import { buildIncidentSummary, collectIncidentFeed } from './incidentModel';

const makeEvent = (
  overrides: Partial<IncomingEvent> & Pick<IncomingEvent, 'eventId' | 'eventType' | 'occurredAt'>
): IncomingEvent => ({
  version: '1.0',
  severity: 'info',
  source: {
    agentId: 'agent-1',
    workspaceId: 'workspace-omnia',
    laneId: 'lane-main',
    sessionId: 'session-a'
  },
  payload: {},
  ...overrides
});

describe('incidentModel', () => {
  it('collects incidents from severity and event-type signals', () => {
    const events: IncomingEvent[] = [
      makeEvent({
        eventId: 'evt-info',
        eventType: 'lane.enqueue',
        occurredAt: '2026-03-02T01:00:00.000Z',
        severity: 'info'
      }),
      makeEvent({
        eventId: 'evt-warn',
        eventType: 'render.overload',
        occurredAt: '2026-03-02T01:00:01.000Z',
        severity: 'warn',
        payload: { message: 'queue pressure' }
      }),
      makeEvent({
        eventId: 'evt-security',
        eventType: 'security.auth.failed',
        occurredAt: '2026-03-02T01:00:02.000Z',
        severity: 'info'
      }),
      makeEvent({
        eventId: 'evt-error',
        eventType: 'bridge.crash',
        occurredAt: '2026-03-02T01:00:03.000Z',
        severity: 'error'
      })
    ];

    const incidents = collectIncidentFeed(events);
    expect(incidents).toHaveLength(3);
    expect(incidents.map((item) => item.eventId)).toEqual(['evt-error', 'evt-security', 'evt-warn']);
    expect(incidents[2].message).toBe('queue pressure');
  });

  it('marks incidents as acked and summarizes counters', () => {
    const events: IncomingEvent[] = [
      makeEvent({
        eventId: 'evt-1',
        eventType: 'security.auth.failed',
        occurredAt: '2026-03-02T01:10:00.000Z',
        severity: 'warn'
      }),
      makeEvent({
        eventId: 'evt-2',
        eventType: 'approval.requested',
        occurredAt: '2026-03-02T01:10:01.000Z',
        severity: 'warn'
      }),
      makeEvent({
        eventId: 'evt-3',
        eventType: 'bridge.overload',
        occurredAt: '2026-03-02T01:10:02.000Z',
        severity: 'error'
      })
    ];

    const incidents = collectIncidentFeed(events, ['evt-2']);
    const summary = buildIncidentSummary(incidents);

    expect(incidents.find((item) => item.eventId === 'evt-2')?.status).toBe('acked');
    expect(summary.openCount).toBe(2);
    expect(summary.ackedCount).toBe(1);
    expect(summary.warnCount).toBe(2);
    expect(summary.errorCount).toBe(1);
    expect(summary.latestIncidentAt).toBe('2026-03-02T01:10:02.000Z');
  });
});
