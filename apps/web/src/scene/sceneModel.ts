import type { IncomingEvent, IncomingEventSeverity } from '../store/eventStore';

export type SceneLodPreference = 'auto' | 'high' | 'medium' | 'low';
export type SceneLodLevel = Exclude<SceneLodPreference, 'auto'>;

export type SceneFilters = {
  workspaceId: string;
  laneId: string;
  sessionId: string;
  severity: 'all' | IncomingEventSeverity;
  eventTypeQuery: string;
};

export type SceneFilterOptions = {
  workspaceIds: string[];
  laneIds: string[];
  sessionIds: string[];
};

export type SceneLodBudget = {
  maxStations: number;
  maxTracks: number;
  maxTrains: number;
  showLabels: boolean;
};

export type StationNode = {
  workspaceId: string;
  eventCount: number;
  position: [number, number, number];
};

export type TrackNode = {
  laneId: string;
  workspaceId: string;
  eventCount: number;
  radius: number;
  position: [number, number, number];
  color: string;
};

export type TrainNode = {
  agentId: string;
  workspaceId: string;
  laneId: string;
  sessionId: string;
  eventType: string;
  severity: IncomingEventSeverity;
  position: [number, number, number];
  color: string;
};

export type SceneModel = {
  stations: StationNode[];
  tracks: TrackNode[];
  trains: TrainNode[];
};

export type SceneDrilldownSummary = {
  totalEvents: number;
  activeLanes: number;
  activeSessions: number;
  activeAgents: number;
  latestEventType: string;
  latestOccurredAt: string;
  severityCounts: Record<IncomingEventSeverity, number>;
  topEventTypes: Array<{ eventType: string; count: number }>;
};

const SEVERITY_COLOR: Record<IncomingEventSeverity, string> = {
  debug: '#64748b',
  info: '#38bdf8',
  warn: '#f59e0b',
  error: '#ef4444'
};

const TRACK_PALETTE = ['#334155', '#475569', '#0f766e', '#0369a1', '#4c1d95'];

export const DEFAULT_SCENE_FILTERS: SceneFilters = {
  workspaceId: 'all',
  laneId: 'all',
  sessionId: 'all',
  severity: 'all',
  eventTypeQuery: ''
};

export const collectSceneFilterOptions = (events: IncomingEvent[]): SceneFilterOptions => {
  const workspaceIds = new Set<string>();
  const laneIds = new Set<string>();
  const sessionIds = new Set<string>();

  for (const event of events) {
    workspaceIds.add(event.source.workspaceId);
    laneIds.add(event.source.laneId);
    sessionIds.add(event.source.sessionId);
  }

  return {
    workspaceIds: [...workspaceIds].sort(),
    laneIds: [...laneIds].sort(),
    sessionIds: [...sessionIds].sort()
  };
};

export const filterSceneEvents = (events: IncomingEvent[], filters: SceneFilters): IncomingEvent[] => {
  const query = filters.eventTypeQuery.trim().toLowerCase();

  return events.filter((event) => {
    if (filters.workspaceId !== 'all' && event.source.workspaceId !== filters.workspaceId) {
      return false;
    }

    if (filters.laneId !== 'all' && event.source.laneId !== filters.laneId) {
      return false;
    }

    if (filters.sessionId !== 'all' && event.source.sessionId !== filters.sessionId) {
      return false;
    }

    if (filters.severity !== 'all' && event.severity !== filters.severity) {
      return false;
    }

    if (query.length > 0 && !event.eventType.toLowerCase().includes(query)) {
      return false;
    }

    return true;
  });
};

export const resolveSceneLod = (
  preference: SceneLodPreference,
  filteredEventCount: number
): SceneLodLevel => {
  if (preference !== 'auto') {
    return preference;
  }

  if (filteredEventCount >= 300) {
    return 'low';
  }

  if (filteredEventCount >= 120) {
    return 'medium';
  }

  return 'high';
};

export const getSceneLodBudget = (lod: SceneLodLevel): SceneLodBudget => {
  if (lod === 'low') {
    return {
      maxStations: 10,
      maxTracks: 20,
      maxTrains: 24,
      showLabels: false
    };
  }

  if (lod === 'medium') {
    return {
      maxStations: 16,
      maxTracks: 40,
      maxTrains: 48,
      showLabels: false
    };
  }

  return {
    maxStations: 24,
    maxTracks: 72,
    maxTrains: 96,
    showLabels: true
  };
};

