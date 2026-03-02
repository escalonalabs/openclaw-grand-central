#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
EXPORT_SCRIPT="${ROOT_DIR}/scripts/export-metrics-snapshot.sh"
EVAL_SLO_SCRIPT="${ROOT_DIR}/scripts/evaluate-slo-bundle.sh"

REPORT_PATH="${ROOT_DIR}/artifacts/observability/dashboard-slo-export-report.md"
NOMINAL_SNAPSHOT_PATH="${ROOT_DIR}/artifacts/observability/metrics-dashboard-nominal.json"
NOMINAL_BUNDLE_PATH="${ROOT_DIR}/artifacts/observability/slo-bundle-nominal.json"
NOMINAL_SUMMARY_PATH="${ROOT_DIR}/artifacts/observability/slo-summary-nominal.md"
DEGRADED_SNAPSHOT_PATH="${ROOT_DIR}/artifacts/observability/metrics-dashboard-degraded.json"
DEGRADED_BUNDLE_PATH="${ROOT_DIR}/artifacts/observability/slo-bundle-degraded.json"
DEGRADED_SUMMARY_PATH="${ROOT_DIR}/artifacts/observability/slo-summary-degraded.md"

STUB_PID=""

log() {
  printf '[verify:dashboard-slo-export] %s\n' "$1"
}

stop_stub() {
  if [ -n "${STUB_PID}" ]; then
    kill "${STUB_PID}" >/dev/null 2>&1 || true
    wait "${STUB_PID}" >/dev/null 2>&1 || true
    STUB_PID=""
  fi
}

cleanup() {
  stop_stub
}

trap cleanup EXIT INT TERM

