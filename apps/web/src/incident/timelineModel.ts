import type { IncomingEvent, IncomingEventSeverity } from '../store/eventStore';
import type { IncidentItem } from './incidentModel';

export type TimelineIncidentStatus = 'none' | 'open' | 'acked';

export type OperationalTimelineItem = {
  eventId: string;
  occurredAt: string;
  eventType: string;
  severity: IncomingEventSeverity;
  workspaceId: string;
  laneId: string;
  sessionId: string;
  agentId: string;
  message: string;
  incidentStatus: TimelineIncidentStatus;
  incidentId: string | null;
};

export type OperationalTimelineSummary = {
  totalItems: number;
  openIncidentItems: number;
  ackedIncidentItems: number;
  activeLanes: number;
  activeSessions: number;
  severityCounts: Record<IncomingEventSeverity, number>;
  latestEventType: string;
  latestOccurredAt: string;
};

export type OperationalTimelineOptions = {
  maxItems?: number;
};

const DEFAULT_MAX_TIMELINE_ITEMS = 24;

export const collectOperationalTimelineFeed = (
  events: IncomingEvent[],
  incidents: readonly IncidentItem[] = [],
  options: OperationalTimelineOptions = {}
): OperationalTimelineItem[] => {
  const incidentByEventId = new Map<string, IncidentItem>();
  for (const incident of incidents) {
    incidentByEventId.set(incident.eventId, incident);
  }

  const timelineItems = events.map<OperationalTimelineItem>((event) => {
    const relatedIncident = incidentByEventId.get(event.eventId);
    return {
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      eventType: event.eventType,
      severity: event.severity,
      workspaceId: event.source.workspaceId,
      laneId: event.source.laneId,
      sessionId: event.source.sessionId,
      agentId: event.source.agentId,
      message: extractTimelineMessage(event),
      incidentStatus: relatedIncident?.status ?? 'none',
      incidentId: relatedIncident?.incidentId ?? null
    };
  });

  timelineItems.sort((left, right) => {
    const timestampDiff = toUnixMs(right.occurredAt) - toUnixMs(left.occurredAt);
    if (timestampDiff !== 0) {
      return timestampDiff;
    }
    return right.eventId.localeCompare(left.eventId);
  });

  const maxItems = normalizeMaxItems(options.maxItems);
  return timelineItems.slice(0, maxItems);
};

export const buildOperationalTimelineSummary = (
  timelineItems: readonly OperationalTimelineItem[]
): OperationalTimelineSummary => {
  const laneIds = new Set<string>();
  const sessionIds = new Set<string>();
  const severityCounts: Record<IncomingEventSeverity, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0
  };
  let openIncidentItems = 0;
  let ackedIncidentItems = 0;

  for (const item of timelineItems) {
    laneIds.add(item.laneId);
    sessionIds.add(item.sessionId);
    severityCounts[item.severity] += 1;

    if (item.incidentStatus === 'open') {
      openIncidentItems += 1;
    } else if (item.incidentStatus === 'acked') {
      ackedIncidentItems += 1;
    }
  }

  return {
    totalItems: timelineItems.length,
    openIncidentItems,
    ackedIncidentItems,
    activeLanes: laneIds.size,
    activeSessions: sessionIds.size,
    severityCounts,
    latestEventType: timelineItems[0]?.eventType ?? 'n/a',
    latestOccurredAt: timelineItems[0]?.occurredAt ?? 'n/a'
  };
};

const toUnixMs = (isoTimestamp: string): number => {
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
};

const normalizeMaxItems = (maxItems: number | undefined): number => {
  if (typeof maxItems !== 'number' || !Number.isFinite(maxItems)) {
    return DEFAULT_MAX_TIMELINE_ITEMS;
  }
  return Math.max(1, Math.floor(maxItems));
};

const extractTimelineMessage = (event: IncomingEvent): string => {
  const payloadMessage = event.payload.message;
  if (typeof payloadMessage === 'string' && payloadMessage.trim().length > 0) {
    return payloadMessage.trim();
  }

  const payloadCommand = event.payload.command;
  if (typeof payloadCommand === 'string' && payloadCommand.trim().length > 0) {
    return payloadCommand.trim();
  }

  const payloadReason = event.payload.reason;
  if (typeof payloadReason === 'string' && payloadReason.trim().length > 0) {
    return payloadReason.trim();
  }

  return event.eventType;
};
