#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

SNAPSHOT_PATH="${1:-${ROOT_DIR}/artifacts/observability/metrics-snapshot.json}"
BUNDLE_PATH="${2:-${ROOT_DIR}/artifacts/observability/slo-bundle.json}"
SUMMARY_PATH="${3:-${ROOT_DIR}/artifacts/observability/slo-executive-summary.md}"
PROFILE="${SLO_BUNDLE_PROFILE:-default}"

if [ ! -s "${SNAPSHOT_PATH}" ]; then
  printf '[evaluate:slo-bundle] snapshot missing or empty: %s\n' "${SNAPSHOT_PATH}" >&2
  exit 1
fi

mkdir -p "$(dirname "${BUNDLE_PATH}")"
mkdir -p "$(dirname "${SUMMARY_PATH}")"

node --input-type=module -e '
import fs from "node:fs";

const snapshotPath = process.argv[1];
const bundlePath = process.argv[2];
const summaryPath = process.argv[3];
const profile = process.argv[4];
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getPath = (root, path, fallback = 0) => {
  let node = root;
  for (const key of path) {
    if (node === null || typeof node !== "object" || !(key in node)) {
      return fallback;
    }
    node = node[key];
  }
  return toNumber(node, fallback);
};

const totalP95Ms = getPath(snapshot, ["bridge_event_e2e_latency_ms", "total", "p95"]);
const criticalP99Ms = getPath(snapshot, ["bridge_event_e2e_latency_ms", "by_qos", "critical", "p99"]);
const criticalTotal = getPath(snapshot, ["bridge_events_qos_total", "critical"]);
const criticalFailures = getPath(snapshot, ["bridge_critical_delivery_failures_total"]);
const criticalReliabilityPct = criticalTotal <= 0
  ? 100
  : Math.max(0, Math.min(100, (1 - criticalFailures / criticalTotal) * 100));

const objectives = [
  {
    id: "slo_bridge_total_latency_p95",
    title: "Total e2e latency p95",
    unit: "ms",
    comparator: "<=",
    target: 100,
    observed: totalP95Ms,
    severity: "warn",
  },
  {
    id: "slo_bridge_critical_latency_p99",
    title: "Critical e2e latency p99",
    unit: "ms",
    comparator: "<=",
    target: 250,
    observed: criticalP99Ms,
    severity: "critical",
  },
  {
    id: "slo_bridge_critical_delivery_reliability",
    title: "Critical delivery reliability",
    unit: "%",
    comparator: ">=",
    target: 99.9,
    observed: Number(criticalReliabilityPct.toFixed(3)),
    severity: "critical",
  },
].map((objective) => {
  const pass =
    objective.comparator === "<="
      ? objective.observed <= objective.target
      : objective.observed >= objective.target;
  const delta = Number((objective.observed - objective.target).toFixed(3));
  return {
    ...objective,
    status: pass ? "pass" : "fail",
    delta,
  };
});

const failedObjectives = objectives.filter((item) => item.status === "fail");
const passedObjectives = objectives.length - failedObjectives.length;
const healthScore = Number(((passedObjectives / objectives.length) * 100).toFixed(1));
const overallStatus = failedObjectives.length > 0 ? "breach" : "healthy";

const laneTotals = snapshot.bridge_events_lane_total ?? {};
const topLanes = Object.entries(laneTotals)
  .map(([laneId, events]) => ({ laneId, events: toNumber(events) }))
  .sort((left, right) => right.events - left.events || left.laneId.localeCompare(right.laneId))
  .slice(0, 5);

const sessionTotals = snapshot.bridge_events_session_total ?? {};
const topSessions = Object.entries(sessionTotals)
  .map(([sessionId, events]) => ({ sessionId, events: toNumber(events) }))
  .sort((left, right) => right.events - left.events || left.sessionId.localeCompare(right.sessionId))
  .slice(0, 5);

const security = {
  authnFailuresTotal: getPath(snapshot, ["bridge_authn_failures_total"]),
  authzDeniesTotal: getPath(snapshot, ["bridge_authz_denies_total"]),
  redactionFailuresTotal: getPath(snapshot, ["bridge_redaction_failures_total"]),
  actionGateDenyTotal: getPath(snapshot, ["bridge_action_gate_decisions_total", "deny"]),
};

