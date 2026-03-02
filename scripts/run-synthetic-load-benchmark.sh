#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
EXPORT_SCRIPT="${ROOT_DIR}/scripts/export-metrics-snapshot.sh"

export BRIDGE_PORT="${BRIDGE_PORT:-3903}"
export BRIDGE_METRICS_TOKEN="${BRIDGE_METRICS_TOKEN:-dev-load-token}"
export BENCH_EVENT_COUNT="${BENCH_EVENT_COUNT:-192}"
export BENCH_QUEUE_CAPACITY="${BENCH_QUEUE_CAPACITY:-64}"
export BENCH_LATENCY_BASE_MS="${BENCH_LATENCY_BASE_MS:-220}"
export BENCH_LATENCY_JITTER_MS="${BENCH_LATENCY_JITTER_MS:-60}"
export BENCH_DROP_POLICY="${BENCH_DROP_POLICY:-drop-oldest}"

RUN_ID="${BENCH_RUN_ID:-$(date -u +"%Y%m%dT%H%M%SZ")}"
SNAPSHOT_PATH="${ROOT_DIR}/artifacts/benchmark/synthetic-load-${RUN_ID}.json"
REPORT_PATH="${ROOT_DIR}/artifacts/benchmark/synthetic-load-${RUN_ID}.md"
LATEST_SNAPSHOT_PATH="${ROOT_DIR}/artifacts/benchmark/synthetic-load-latest.json"
LATEST_REPORT_PATH="${ROOT_DIR}/artifacts/benchmark/synthetic-load-latest.md"
BRIDGE_STUB_PID=""

log() {
  printf '[benchmark:synthetic-load] %s\n' "$1"
}