export const buildSceneModel = (events: IncomingEvent[], lod: SceneLodLevel): SceneModel => {
  const budget = getSceneLodBudget(lod);
  const stationCounts = new Map<string, number>();
  const laneState = new Map<string, { workspaceId: string; eventCount: number }>();
  const agentState = new Map<
    string,
    {
      workspaceId: string;
      laneId: string;
      sessionId: string;
      eventType: string;
      severity: IncomingEventSeverity;
      occurredAtMs: number;
    }
  >();

  for (const event of events) {
    const workspaceId = event.source.workspaceId;
    const laneId = event.source.laneId;
    const sessionId = event.source.sessionId;
    const agentId = event.source.agentId;

    stationCounts.set(workspaceId, (stationCounts.get(workspaceId) ?? 0) + 1);

    const laneData = laneState.get(laneId);
    if (laneData) {
      laneData.eventCount += 1;
    } else {
      laneState.set(laneId, {
        workspaceId,
        eventCount: 1
      });
    }

    const occurredAtMs = Date.parse(event.occurredAt);
    const previous = agentState.get(agentId);
    if (!previous || occurredAtMs >= previous.occurredAtMs) {
      agentState.set(agentId, {
        workspaceId,
        laneId,
        sessionId,
        eventType: event.eventType,
        severity: event.severity,
        occurredAtMs: Number.isFinite(occurredAtMs) ? occurredAtMs : 0
      });
    }
  }

  const orderedStations = [...stationCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, budget.maxStations);

  const stationIndex = new Map<string, number>();
  const stations = orderedStations.map(([workspaceId, eventCount], index) => {
    stationIndex.set(workspaceId, index);
    return {
      workspaceId,
      eventCount,
      position: stationPosition(index, orderedStations.length)
    };
  });

  const orderedTracks = [...laneState.entries()]
    .filter(([, lane]) => stationIndex.has(lane.workspaceId))
    .sort((left, right) => right[1].eventCount - left[1].eventCount || left[0].localeCompare(right[0]))
    .slice(0, budget.maxTracks);

  const tracks = orderedTracks.map(([laneId, lane], index) => {
    const stationNode = stations[stationIndex.get(lane.workspaceId) ?? 0];
    const radius = 1.1 + (index % 5) * 0.16;
    return {
      laneId,
      workspaceId: lane.workspaceId,
      eventCount: lane.eventCount,
      radius,
      position: stationNode.position,
      color: TRACK_PALETTE[index % TRACK_PALETTE.length]
    };
  });

  const trackByLane = new Map<string, TrackNode>();
  for (const track of tracks) {
    trackByLane.set(track.laneId, track);
  }

  const trains = [...agentState.entries()]
    .filter(([, value]) => trackByLane.has(value.laneId))
    .sort((left, right) => right[1].occurredAtMs - left[1].occurredAtMs || left[0].localeCompare(right[0]))
    .slice(0, budget.maxTrains)
    .map(([agentId, value]) => {
      const track = trackByLane.get(value.laneId) as TrackNode;
      const seed = `${agentId}:${value.eventType}:${value.occurredAtMs}`;
      const theta = hashToUnit(seed) * Math.PI * 2;
      const x = track.position[0] + Math.cos(theta) * track.radius;
      const z = track.position[2] + Math.sin(theta) * track.radius;
      return {
        agentId,
        workspaceId: value.workspaceId,
        laneId: value.laneId,
        sessionId: value.sessionId,
        eventType: value.eventType,
        severity: value.severity,
        position: [x, 0.25, z] as [number, number, number],
        color: SEVERITY_COLOR[value.severity]
      };
    });

  return {
    stations,
    tracks,
    trains
  };
};

export const buildSceneDrilldownSummary = (
  events: IncomingEvent[],
  topEventTypesLimit = 3
): SceneDrilldownSummary => {
  const laneIds = new Set<string>();
  const sessionIds = new Set<string>();
  const agentIds = new Set<string>();
  const severityCounts: Record<IncomingEventSeverity, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0
  };
  const eventTypeCounts = new Map<string, number>();
  let latestOccurredAtMs = Number.NEGATIVE_INFINITY;
  let latestOccurredAt = 'n/a';
  let latestEventType = 'n/a';

  for (const event of events) {
    laneIds.add(event.source.laneId);
    sessionIds.add(event.source.sessionId);
    agentIds.add(event.source.agentId);
    severityCounts[event.severity] += 1;
    eventTypeCounts.set(event.eventType, (eventTypeCounts.get(event.eventType) ?? 0) + 1);

    const occurredAtMs = Date.parse(event.occurredAt);
    if (Number.isFinite(occurredAtMs) && occurredAtMs >= latestOccurredAtMs) {
      latestOccurredAtMs = occurredAtMs;
      latestOccurredAt = event.occurredAt;
      latestEventType = event.eventType;
    }
  }

  const topEventTypes = [...eventTypeCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(1, topEventTypesLimit))
    .map(([eventType, count]) => ({ eventType, count }));

  return {
    totalEvents: events.length,
    activeLanes: laneIds.size,
    activeSessions: sessionIds.size,
    activeAgents: agentIds.size,
    latestEventType,
    latestOccurredAt,
    severityCounts,
    topEventTypes
  };
};

const stationPosition = (index: number, total: number): [number, number, number] => {
  if (total <= 0) {
    return [0, 0.45, 0];
  }

  const columns = Math.ceil(Math.sqrt(total));
  const row = Math.floor(index / columns);
  const column = index % columns;
  const spacing = 6;
  const x = (column - (columns - 1) / 2) * spacing;
  const z = (row - (Math.ceil(total / columns) - 1) / 2) * spacing;
  return [x, 0.45, z];
};

const hashToUnit = (input: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const normalized = (hash >>> 0) / 4294967295;
  return normalized;
};
