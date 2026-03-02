#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
EXPORT_SCRIPT="${ROOT_DIR}/scripts/export-metrics-snapshot.sh"

export BRIDGE_PORT="${BRIDGE_PORT:-3900}"
export BRIDGE_METRICS_TOKEN="${BRIDGE_METRICS_TOKEN:-dev-observability-token}"

OUTPUT_PATH="${ROOT_DIR}/artifacts/observability/metrics-snapshot.json"
BRIDGE_STUB_PID=""

log() {
  printf '[verify:observability-export] %s\n' "$1"
}

cleanup() {
  if [ -n "${BRIDGE_STUB_PID}" ]; then
    kill "${BRIDGE_STUB_PID}" >/dev/null 2>&1 || true
    wait "${BRIDGE_STUB_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

log "Starting local bridge stub for export validation"
(
  cd "${ROOT_DIR}"
  node --input-type=module <<'NODE'
import { WebSocketBridgeServer } from "./apps/bridge/src/index.ts";

const port = Number(process.env.BRIDGE_PORT ?? "3900");
const token = process.env.BRIDGE_METRICS_TOKEN ?? "dev-observability-token";

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
  eventId: "obs-export-e2e",
  occurredAt: new Date(Date.now() - 120).toISOString(),
  eventType: "approval.requested",
  severity: "info",
  source: {
    agentId: "agent-export",
    workspaceId: "workspace-omnia",
    laneId: "lane-main",
    sessionId: "session-export",
  },
  payload: {
    approvalId: "approval-export",
    command: "echo observability",
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

log "Exporting JSON metrics snapshot"
BRIDGE_HOST="127.0.0.1" BRIDGE_PORT="${BRIDGE_PORT}" BRIDGE_METRICS_TOKEN="${BRIDGE_METRICS_TOKEN}" \
  "${EXPORT_SCRIPT}" "${OUTPUT_PATH}" >/dev/null

node --input-type=module -e '
import fs from "node:fs";

const filePath = process.argv[1];
const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));

if (typeof snapshot.bridge_events_qos_total !== "object" || snapshot.bridge_events_qos_total === null) {
  throw new Error("bridge_events_qos_total must be an object");
}

if (typeof snapshot.bridge_events_session_total !== "object" || snapshot.bridge_events_session_total === null) {
  throw new Error("bridge_events_session_total must be an object");
}

for (const key of ["best_effort", "stateful", "critical"]) {
  if (typeof snapshot.bridge_events_qos_total[key] !== "number") {
    throw new Error(`missing qos counter: ${key}`);
  }
}

if (
  typeof snapshot.bridge_event_e2e_latency_ms !== "object" ||
  snapshot.bridge_event_e2e_latency_ms === null ||
  typeof snapshot.bridge_event_e2e_latency_ms.total !== "object"
) {
  throw new Error("bridge_event_e2e_latency_ms.total missing");
}

if (typeof snapshot.bridge_event_e2e_latency_ms.total.p95 !== "number") {
  throw new Error("bridge_event_e2e_latency_ms.total.p95 must be numeric");
}

if (snapshot.bridge_events_total < 1) {
  throw new Error("expected at least one exported event in snapshot");
}

if (Object.keys(snapshot.bridge_events_session_total).length < 1) {
  throw new Error("expected at least one active session in snapshot");
}
' "${OUTPUT_PATH}"

log "Observability export verification passed"