cleanup() {
  if [ -n "${BRIDGE_STUB_PID}" ]; then
    kill "${BRIDGE_STUB_PID}" >/dev/null 2>&1 || true
    wait "${BRIDGE_STUB_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

mkdir -p "${ROOT_DIR}/artifacts/benchmark"

log "Starting local bridge stub with synthetic load profile"
(
  cd "${ROOT_DIR}"
  node --input-type=module <<'NODE'
import { WebSocketBridgeServer } from "./apps/bridge/src/index.ts";

const port = Number(process.env.BRIDGE_PORT ?? "3903");
const token = process.env.BRIDGE_METRICS_TOKEN ?? "dev-load-token";
const eventCount = Number(process.env.BENCH_EVENT_COUNT ?? "160");
const queueCapacity = Number(process.env.BENCH_QUEUE_CAPACITY ?? "64");
const latencyBaseMs = Number(process.env.BENCH_LATENCY_BASE_MS ?? "220");
const latencyJitterMs = Number(process.env.BENCH_LATENCY_JITTER_MS ?? "60");
const dropPolicy = process.env.BENCH_DROP_POLICY === "drop-newest" ? "drop-newest" : "drop-oldest";

const server = new WebSocketBridgeServer({
  host: "127.0.0.1",
  port,
  queueCapacity,
  dropPolicy,
  heartbeatIntervalMs: 60_000,
  heartbeatTimeoutMs: 120_000,
  security: {
    tokenResolver: () => token,
    scopesResolver: () => ["telemetry:read", "metrics:read", "control:write"],
  },
});

await server.start();

for (let index = 0; index < eventCount; index += 1) {
  const offsetMs = latencyBaseMs + (index % Math.max(1, latencyJitterMs));
  const now = Date.now();
  const mode = index % 6;
  const eventType =
    mode <= 1 ? "approval.requested" : mode <= 3 ? "lane.enqueue" : "render.tick";
  const laneId =
    mode === 0
      ? "lane-critical-a"
      : mode === 1
        ? "lane-critical-b"
        : mode === 2
          ? "lane-stateful-a"
          : mode === 3
            ? "lane-stateful-b"
            : mode === 4
              ? "lane-best-a"
              : "lane-best-b";
  const qos =
    mode <= 1 ? "critical" : mode <= 3 ? "stateful" : "best_effort";
  const priority = qos === "critical" ? "high" : qos === "stateful" ? "normal" : "low";

  server.publish({
    version: "1.0",
    eventId: `bench-${index}`,
    occurredAt: new Date(now - offsetMs).toISOString(),
    eventType,
    severity: index % 5 === 0 ? "warn" : "info",
    source: {
      agentId: "bench-agent",
      workspaceId: "workspace-omnia",
      laneId,
      sessionId: "session-benchmark",
    },
    payload:
      eventType === "lane.enqueue"
        ? {
            queueDepth: index,
            position: index % 16,
            qos,
            priority,
          }
        : eventType === "approval.requested"
          ? {
              approvalId: `approval-${index}`,
              command: "echo bench",
              qos,
              priority,
            }
          : {
              frame: index,
              qos,
              priority,
            },
  });
}

await new Promise((resolve) => setTimeout(resolve, 25));

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
  if [ "${attempt}" -ge 25 ]; then
    log "metrics endpoint did not become ready in time"
    exit 1
  fi
  sleep 1
done

log "Exporting synthetic-load snapshot"
BRIDGE_HOST="127.0.0.1" BRIDGE_PORT="${BRIDGE_PORT}" BRIDGE_METRICS_TOKEN="${BRIDGE_METRICS_TOKEN}" \
  "${EXPORT_SCRIPT}" "${SNAPSHOT_PATH}" >/dev/null

cp "${SNAPSHOT_PATH}" "${LATEST_SNAPSHOT_PATH}"

node --input-type=module -e '
import fs from "node:fs";

const snapshotPath = process.argv[1];
const reportPath = process.argv[2];
const runId = process.argv[3];
const eventCount = Number(process.argv[4]);
const queueCapacity = Number(process.argv[5]);
const latencyBaseMs = Number(process.argv[6]);
const latencyJitterMs = Number(process.argv[7]);
const dropPolicy = process.argv[8];

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const report = [
  "# Synthetic Load Benchmark",
  "",
  `- Run ID: ${runId}`,
  `- Timestamp (UTC): ${new Date().toISOString()}`,
  "",
  "## Profile",
  "",
  `- Event count: ${eventCount}`,
  `- Queue capacity: ${queueCapacity}`,
  `- Drop policy: ${dropPolicy}`,
  `- Latency base ms: ${latencyBaseMs}`,
  `- Latency jitter ms: ${latencyJitterMs}`,
  "",
  "## Observed metrics",
  "",
  `- bridge_events_total: ${snapshot.bridge_events_total}`,
  `- droppedEvents: ${snapshot.droppedEvents}`,
  `- queueDepth: ${snapshot.queueDepth}`,
  `- bridge_event_e2e_latency_ms.total.p95: ${snapshot.bridge_event_e2e_latency_ms.total.p95}`,
  `- bridge_event_e2e_latency_ms.by_qos.critical.p99: ${snapshot.bridge_event_e2e_latency_ms.by_qos.critical.p99}`,
  `- active lanes: ${Object.keys(snapshot.bridge_events_lane_total ?? {}).length}`,
  `- lane totals: ${JSON.stringify(snapshot.bridge_events_lane_total ?? {}, null, 0)}`,
];

fs.writeFileSync(reportPath, `${report.join("\n")}\n`, "utf8");
' "${SNAPSHOT_PATH}" "${REPORT_PATH}" "${RUN_ID}" "${BENCH_EVENT_COUNT}" "${BENCH_QUEUE_CAPACITY}" "${BENCH_LATENCY_BASE_MS}" "${BENCH_LATENCY_JITTER_MS}" "${BENCH_DROP_POLICY}"

cp "${REPORT_PATH}" "${LATEST_REPORT_PATH}"

log "Synthetic load benchmark completed"
log "Snapshot: ${SNAPSHOT_PATH}"
log "Report: ${REPORT_PATH}"
