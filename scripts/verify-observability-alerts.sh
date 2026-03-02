#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
EXPORT_SCRIPT="${ROOT_DIR}/scripts/export-metrics-snapshot.sh"
EVAL_SCRIPT="${ROOT_DIR}/scripts/evaluate-alert-rules.sh"

export BRIDGE_PORT="${BRIDGE_PORT:-3901}"
export BRIDGE_METRICS_TOKEN="${BRIDGE_METRICS_TOKEN:-dev-alerts-token}"

SNAPSHOT_PATH="${ROOT_DIR}/artifacts/observability/metrics-alert-test-snapshot.json"
REPORT_PATH="${ROOT_DIR}/artifacts/observability/alert-report.json"
BRIDGE_STUB_PID=""

log() {
  printf '[verify:observability-alerts] %s\n' "$1"
}

cleanup() {
  if [ -n "${BRIDGE_STUB_PID}" ]; then
    kill "${BRIDGE_STUB_PID}" >/dev/null 2>&1 || true
    wait "${BRIDGE_STUB_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

log "Starting local bridge stub for alert validation"
(
  cd "${ROOT_DIR}"
  node --input-type=module <<'NODE'
import { WebSocketBridgeServer } from "./apps/bridge/src/index.ts";

const port = Number(process.env.BRIDGE_PORT ?? "3901");
const token = process.env.BRIDGE_METRICS_TOKEN ?? "dev-alerts-token";

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

// Intentionally high critical latency (>250ms) to trigger critical latency alert.
server.publish({
  version: "1.0",
  eventId: "obs-alert-critical-latency",
  occurredAt: new Date(Date.now() - 900).toISOString(),
  eventType: "approval.requested",
  severity: "warn",
  source: {
    agentId: "agent-alert",
    workspaceId: "workspace-omnia",
    laneId: "lane-main",
    sessionId: "session-alert",
  },
  payload: {
    approvalId: "approval-alert",
    command: "echo alert-latency",
    qos: "critical",
  },
});

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

log "Forcing authn failures to validate security alerts"
for _i in 1 2; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${BRIDGE_PORT}/metrics")"
  if [ "${code}" -ne 401 ]; then
    log "unexpected status while forcing authn failure: ${code}"
    exit 1
  fi
done

log "Exporting snapshot and evaluating alert rules"
BRIDGE_HOST="127.0.0.1" BRIDGE_PORT="${BRIDGE_PORT}" BRIDGE_METRICS_TOKEN="${BRIDGE_METRICS_TOKEN}" \
  "${EXPORT_SCRIPT}" "${SNAPSHOT_PATH}" >/dev/null
REQUIRE_FIRING=1 "${EVAL_SCRIPT}" "${SNAPSHOT_PATH}" "${REPORT_PATH}" >/dev/null

node --input-type=module -e '
import fs from "node:fs";

const reportPath = process.argv[1];
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const firingIds = report.alerts.filter((item) => item.status === "firing").map((item) => item.id);

if (!firingIds.includes("bridge_authn_failures_detected")) {
  throw new Error("expected bridge_authn_failures_detected to be firing");
}

if (!firingIds.includes("bridge_critical_latency_p99_slo_breach")) {
  throw new Error("expected bridge_critical_latency_p99_slo_breach to be firing");
}
' "${REPORT_PATH}"

log "Observability alert verification passed"
