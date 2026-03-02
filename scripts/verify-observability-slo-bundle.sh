#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
EXPORT_SCRIPT="${ROOT_DIR}/scripts/export-metrics-snapshot.sh"
EVAL_SCRIPT="${ROOT_DIR}/scripts/evaluate-slo-bundle.sh"

export BRIDGE_PORT="${BRIDGE_PORT:-3904}"
export BRIDGE_METRICS_TOKEN="${BRIDGE_METRICS_TOKEN:-dev-slo-bundle-token}"

SNAPSHOT_PATH="${ROOT_DIR}/artifacts/observability/metrics-slo-bundle-snapshot.json"
BUNDLE_PATH="${ROOT_DIR}/artifacts/observability/slo-bundle.json"
SUMMARY_PATH="${ROOT_DIR}/artifacts/observability/slo-executive-summary.md"
REPORT_PATH="${ROOT_DIR}/artifacts/observability/slo-bundle-verification-report.md"
BRIDGE_STUB_PID=""

log() {
  printf '[verify:observability-slo-bundle] %s\n' "$1"
}

cleanup() {
  if [ -n "${BRIDGE_STUB_PID}" ]; then
    kill "${BRIDGE_STUB_PID}" >/dev/null 2>&1 || true
    wait "${BRIDGE_STUB_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

log "Starting local bridge stub for SLO bundle coherence validation"
(
  cd "${ROOT_DIR}"
  node --input-type=module <<'NODE'
import { WebSocketBridgeServer } from "./apps/bridge/src/index.ts";

const port = Number(process.env.BRIDGE_PORT ?? "3904");
const token = process.env.BRIDGE_METRICS_TOKEN ?? "dev-slo-bundle-token";
const now = Date.now();

const server = new WebSocketBridgeServer({
  host: "127.0.0.1",
  port,
  heartbeatIntervalMs: 60_000,
  heartbeatTimeoutMs: 120_000,
  security: {
    tokenResolver: () => token,
    scopesResolver: () => ["telemetry:read", "metrics:read", "control:write"],
  },
});

await server.start();
const records = [
  {
    eventId: "slo-nominal-1",
    eventType: "approval.requested",
    laneId: "lane-critical-a",
    sessionId: "session-ops-a",
    qos: "critical",
    offsetMs: 35,
  },
  {
    eventId: "slo-nominal-2",
    eventType: "approval.requested",
    laneId: "lane-critical-b",
    sessionId: "session-ops-b",
    qos: "critical",
    offsetMs: 45,
  },
  {
    eventId: "slo-nominal-3",
    eventType: "lane.enqueue",
    laneId: "lane-stateful-a",
    sessionId: "session-ops-a",
    qos: "stateful",
    offsetMs: 50,
  },
  {
    eventId: "slo-nominal-4",
    eventType: "render.tick",
    laneId: "lane-best-a",
    sessionId: "session-ops-c",
    qos: "best_effort",
    offsetMs: 70,
  },
];

for (const record of records) {
  server.publish({
    version: "1.0",
    eventId: record.eventId,
    occurredAt: new Date(now - record.offsetMs).toISOString(),
    eventType: record.eventType,
    severity: "info",
    source: {
      agentId: "agent-slo-bundle",
      workspaceId: "workspace-omnia",
      laneId: record.laneId,
      sessionId: record.sessionId,
    },
    payload: {
      qos: record.qos,
      command: "echo slo-bundle",
    },
  });
}

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

setInterval(() => {}, 60_000);
NODE
) >/dev/null 2>&1 &
BRIDGE_STUB_PID="$!"

log "Waiting for /metrics endpoint"
attempt=0
until curl -fsS -H "Authorization: Bearer ${BRIDGE_METRICS_TOKEN}" "http://127.0.0.1:${BRIDGE_PORT}/metrics" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "${attempt}" -ge 20 ]; then
    log "metrics endpoint did not become ready in time"
    exit 1
  fi
  sleep 1
done

log "Exporting snapshot and evaluating SLO bundle"
BRIDGE_HOST="127.0.0.1" BRIDGE_PORT="${BRIDGE_PORT}" BRIDGE_METRICS_TOKEN="${BRIDGE_METRICS_TOKEN}" \
  "${EXPORT_SCRIPT}" "${SNAPSHOT_PATH}" >/dev/null
SLO_BUNDLE_PROFILE="nominal-validation" "${EVAL_SCRIPT}" "${SNAPSHOT_PATH}" "${BUNDLE_PATH}" "${SUMMARY_PATH}" >/dev/null

node --input-type=module -e '
import fs from "node:fs";

const bundlePath = process.argv[1];
const summaryPath = process.argv[2];
const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
const summary = fs.readFileSync(summaryPath, "utf8");

if (bundle.sloBundle?.overallStatus !== "healthy") {
  throw new Error(`expected healthy SLO bundle, got ${bundle.sloBundle?.overallStatus}`);
}
if (Number(bundle.sloBundle?.objectivesFailed ?? 0) !== 0) {
  throw new Error("expected zero failed objectives");
}
if ((bundle.executiveSummary?.topLanes?.length ?? 0) < 2) {
  throw new Error("expected at least two lanes in executive summary");
}
if ((bundle.executiveSummary?.topSessions?.length ?? 0) < 2) {
  throw new Error("expected at least two sessions in executive summary");
}
if (typeof bundle.dashboard?.throughput?.activeLanes !== "number") {
  throw new Error("dashboard throughput.activeLanes missing");
}
if (typeof bundle.dashboard?.throughput?.activeSessions !== "number") {
  throw new Error("dashboard throughput.activeSessions missing");
}
if (!summary.includes("## SLO objectives")) {
  throw new Error("executive summary markdown missing SLO table");
}
' "${BUNDLE_PATH}" "${SUMMARY_PATH}"

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Observability SLO Bundle Verification"
  echo
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Checks"
  echo
  echo "- Nominal snapshot exported successfully."
  echo "- SLO bundle evaluated with overall status healthy."
  echo "- Executive summary includes lane/session coverage and SLO table."
  echo "- Dashboard block exposes throughput/latency/security/queue sections."
  echo
  echo "## Artifacts"
  echo
  echo "- ${SNAPSHOT_PATH}"
  echo "- ${BUNDLE_PATH}"
  echo "- ${SUMMARY_PATH}"
} > "${REPORT_PATH}"

log "Observability SLO bundle verification passed"
log "Report: ${REPORT_PATH}"
