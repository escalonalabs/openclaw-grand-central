#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

SNAPSHOT_PATH="${1:-${ROOT_DIR}/artifacts/benchmark/synthetic-load-latest.json}"
RUN_ID="${2:-$(basename "${SNAPSHOT_PATH}" | sed -E 's/^synthetic-load-([^.]+)\.json$/\1/' || true)}"
if [ -z "${RUN_ID}" ] || [ "${RUN_ID}" = "$(basename "${SNAPSHOT_PATH}")" ]; then
  RUN_ID="$(date -u +"%Y%m%dT%H%M%SZ")"
fi

export BUDGET_MIN_EVENTS_TOTAL="${BUDGET_MIN_EVENTS_TOTAL:-32}"
export BUDGET_MIN_DROPPED_EVENTS="${BUDGET_MIN_DROPPED_EVENTS:-1}"
export BUDGET_MAX_DROPPED_EVENTS="${BUDGET_MAX_DROPPED_EVENTS:-160}"
export BUDGET_MAX_TOTAL_P95_MS="${BUDGET_MAX_TOTAL_P95_MS:-400}"
export BUDGET_MAX_CRITICAL_P99_MS="${BUDGET_MAX_CRITICAL_P99_MS:-500}"
export BUDGET_MAX_QUEUE_DEPTH="${BUDGET_MAX_QUEUE_DEPTH:-1}"
export BUDGET_MIN_ACTIVE_LANES="${BUDGET_MIN_ACTIVE_LANES:-4}"
export BUDGET_MIN_CRITICAL_LANE_EVENTS="${BUDGET_MIN_CRITICAL_LANE_EVENTS:-1}"
export BUDGET_MIN_BEST_EFFORT_LANE_EVENTS="${BUDGET_MIN_BEST_EFFORT_LANE_EVENTS:-1}"

REPORT_PATH="${ROOT_DIR}/artifacts/benchmark/synthetic-load-budget-report-${RUN_ID}.md"
LATEST_REPORT_PATH="${ROOT_DIR}/artifacts/benchmark/synthetic-load-budget-report-latest.md"

log() {
  printf '[verify:synthetic-load-budgets] %s\n' "$1"
}

if [ ! -s "${SNAPSHOT_PATH}" ]; then
  log "snapshot missing or empty: ${SNAPSHOT_PATH}"
  exit 1
fi

mkdir -p "${ROOT_DIR}/artifacts/benchmark"

node --input-type=module -e '
import fs from "node:fs";

const snapshotPath = process.argv[1];
const reportPath = process.argv[2];

const budgets = {
  minEventsTotal: Number(process.env.BUDGET_MIN_EVENTS_TOTAL ?? "32"),
  minDroppedEvents: Number(process.env.BUDGET_MIN_DROPPED_EVENTS ?? "1"),
  maxDroppedEvents: Number(process.env.BUDGET_MAX_DROPPED_EVENTS ?? "160"),
  maxTotalP95Ms: Number(process.env.BUDGET_MAX_TOTAL_P95_MS ?? "400"),
  maxCriticalP99Ms: Number(process.env.BUDGET_MAX_CRITICAL_P99_MS ?? "500"),
  maxQueueDepth: Number(process.env.BUDGET_MAX_QUEUE_DEPTH ?? "1"),
  minActiveLanes: Number(process.env.BUDGET_MIN_ACTIVE_LANES ?? "4"),
  minCriticalLaneEvents: Number(process.env.BUDGET_MIN_CRITICAL_LANE_EVENTS ?? "1"),
  minBestEffortLaneEvents: Number(process.env.BUDGET_MIN_BEST_EFFORT_LANE_EVENTS ?? "1"),
};

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const laneTotals = snapshot.bridge_events_lane_total ?? {};
const activeLanes = Object.keys(laneTotals).length;
const criticalLaneEvents = Object.entries(laneTotals)
  .filter(([lane]) => lane.includes("critical"))
  .reduce((sum, [, value]) => sum + Number(value ?? 0), 0);