const queue = {
  droppedEvents: getPath(snapshot, ["droppedEvents"]),
  queueDepth: getPath(snapshot, ["queueDepth"]),
  connectedClients: getPath(snapshot, ["connectedClients"]),
};

const throughput = {
  eventsTotal: getPath(snapshot, ["bridge_events_total"]),
  criticalEvents: getPath(snapshot, ["bridge_events_qos_total", "critical"]),
  statefulEvents: getPath(snapshot, ["bridge_events_qos_total", "stateful"]),
  bestEffortEvents: getPath(snapshot, ["bridge_events_qos_total", "best_effort"]),
  activeLanes: Object.keys(laneTotals).length,
  activeSessions: Object.keys(sessionTotals).length,
};

const headline =
  overallStatus === "healthy"
    ? `SLO bundle healthy (${passedObjectives}/${objectives.length} objetivos en cumplimiento)`
    : `SLO bundle breached (${failedObjectives.length} objetivo(s) fuera de SLO)`;

const keyRisks = failedObjectives.map((item) => ({
  objectiveId: item.id,
  severity: item.severity,
  observed: item.observed,
  target: item.target,
  comparator: item.comparator,
  delta: item.delta,
}));

const bundle = {
  generatedAt: new Date().toISOString(),
  profile,
  snapshotPath,
  sloBundle: {
    overallStatus,
    healthScore,
    objectivesTotal: objectives.length,
    objectivesPassed: passedObjectives,
    objectivesFailed: failedObjectives.length,
    objectives,
  },
  executiveSummary: {
    headline,
    keyRisks,
    topLanes,
    topSessions,
    security,
    queue,
  },
  dashboard: {
    throughput,
    latency: {
      totalP95Ms,
      criticalP99Ms,
      criticalReliabilityPct: Number(criticalReliabilityPct.toFixed(3)),
    },
    security,
    queue,
    coverage: {
      lanes: laneTotals,
      sessions: sessionTotals,
    },
  },
};

fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));

const summaryLines = [
  "# Observability SLO Executive Summary",
  "",
  `- Generated at: ${bundle.generatedAt}`,
  `- Profile: ${profile}`,
  `- Snapshot: ${snapshotPath}`,
  `- Overall status: ${overallStatus}`,
  `- Health score: ${healthScore}%`,
  "",
  "## SLO objectives",
  "",
  "| Objective | Target | Observed | Status |",
  "|---|---|---|---|",
  ...objectives.map((objective) =>
    `| ${objective.title} | ${objective.comparator} ${objective.target}${objective.unit} | ${objective.observed}${objective.unit} | ${objective.status} |`,
  ),
  "",
  "## Top lanes",
  "",
  ...(topLanes.length === 0
    ? ["- no lane traffic observed"]
    : topLanes.map((item) => `- ${item.laneId}: ${item.events}`)),
  "",
  "## Top sessions",
  "",
  ...(topSessions.length === 0
    ? ["- no session traffic observed"]
    : topSessions.map((item) => `- ${item.sessionId}: ${item.events}`)),
  "",
  "## Security/queue signals",
  "",
  `- authn failures: ${security.authnFailuresTotal}`,
  `- authz denies: ${security.authzDeniesTotal}`,
  `- redaction failures: ${security.redactionFailuresTotal}`,
  `- action gate denies: ${security.actionGateDenyTotal}`,
  `- dropped events: ${queue.droppedEvents}`,
  `- queue depth: ${queue.queueDepth}`,
  `- connected clients: ${queue.connectedClients}`,
];

fs.writeFileSync(summaryPath, `${summaryLines.join("\n")}\n`);
' "${SNAPSHOT_PATH}" "${BUNDLE_PATH}" "${SUMMARY_PATH}" "${PROFILE}"

printf '[evaluate:slo-bundle] wrote %s\n' "${BUNDLE_PATH}"
printf '[evaluate:slo-bundle] wrote %s\n' "${SUMMARY_PATH}"
