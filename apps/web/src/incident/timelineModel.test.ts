import { describe, expect, it } from 'vitest';
import type { IncidentItem } from './incidentModel';
import type { IncomingEvent } from '../store/eventStore';
import {
  buildOperationalTimelineSummary,
  collectOperationalTimelineFeed
} from './timelineModel';

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

const makeIncident = (
  overrides: Partial<IncidentItem> & Pick<IncidentItem, 'incidentId' | 'eventId'>
): IncidentItem => ({
  incidentId: overrides.incidentId,
  eventId: overrides.eventId,
  occurredAt: '2026-03-02T02:00:00.000Z',
  eventType: 'approval.requested',
  severity: 'warn',
  status: 'open',
  workspaceId: 'workspace-omnia',
  laneId: 'lane-main',
  sessionId: 'session-a',
  agentId: 'agent-1',
  message: 'approval pending',
  ...stripIncidentIdentity(overrides)
});

const stripIncidentIdentity = (
  incident: Partial<IncidentItem> & Pick<IncidentItem, 'incidentId' | 'eventId'>
): Partial<IncidentItem> => {
  const { incidentId: _incidentId, eventId: _eventId, ...rest } = incident;
  return rest;
};

describe('timelineModel', () => {
  it('orders timeline by occurredAt desc and applies maxItems', () => {
    const events: IncomingEvent[] = [
      makeEvent({
        eventId: 'evt-1',
        eventType: 'lane.enqueue',
        occurredAt: '2026-03-02T02:00:01.000Z'
      }),
      makeEvent({
        eventId: 'evt-2',
        eventType: 'approval.requested',
        occurredAt: '2026-03-02T02:00:03.000Z',
        severity: 'warn'
      }),
      makeEvent({
        eventId: 'evt-3',
        eventType: 'security.auth.failed',
        occurredAt: '2026-03-02T02:00:02.000Z',
        severity: 'error'
      })
    ];

    const timeline = collectOperationalTimelineFeed(events, [], { maxItems: 2 });
    expect(timeline).toHaveLength(2);
    expect(timeline.map((item) => item.eventId)).toEqual(['evt-2', 'evt-3']);
  });

  it('maps incident status and messages into timeline context', () => {
    const events: IncomingEvent[] = [
      makeEvent({
        eventId: 'evt-approval',
        eventType: 'approval.requested',
        occurredAt: '2026-03-02T02:10:00.000Z',
        severity: 'warn',
        payload: {
          command: 'deploy --canary'
        }
      }),
      makeEvent({
        eventId: 'evt-render',
        eventType: 'render.tick',
        occurredAt: '2026-03-02T02:10:01.000Z',
        severity: 'info'
      })
    ];
    const incidents: IncidentItem[] = [
      makeIncident({
        incidentId: 'evt-approval',
        eventId: 'evt-approval',
        status: 'acked'
      })
    ];

    const timeline = collectOperationalTimelineFeed(events, incidents);
    const renderItem = timeline.find((item) => item.eventId === 'evt-render');
    const approvalItem = timeline.find((item) => item.eventId === 'evt-approval');

    expect(approvalItem?.incidentStatus).toBe('acked');
    expect(approvalItem?.message).toBe('deploy --canary');
    expect(renderItem?.incidentStatus).toBe('none');
  });

  it('builds summary counters for stream usability indicators', () => {
    const events: IncomingEvent[] = [
      makeEvent({
        eventId: 'evt-a',
        eventType: 'approval.requested',
        occurredAt: '2026-03-02T02:20:01.000Z',
        severity: 'warn'
      }),
      makeEvent({
        eventId: 'evt-b',
        eventType: 'security.auth.failed',
        occurredAt: '2026-03-02T02:20:02.000Z',
        severity: 'error'
      }),
      makeEvent({
        eventId: 'evt-c',
        eventType: 'render.tick',
        occurredAt: '2026-03-02T02:20:00.000Z',
        severity: 'info'
      })
    ];
    const incidents: IncidentItem[] = [
      makeIncident({
        incidentId: 'evt-a',
        eventId: 'evt-a',
        status: 'open'
      }),
      makeIncident({
        incidentId: 'evt-b',
        eventId: 'evt-b',
        status: 'acked'
      })
    ];

    const timeline = collectOperationalTimelineFeed(events, incidents);
    const summary = buildOperationalTimelineSummary(timeline);

    expect(summary.totalItems).toBe(3);
    expect(summary.openIncidentItems).toBe(1);
    expect(summary.ackedIncidentItems).toBe(1);
    expect(summary.severityCounts.warn).toBe(1);
    expect(summary.severityCounts.error).toBe(1);
    expect(summary.latestEventType).toBe('security.auth.failed');
    expect(summary.latestOccurredAt).toBe('2026-03-02T02:20:02.000Z');
  });
});