start_stub() {
  scenario="${1}"
  port="${2}"
  token="${3}"

  (
    cd "${ROOT_DIR}"
    SCENARIO="${scenario}" BRIDGE_PORT="${port}" BRIDGE_TOKEN="${token}" node --input-type=module <<'NODE'
import { WebSocketBridgeServer } from "./apps/bridge/src/index.ts";

const scenario = process.env.SCENARIO ?? "nominal";
const port = Number(process.env.BRIDGE_PORT ?? "3905");
const token = process.env.BRIDGE_TOKEN ?? "dev-dashboard-slo-token";
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

const records =
  scenario === "degraded"
    ? [
        { eventId: "dash-degraded-1", eventType: "approval.requested", laneId: "lane-critical-a", sessionId: "session-risk-a", qos: "critical", offsetMs: 900, severity: "warn" },
        { eventId: "dash-degraded-2", eventType: "approval.requested", laneId: "lane-critical-b", sessionId: "session-risk-b", qos: "critical", offsetMs: 820, severity: "warn" },
        { eventId: "dash-degraded-3", eventType: "lane.enqueue", laneId: "lane-stateful-a", sessionId: "session-risk-a", qos: "stateful", offsetMs: 460, severity: "warn" },
        { eventId: "dash-degraded-4", eventType: "render.tick", laneId: "lane-best-a", sessionId: "session-risk-c", qos: "best_effort", offsetMs: 540, severity: "info" },
      ]
    : [
        { eventId: "dash-nominal-1", eventType: "approval.requested", laneId: "lane-critical-a", sessionId: "session-ops-a", qos: "critical", offsetMs: 45, severity: "info" },
        { eventId: "dash-nominal-2", eventType: "lane.enqueue", laneId: "lane-stateful-a", sessionId: "session-ops-b", qos: "stateful", offsetMs: 65, severity: "info" },
        { eventId: "dash-nominal-3", eventType: "render.tick", laneId: "lane-best-a", sessionId: "session-ops-c", qos: "best_effort", offsetMs: 80, severity: "info" },
      ];

for (const record of records) {
  server.publish({
    version: "1.0",
    eventId: record.eventId,
    occurredAt: new Date(now - record.offsetMs).toISOString(),
    eventType: record.eventType,
    severity: record.severity,
    source: {
      agentId: "agent-dashboard-slo",
      workspaceId: "workspace-omnia",
      laneId: record.laneId,
      sessionId: record.sessionId,
    },
    payload: {
      qos: record.qos,
      command: "echo dashboard-slo",
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

  STUB_PID="$!"
}

wait_metrics() {
  port="${1}"
  token="${2}"
  attempt=0
  until curl -fsS -H "Authorization: Bearer ${token}" "http://127.0.0.1:${port}/metrics" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "${attempt}" -ge 20 ]; then
      log "metrics endpoint did not become ready in time on port ${port}"
      exit 1
    fi
    sleep 1
  done
}

run_scenario() {
  scenario="${1}"
  port="${2}"
  token="${3}"
  snapshot_path="${4}"
  bundle_path="${5}"
  summary_path="${6}"

  log "Running ${scenario} scenario"
  start_stub "${scenario}" "${port}" "${token}"
  wait_metrics "${port}" "${token}"

  if [ "${scenario}" = "degraded" ]; then
    for _i in 1 2; do
      code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/metrics")"
      if [ "${code}" -ne 401 ]; then
        log "unexpected status while forcing authn failures (${scenario}): ${code}"
        exit 1
      fi
    done
  fi

  BRIDGE_HOST="127.0.0.1" BRIDGE_PORT="${port}" BRIDGE_METRICS_TOKEN="${token}" \
    "${EXPORT_SCRIPT}" "${snapshot_path}" >/dev/null
  SLO_BUNDLE_PROFILE="${scenario}" "${EVAL_SLO_SCRIPT}" "${snapshot_path}" "${bundle_path}" "${summary_path}" >/dev/null

  stop_stub
}

run_scenario "nominal" "3905" "dev-dashboard-slo-nominal" \
  "${NOMINAL_SNAPSHOT_PATH}" "${NOMINAL_BUNDLE_PATH}" "${NOMINAL_SUMMARY_PATH}"
run_scenario "degraded" "3906" "dev-dashboard-slo-degraded" \
  "${DEGRADED_SNAPSHOT_PATH}" "${DEGRADED_BUNDLE_PATH}" "${DEGRADED_SUMMARY_PATH}"

node --input-type=module -e '
import fs from "node:fs";

const nominalBundlePath = process.argv[1];
const degradedBundlePath = process.argv[2];
const nominalBundle = JSON.parse(fs.readFileSync(nominalBundlePath, "utf8"));
const degradedBundle = JSON.parse(fs.readFileSync(degradedBundlePath, "utf8"));

if (nominalBundle.sloBundle?.overallStatus !== "healthy") {
  throw new Error(`nominal status expected healthy, got ${nominalBundle.sloBundle?.overallStatus}`);
}
if (Number(nominalBundle.sloBundle?.objectivesFailed ?? 0) !== 0) {
  throw new Error("nominal scenario expected zero failed objectives");
}

if (degradedBundle.sloBundle?.overallStatus !== "breach") {
  throw new Error(`degraded status expected breach, got ${degradedBundle.sloBundle?.overallStatus}`);
}
const degradedFailures = degradedBundle.sloBundle?.objectives?.filter((item) => item.status === "fail") ?? [];
if (degradedFailures.length === 0) {
  throw new Error("degraded scenario expected at least one failed SLO objective");
}
if (!degradedFailures.some((item) => item.id === "slo_bridge_critical_latency_p99")) {
  throw new Error("degraded scenario must fail slo_bridge_critical_latency_p99");
}
if (Number(degradedBundle.executiveSummary?.security?.authnFailuresTotal ?? 0) < 2) {
  throw new Error("degraded scenario expected authn failures >= 2");
}
' "${NOMINAL_BUNDLE_PATH}" "${DEGRADED_BUNDLE_PATH}"

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Dashboard + SLO Export Verification"
  echo
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Scenario outcomes"
  echo
  node --input-type=module -e '
import fs from "node:fs";

const nominalBundle = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const degradedBundle = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

const summarize = (label, bundle) => {
  const failures = (bundle.sloBundle?.objectives ?? [])
    .filter((item) => item.status === "fail")
    .map((item) => item.id)
    .join(", ");
  console.log(`- ${label}: status=${bundle.sloBundle?.overallStatus}, healthScore=${bundle.sloBundle?.healthScore}, failed=[${failures}]`);
};

summarize("nominal", nominalBundle);
summarize("degraded", degradedBundle);
' "${NOMINAL_BUNDLE_PATH}" "${DEGRADED_BUNDLE_PATH}"
  echo
  echo "## Artifacts"
  echo
  echo "- ${NOMINAL_SNAPSHOT_PATH}"
  echo "- ${NOMINAL_BUNDLE_PATH}"
  echo "- ${NOMINAL_SUMMARY_PATH}"
  echo "- ${DEGRADED_SNAPSHOT_PATH}"
  echo "- ${DEGRADED_BUNDLE_PATH}"
  echo "- ${DEGRADED_SUMMARY_PATH}"
} > "${REPORT_PATH}"

npm --prefix "${ROOT_DIR}" run verify:docker-smoke >/dev/null

log "Dashboard + SLO export verification passed"
log "Report: ${REPORT_PATH}"