const bestEffortLaneEvents = Object.entries(laneTotals)
  .filter(([lane]) => lane.includes("best"))
  .reduce((sum, [, value]) => sum + Number(value ?? 0), 0);
const observed = {
  bridgeEventsTotal: Number(snapshot.bridge_events_total ?? 0),
  droppedEvents: Number(snapshot.droppedEvents ?? 0),
  queueDepth: Number(snapshot.queueDepth ?? 0),
  totalP95Ms: Number(snapshot.bridge_event_e2e_latency_ms?.total?.p95 ?? 0),
  criticalP99Ms: Number(snapshot.bridge_event_e2e_latency_ms?.by_qos?.critical?.p99 ?? 0),
  activeLanes,
  criticalLaneEvents,
  bestEffortLaneEvents,
};

const checks = [
  {
    name: "bridge_events_total",
    pass: observed.bridgeEventsTotal >= budgets.minEventsTotal,
    expected: `>= ${budgets.minEventsTotal}`,
    observed: observed.bridgeEventsTotal,
  },
  {
    name: "droppedEvents_min_pressure",
    pass: observed.droppedEvents >= budgets.minDroppedEvents,
    expected: `>= ${budgets.minDroppedEvents}`,
    observed: observed.droppedEvents,
  },
  {
    name: "droppedEvents_max_budget",
    pass: observed.droppedEvents <= budgets.maxDroppedEvents,
    expected: `<= ${budgets.maxDroppedEvents}`,
    observed: observed.droppedEvents,
  },
  {
    name: "queueDepth",
    pass: observed.queueDepth <= budgets.maxQueueDepth,
    expected: `<= ${budgets.maxQueueDepth}`,
    observed: observed.queueDepth,
  },
  {
    name: "total_p95_ms",
    pass: observed.totalP95Ms <= budgets.maxTotalP95Ms,
    expected: `<= ${budgets.maxTotalP95Ms}`,
    observed: observed.totalP95Ms,
  },
  {
    name: "critical_p99_ms",
    pass: observed.criticalP99Ms <= budgets.maxCriticalP99Ms,
    expected: `<= ${budgets.maxCriticalP99Ms}`,
    observed: observed.criticalP99Ms,
  },
  {
    name: "active_lanes",
    pass: observed.activeLanes >= budgets.minActiveLanes,
    expected: `>= ${budgets.minActiveLanes}`,
    observed: observed.activeLanes,
  },
  {
    name: "critical_lane_events",
    pass: observed.criticalLaneEvents >= budgets.minCriticalLaneEvents,
    expected: `>= ${budgets.minCriticalLaneEvents}`,
    observed: observed.criticalLaneEvents,
  },
  {
    name: "best_effort_lane_events",
    pass: observed.bestEffortLaneEvents >= budgets.minBestEffortLaneEvents,
    expected: `>= ${budgets.minBestEffortLaneEvents}`,
    observed: observed.bestEffortLaneEvents,
  },
];

const failed = checks.filter((item) => !item.pass);
const lines = [
  "# Synthetic Load Budget Verification",
  "",
  `- Snapshot: ${snapshotPath}`,
  `- Timestamp (UTC): ${new Date().toISOString()}`,
  "",
  "## Budget checks",
  "",
  "| Check | Expected | Observed | Status |",
  "|---|---|---|---|",
  ...checks.map((item) => `| ${item.name} | ${item.expected} | ${item.observed} | ${item.pass ? "pass" : "fail"} |`),
];

if (failed.length > 0) {
  lines.push("", "## Result", "", "fail");
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  const details = failed
    .map((item) => `${item.name}: expected ${item.expected}, observed ${item.observed}`)
    .join("; ");
  throw new Error(`synthetic load budgets failed: ${details}`);
}

lines.push("", "## Result", "", "pass");
fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
' "${SNAPSHOT_PATH}" "${REPORT_PATH}"

if [ "${REPORT_PATH}" != "${LATEST_REPORT_PATH}" ]; then
  cp "${REPORT_PATH}" "${LATEST_REPORT_PATH}"
fi

log "Synthetic load budgets verification passed"
log "Report: ${REPORT_PATH}"
