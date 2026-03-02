import { describe, expect, it } from 'vitest';
import type { IncomingEvent } from '../store/eventStore';
import {
  buildSceneDrilldownSummary,
  buildSceneModel,
  collectSceneFilterOptions,
  filterSceneEvents,
  getSceneLodBudget,
  resolveSceneLod
} from './sceneModel';

const makeEvent = (
  id: string,
  overrides: Partial<IncomingEvent> = {}
): IncomingEvent => {
  return {
    version: '1.0',
    eventId: id,
    occurredAt: '2026-03-01T19:00:00.000Z',
    eventType: 'lane.enqueue',
    severity: 'info',
    source: {
      agentId: 'agent-a',
      workspaceId: 'workspace-omnia',
      laneId: 'lane-main',
      sessionId: 'session-1'
    },
    payload: { queueDepth: 1, position: 0 },
    ...overrides
  };
};

describe('sceneModel', () => {
  it('collects workspace, lane and session filter options', () => {
    const events: IncomingEvent[] = [
      makeEvent('1', {
        source: {
          agentId: 'agent-a',
          workspaceId: 'workspace-zeta',
          laneId: 'lane-2',
          sessionId: 'session-z'
        }
      }),
      makeEvent('2', {
        source: {
          agentId: 'agent-b',
          workspaceId: 'workspace-alpha',
          laneId: 'lane-1',
          sessionId: 'session-9'
        }
      })
    ];

    expect(collectSceneFilterOptions(events)).toEqual({
      workspaceIds: ['workspace-alpha', 'workspace-zeta'],
      laneIds: ['lane-1', 'lane-2'],
      sessionIds: ['session-9', 'session-z']
    });
  });

  it('filters by workspace, lane, session, severity and event type query', () => {
    const events: IncomingEvent[] = [
      makeEvent('1', {
        eventType: 'lane.enqueue',
        severity: 'warn',
        source: {
          agentId: 'agent-a',
          workspaceId: 'workspace-omnia',
          laneId: 'lane-main',
          sessionId: 'session-main'
        }
      }),
      makeEvent('2', {
        eventType: 'approval.requested',
        severity: 'error',
        source: {
          agentId: 'agent-b',
          workspaceId: 'workspace-dr-house',
          laneId: 'lane-security',
          sessionId: 'session-security'
        }
      })
    ];

    const filtered = filterSceneEvents(events, {
      workspaceId: 'workspace-dr-house',
      laneId: 'lane-security',
      sessionId: 'session-security',
      severity: 'error',
      eventTypeQuery: 'approval'
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].eventId).toBe('2');
  });

  it('resolves auto lod from event volume', () => {
    expect(resolveSceneLod('auto', 20)).toBe('high');
    expect(resolveSceneLod('auto', 180)).toBe('medium');
    expect(resolveSceneLod('auto', 420)).toBe('low');
    expect(resolveSceneLod('high', 999)).toBe('high');
  });

  it('applies lod budgets when building scene model', () => {
    const events: IncomingEvent[] = [];
    for (let index = 0; index < 90; index += 1) {
      events.push(
        makeEvent(`evt-${index}`, {
          source: {
            agentId: `agent-${index}`,
            workspaceId: `workspace-${index % 20}`,
            laneId: `lane-${index % 30}`,
            sessionId: `session-${index}`
          },
          occurredAt: `2026-03-01T19:${String(index % 60).padStart(2, '0')}:00.000Z`,
          severity: index % 2 === 0 ? 'info' : 'warn'
        })
      );
    }

    const lowLodModel = buildSceneModel(events, 'low');
    const budget = getSceneLodBudget('low');

    expect(lowLodModel.stations.length).toBeLessThanOrEqual(budget.maxStations);
    expect(lowLodModel.tracks.length).toBeLessThanOrEqual(budget.maxTracks);
    expect(lowLodModel.trains.length).toBeLessThanOrEqual(budget.maxTrains);
    expect(lowLodModel.trains.every((train) => train.sessionId.startsWith('session-'))).toBe(true);
  });

  it('builds drilldown summary with latest event and top types', () => {
    const events: IncomingEvent[] = [
      makeEvent('1', {
        occurredAt: '2026-03-01T19:00:01.000Z',
        eventType: 'lane.enqueue',
        severity: 'info',
        source: {
          agentId: 'agent-a',
          workspaceId: 'workspace-omnia',
          laneId: 'lane-main',
          sessionId: 'session-1'
        }
      }),
      makeEvent('2', {
        occurredAt: '2026-03-01T19:00:02.000Z',
        eventType: 'approval.requested',
        severity: 'warn',
        source: {
          agentId: 'agent-b',
          workspaceId: 'workspace-omnia',
          laneId: 'lane-main',
          sessionId: 'session-1'
        }
      }),
      makeEvent('3', {
        occurredAt: '2026-03-01T19:00:03.000Z',
        eventType: 'approval.requested',
        severity: 'error',
        source: {
          agentId: 'agent-c',
          workspaceId: 'workspace-dr-house',
          laneId: 'lane-security',
          sessionId: 'session-2'
        }
      })
    ];

    const summary = buildSceneDrilldownSummary(events, 2);

    expect(summary.totalEvents).toBe(3);
    expect(summary.activeLanes).toBe(2);
    expect(summary.activeSessions).toBe(2);
    expect(summary.activeAgents).toBe(3);
    expect(summary.latestEventType).toBe('approval.requested');
    expect(summary.severityCounts).toEqual({
      debug: 0,
      info: 1,
      warn: 1,
      error: 1
    });
    expect(summary.topEventTypes).toEqual([
      { eventType: 'approval.requested', count: 2 },
      { eventType: 'lane.enqueue', count: 1 }
    ]);
  });
});
