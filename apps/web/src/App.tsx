import { useEffect, useMemo, useState } from 'react';
import { useEventSocket } from './hooks/useEventSocket';
import { buildIncidentSummary, collectIncidentFeed } from './incident/incidentModel';
import {
  buildOperationalTimelineSummary,
  collectOperationalTimelineFeed
} from './incident/timelineModel';
import { SceneShell } from './scene/SceneShell';
import {
  DEFAULT_SCENE_FILTERS,
  buildSceneDrilldownSummary,
  collectSceneFilterOptions,
  filterSceneEvents,
  resolveSceneLod,
  type SceneLodPreference
} from './scene/sceneModel';
import { useEventStore } from './store/eventStore';

const App = (): JSX.Element => {
  useEventSocket();

  const events = useEventStore((state) => state.events);
  const connectionState = useEventStore((state) => state.connectionState);
  const clearEvents = useEventStore((state) => state.clearEvents);

  const [workspaceFilter, setWorkspaceFilter] = useState(DEFAULT_SCENE_FILTERS.workspaceId);
  const [laneFilter, setLaneFilter] = useState(DEFAULT_SCENE_FILTERS.laneId);
  const [sessionFilter, setSessionFilter] = useState(DEFAULT_SCENE_FILTERS.sessionId);
  const [severityFilter, setSeverityFilter] = useState(DEFAULT_SCENE_FILTERS.severity);
  const [eventTypeQuery, setEventTypeQuery] = useState(DEFAULT_SCENE_FILTERS.eventTypeQuery);
  const [lodPreference, setLodPreference] = useState<SceneLodPreference>('auto');
  const [ackedIncidentIds, setAckedIncidentIds] = useState<string[]>([]);

  const preSessionFilteredEvents = useMemo(
    () =>
      filterSceneEvents(events, {
        workspaceId: workspaceFilter,
        laneId: laneFilter,
        sessionId: 'all',
        severity: severityFilter,
        eventTypeQuery
      }),
    [events, workspaceFilter, laneFilter, severityFilter, eventTypeQuery]
  );
  const filterOptions = useMemo(() => {
    const allOptions = collectSceneFilterOptions(events);
    const scopedSessionOptions = collectSceneFilterOptions(preSessionFilteredEvents).sessionIds;
    return {
      ...allOptions,
      sessionIds: scopedSessionOptions
    };
  }, [events, preSessionFilteredEvents]);
  const filteredEvents = useMemo(
    () =>
      filterSceneEvents(events, {
        workspaceId: workspaceFilter,
        laneId: laneFilter,
        sessionId: sessionFilter,
        severity: severityFilter,
        eventTypeQuery
      }),
    [events, workspaceFilter, laneFilter, sessionFilter, severityFilter, eventTypeQuery]
  );
  const drilldownSummary = useMemo(() => buildSceneDrilldownSummary(filteredEvents), [filteredEvents]);
  const incidentFeed = useMemo(
    () => collectIncidentFeed(filteredEvents, ackedIncidentIds),
    [filteredEvents, ackedIncidentIds]
  );
  const incidentSummary = useMemo(() => buildIncidentSummary(incidentFeed), [incidentFeed]);
  const timelineFeed = useMemo(
    () => collectOperationalTimelineFeed(filteredEvents, incidentFeed, { maxItems: 14 }),
    [filteredEvents, incidentFeed]
  );
  const timelineSummary = useMemo(
    () => buildOperationalTimelineSummary(timelineFeed),
    [timelineFeed]
  );
  const resolvedLod = resolveSceneLod(lodPreference, filteredEvents.length);

  useEffect(() => {
    if (workspaceFilter !== 'all' && !filterOptions.workspaceIds.includes(workspaceFilter)) {
      setWorkspaceFilter('all');
    }
  }, [workspaceFilter, filterOptions.workspaceIds]);

  useEffect(() => {
    if (laneFilter !== 'all' && !filterOptions.laneIds.includes(laneFilter)) {
      setLaneFilter('all');
    }
  }, [laneFilter, filterOptions.laneIds]);

  useEffect(() => {
    if (sessionFilter !== 'all' && !filterOptions.sessionIds.includes(sessionFilter)) {
      setSessionFilter('all');
    }
  }, [sessionFilter, filterOptions.sessionIds]);

  const handleLaneSelect = (laneId: string): void => {
    setLaneFilter(laneId);
    setSessionFilter('all');
  };

  const handleSessionSelect = (laneId: string, sessionId: string): void => {
    setLaneFilter(laneId);
    setSessionFilter(sessionId);
  };

  const acknowledgeIncident = (incidentId: string): void => {
    setAckedIncidentIds((current) => (current.includes(incidentId) ? current : [...current, incidentId]));
  };

  const acknowledgeVisibleIncidents = (): void => {
    setAckedIncidentIds((current) => {
      const next = new Set(current);
      for (const incident of incidentFeed) {
        next.add(incident.incidentId);
      }
      return [...next];
    });
  };

  const clearAcknowledgedIncidents = (): void => {
    setAckedIncidentIds((current) => {
      const visibleSet = new Set(incidentFeed.map((incident) => incident.incidentId));
      return current.filter((incidentId) => !visibleSet.has(incidentId));
    });
  };

  const clearAllEventsAndIncidents = (): void => {
    clearEvents();
    setAckedIncidentIds([]);
  };

  return (
    <div className="app-root">
      <header className="hud">
        <h1>Grand Central</h1>
        <p>
          Connection: <span data-state={connectionState}>{connectionState}</span>
        </p>
        <p>Incoming events: {events.length}</p>
        <p>Filtered events: {filteredEvents.length}</p>
        <p>Active LOD: {resolvedLod}</p>

        <label className="hud-control">
          Workspace
          <select value={workspaceFilter} onChange={(event) => setWorkspaceFilter(event.target.value)}>
            <option value="all">All workspaces</option>
            {filterOptions.workspaceIds.map((workspaceId) => (
              <option key={workspaceId} value={workspaceId}>
                {workspaceId}
              </option>
            ))}
          </select>
        </label>

        <label className="hud-control">
          Lane
          <select
            value={laneFilter}
            onChange={(event) => {
              setLaneFilter(event.target.value);
              setSessionFilter('all');
            }}
          >
            <option value="all">All lanes</option>
            {filterOptions.laneIds.map((laneId) => (
              <option key={laneId} value={laneId}>
                {laneId}
              </option>
            ))}
          </select>
        </label>

        <label className="hud-control">
          Session
          <select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}>
            <option value="all">All sessions</option>
            {filterOptions.sessionIds.map((sessionId) => (
              <option key={sessionId} value={sessionId}>
                {sessionId}
              </option>
            ))}
          </select>
        </label>

        <label className="hud-control">
          Severity
          <select
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value as typeof severityFilter)}
          >
            <option value="all">All severities</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
        </label>

        <label className="hud-control">
          Event type contains
          <input
            value={eventTypeQuery}
            onChange={(event) => setEventTypeQuery(event.target.value)}
            placeholder="lane.enqueue"
          />
        </label>

        <label className="hud-control">
          LOD
          <select
            value={lodPreference}
            onChange={(event) => setLodPreference(event.target.value as SceneLodPreference)}
          >
            <option value="auto">auto</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </label>

        <section className="hud-card">
          <h2>
            Drill-down: {sessionFilter !== 'all' ? sessionFilter : laneFilter !== 'all' ? laneFilter : 'global'}
          </h2>
          <p>Active lanes: {drilldownSummary.activeLanes}</p>
          <p>Active sessions: {drilldownSummary.activeSessions}</p>
          <p>Active agents: {drilldownSummary.activeAgents}</p>
          <p>
            Latest: {drilldownSummary.latestEventType} @ {drilldownSummary.latestOccurredAt}
          </p>
          <p>
            Severities d/i/w/e: {drilldownSummary.severityCounts.debug}/
            {drilldownSummary.severityCounts.info}/
            {drilldownSummary.severityCounts.warn}/
            {drilldownSummary.severityCounts.error}
          </p>
          <p>
            Top events:{' '}
            {drilldownSummary.topEventTypes.length > 0
              ? drilldownSummary.topEventTypes.map((item) => `${item.eventType} (${item.count})`).join(', ')
              : 'n/a'}
          </p>
        </section>

        <section className="hud-card incident-card">
          <h2>Incident Ops</h2>
          <p>
            Open/Acked: {incidentSummary.openCount}/{incidentSummary.ackedCount}
          </p>
          <p>
            Warn/Error: {incidentSummary.warnCount}/{incidentSummary.errorCount}
          </p>
          <p>Latest incident: {incidentSummary.latestIncidentAt}</p>
          <div className="incident-actions">
            <button type="button" onClick={acknowledgeVisibleIncidents}>
              Ack visible
            </button>
            <button type="button" onClick={clearAcknowledgedIncidents}>
              Clear acked
            </button>
          </div>
          <div className="incident-list" role="list" aria-label="incident-list">
            {incidentFeed.length === 0 ? (
              <p className="incident-empty">No incidents in current filter scope.</p>
            ) : (
              incidentFeed.slice(0, 8).map((incident) => (
                <article
                  key={incident.incidentId}
                  role="listitem"
                  className="incident-item"
                  data-severity={incident.severity}
                  data-status={incident.status}
                >
                  <header>
                    <strong>{incident.eventType}</strong>
                    <span>{incident.status}</span>
                  </header>
                  <p>{incident.message}</p>
                  <p>
                    lane/session: {incident.laneId}/{incident.sessionId}
                  </p>
                  <p>
                    agent: {incident.agentId} @ {incident.occurredAt}
                  </p>
                  <div className="incident-actions">
                    <button type="button" onClick={() => handleSessionSelect(incident.laneId, incident.sessionId)}>
                      Focus
                    </button>
                    <button
                      type="button"
                      onClick={() => acknowledgeIncident(incident.incidentId)}
                      disabled={incident.status === 'acked'}
                    >
                      {incident.status === 'acked' ? 'Acked' : 'Ack'}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="hud-card timeline-card">
          <h2>Ops Timeline</h2>
          <p>
            Visible/Open/Acked: {timelineSummary.totalItems}/
            {timelineSummary.openIncidentItems}/{timelineSummary.ackedIncidentItems}
          </p>
          <p>
            Active lanes/sessions: {timelineSummary.activeLanes}/{timelineSummary.activeSessions}
          </p>
          <p>
            Severity d/i/w/e: {timelineSummary.severityCounts.debug}/
            {timelineSummary.severityCounts.info}/
            {timelineSummary.severityCounts.warn}/
            {timelineSummary.severityCounts.error}
          </p>
          <p>
            Latest: {timelineSummary.latestEventType} @ {timelineSummary.latestOccurredAt}
          </p>
          <div className="timeline-list" role="list" aria-label="timeline-list">
            {timelineFeed.length === 0 ? (
              <p className="timeline-empty">No timeline events in current filter scope.</p>
            ) : (
              timelineFeed.map((item) => (
                <article
                  key={item.eventId}
                  role="listitem"
                  className="timeline-item"
                  data-severity={item.severity}
                  data-incident={item.incidentStatus}
                >
                  <header>
                    <strong>{item.eventType}</strong>
                    <span>{item.incidentStatus}</span>
                  </header>
                  <p>{item.message}</p>
                  <p>
                    lane/session: {item.laneId}/{item.sessionId}
                  </p>
                  <p>
                    agent: {item.agentId} @ {item.occurredAt}
                  </p>
                  <div className="timeline-actions">
                    <button type="button" onClick={() => handleLaneSelect(item.laneId)}>
                      Focus lane
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSessionSelect(item.laneId, item.sessionId)}
                    >
                      Focus session
                    </button>
                    <button
                      type="button"
                      disabled={item.incidentStatus !== 'open'}
                      onClick={() => {
                        if (item.incidentId) {
                          acknowledgeIncident(item.incidentId);
                        }
                      }}
                    >
                      {item.incidentStatus === 'open'
                        ? 'Ack'
                        : item.incidentStatus === 'acked'
                          ? 'Acked'
                          : 'No incident'}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <button type="button" onClick={clearAllEventsAndIncidents}>
          Clear events
        </button>
      </header>
      <SceneShell
        events={filteredEvents}
        lodPreference={lodPreference}
        selectedLaneId={laneFilter}
        selectedSessionId={sessionFilter}
        onSelectLane={handleLaneSelect}
        onSelectSession={handleSessionSelect}
      />
    </div>
  );
};

export default App;
