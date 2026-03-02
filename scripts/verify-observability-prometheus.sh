#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
EXPORT_JSON_SCRIPT="${ROOT_DIR}/scripts/export-metrics-snapshot.sh"
EXPORT_PROM_SCRIPT="${ROOT_DIR}/scripts/export-metrics-prometheus.sh"

export BRIDGE_PORT="${BRIDGE_PORT:-3902}"
export BRIDGE_METRICS_TOKEN="${BRIDGE_METRICS_TOKEN:-dev-prometheus-token}"

JSON_PATH="${ROOT_DIR}/artifacts/observability/metrics-snapshot-prometheus-parity.json"
PROM_PATH="${ROOT_DIR}/artifacts/observability/metrics-prometheus.txt"
REPORT_PATH="${ROOT_DIR}/artifacts/observability/prometheus-parity-report.md"
BRIDGE_STUB_PID=""

log() {
  printf '[verify:observability-prometheus] %s\n' "$1"
}

cleanup() {
  if [ -n "${BRIDGE_STUB_PID}" ]; then
    kill "${BRIDGE_STUB_PID}" >/dev/null 2>&1 || true
    wait "${BRIDGE_STUB_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

log "Starting local bridge stub for Prometheus parity validation"
(
  cd "${ROOT_DIR}"
  node --input-type=module <<'NODE'
import { WebSocketBridgeServer } from "./apps/bridge/src/index.ts";

const port = Number(process.env.BRIDGE_PORT ?? "3902");
const token = process.env.BRIDGE_METRICS_TOKEN ?? "dev-prometheus-token";

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
server.publish({
  version: "1.0",
  eventId: "obs-prom-e2e",
  occurredAt: new Date(Date.now() - 420).toISOString(),
  eventType: "approval.requested",
  severity: "warn",
  source: {
    agentId: "agent-prom",
    workspaceId: "workspace-omnia",
    laneId: "lane-main",
    sessionId: "session-prom",
  },
  payload: {
    approvalId: "approval-prom",
    command: "echo prometheus",
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

log "Waiting for /metrics and /metrics/prometheus"
attempt=0
until curl -fsS -H "Authorization: Bearer ${BRIDGE_METRICS_TOKEN}" "http://127.0.0.1:${BRIDGE_PORT}/metrics" >/dev/null 2>&1 \
  && curl -fsS -H "Authorization: Bearer ${BRIDGE_METRICS_TOKEN}" "http://127.0.0.1:${BRIDGE_PORT}/metrics/prometheus" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "${attempt}" -ge 20 ]; then
    log "metrics endpoints did not become ready in time"
    exit 1
  fi
  sleep 1
done

log "Exporting JSON and Prometheus metrics"
BRIDGE_HOST="127.0.0.1" BRIDGE_PORT="${BRIDGE_PORT}" BRIDGE_METRICS_TOKEN="${BRIDGE_METRICS_TOKEN}" \
  "${EXPORT_JSON_SCRIPT}" "${JSON_PATH}" >/dev/null
BRIDGE_HOST="127.0.0.1" BRIDGE_PORT="${BRIDGE_PORT}" BRIDGE_METRICS_TOKEN="${BRIDGE_METRICS_TOKEN}" \
  "${EXPORT_PROM_SCRIPT}" "${PROM_PATH}" >/dev/null

node --input-type=module -e '
import fs from "node:fs";

const jsonPath = process.argv[1];
const promPath = process.argv[2];
const snapshot = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const promText = fs.readFileSync(promPath, "utf8");

const parseMetric = (name, labels = {}) => {
  for (const rawLine of promText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const valueMatch = line.match(/^([^ ]+)\s+(-?\d+(?:\.\d+)?)$/);
    if (!valueMatch) {
      continue;
    }

    const metricWithLabels = valueMatch[1];
    const value = Number(valueMatch[2]);
    const braceIndex = metricWithLabels.indexOf("{");
    const metricName = braceIndex === -1 ? metricWithLabels : metricWithLabels.slice(0, braceIndex);
    if (metricName !== name) {
      continue;
    }

    const parsedLabels = {};
    if (braceIndex !== -1 && metricWithLabels.endsWith("}")) {
      const rawLabels = metricWithLabels.slice(braceIndex + 1, -1);
      for (const pair of rawLabels.split(",")) {
        if (!pair) continue;
        const [k, v] = pair.split("=");
        parsedLabels[k] = (v ?? "").replace(/^"|"$/g, "");
      }
    }

    let matches = true;
    for (const [k, v] of Object.entries(labels)) {
      if (parsedLabels[k] !== String(v)) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }

    return value;
  }

  throw new Error(`metric not found: ${name}`);
};

const checks = [
  ["bridge_events_total", snapshot.bridge_events_total, parseMetric("bridge_events_total")],
  ["bridge_events_qos_total{qos=critical}", snapshot.bridge_events_qos_total.critical, parseMetric("bridge_events_qos_total", { qos: "critical" })],
  ["bridge_events_lane_total{lane=lane-main}", snapshot.bridge_events_lane_total["lane-main"] ?? 0, parseMetric("bridge_events_lane_total", { lane: "lane-main" })],
  ["bridge_events_session_total{session=session-prom}", snapshot.bridge_events_session_total["session-prom"] ?? 0, parseMetric("bridge_events_session_total", { session: "session-prom" })],
  ["bridge_event_e2e_latency_ms_total{stat=p95}", snapshot.bridge_event_e2e_latency_ms.total.p95, parseMetric("bridge_event_e2e_latency_ms_total", { stat: "p95" })],
  ["bridge_authn_failures_total", snapshot.bridge_authn_failures_total, parseMetric("bridge_authn_failures_total")],
  ["bridge_action_gate_decisions_total{decision=allow}", snapshot.bridge_action_gate_decisions_total.allow, parseMetric("bridge_action_gate_decisions_total", { decision: "allow" })],
  ["bridge_action_gate_decisions_total{decision=deny}", snapshot.bridge_action_gate_decisions_total.deny, parseMetric("bridge_action_gate_decisions_total", { decision: "deny" })],
  ["bridge_action_receipts_total{status=accepted}", snapshot.bridge_action_receipts_total.accepted, parseMetric("bridge_action_receipts_total", { status: "accepted" })],
  ["bridge_action_idempotency_replays_total", snapshot.bridge_action_idempotency_replays_total, parseMetric("bridge_action_idempotency_replays_total")],
];

for (const [name, expected, actual] of checks) {
  if (Number(expected) !== Number(actual)) {
    throw new Error(`parity mismatch for ${name}: expected ${expected}, got ${actual}`);
  }
}
' "${JSON_PATH}" "${PROM_PATH}"

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Prometheus Parity Verification"
  echo
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Checks"
  echo
  echo "- /metrics JSON export available and valid."
  echo "- /metrics/prometheus export available and valid."
  echo "- Key counters/latency stats match between JSON and Prometheus views."
} > "${REPORT_PATH}"

log "Prometheus observability verification passed"
log "Report: ${REPORT_PATH}"
