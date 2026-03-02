import type { IncomingEvent } from '../store/eventStore';

export type IncidentStatus = 'open' | 'acked';

export type IncidentItem = {
  incidentId: string;
  eventId: string;
  occurredAt: string;
  eventType: string;
  severity: 'warn' | 'error';
  status: IncidentStatus;
  workspaceId: string;
  laneId: string;
  sessionId: string;
  agentId: string;
  message: string;
};

export type IncidentSummary = {
  openCount: number;
  ackedCount: number;
  warnCount: number;
  errorCount: number;
  latestIncidentAt: string;
};

const INCIDENT_EVENT_PREFIXES = ['security.', 'approval.'];

const toUnixMs = (isoTimestamp: string): number => {
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
};

const isIncidentByEventType = (eventType: string): boolean =>
  eventType === 'exec.approval' ||
  INCIDENT_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix));

const resolveIncidentSeverity = (event: IncomingEvent): 'warn' | 'error' | null => {
  if (event.severity === 'error') {
    return 'error';
  }
  if (event.severity === 'warn') {
    return 'warn';
  }
  return isIncidentByEventType(event.eventType) ? 'warn' : null;
};

const extractIncidentMessage = (event: IncomingEvent): string => {
  const message = event.payload.message;
  if (typeof message === 'string' && message.trim() !== '') {
    return message.trim();
  }

  const command = event.payload.command;
  if (typeof command === 'string' && command.trim() !== '') {
    return command.trim();
  }

  return event.eventType;
};

export const collectIncidentFeed = (
  events: IncomingEvent[],
  ackedIncidentIds: readonly string[] = []
): IncidentItem[] => {
  const ackedSet = new Set(ackedIncidentIds);
  const incidents: IncidentItem[] = [];

  for (const event of events) {
    const severity = resolveIncidentSeverity(event);
    if (!severity) {
      continue;
    }

    incidents.push({
      incidentId: event.eventId,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      eventType: event.eventType,
      severity,
      status: ackedSet.has(event.eventId) ? 'acked' : 'open',
      workspaceId: event.source.workspaceId,
      laneId: event.source.laneId,
      sessionId: event.source.sessionId,
      agentId: event.source.agentId,
      message: extractIncidentMessage(event)
    });
  }

  incidents.sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === 'open' ? -1 : 1;
    }
    if (left.severity !== right.severity) {
      return left.severity === 'error' ? -1 : 1;
    }
    return toUnixMs(right.occurredAt) - toUnixMs(left.occurredAt);
  });

  return incidents;
};

export const buildIncidentSummary = (incidents: IncidentItem[]): IncidentSummary => {
  let openCount = 0;
  let ackedCount = 0;
  let warnCount = 0;
  let errorCount = 0;
  let latestIncidentAt = 'n/a';
  let latestTimestamp = 0;

  for (const incident of incidents) {
    if (incident.status === 'open') {
      openCount += 1;
    } else {
      ackedCount += 1;
    }

    if (incident.severity === 'error') {
      errorCount += 1;
    } else {
      warnCount += 1;
    }

    const timestamp = toUnixMs(incident.occurredAt);
    if (timestamp >= latestTimestamp) {
      latestTimestamp = timestamp;
      latestIncidentAt = incident.occurredAt;
    }
  }

  return {
    openCount,
    ackedCount,
    warnCount,
    errorCount,
    latestIncidentAt
  };
};
