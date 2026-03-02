#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

BRIDGE_HOST="${BRIDGE_HOST:-127.0.0.1}"
BRIDGE_PORT="${BRIDGE_PORT:-3000}"
METRICS_TOKEN="${OPENCLAW_BRIDGE_TOKEN:-${BRIDGE_METRICS_TOKEN:-}}"
OUTPUT_PATH="${1:-${METRICS_PROM_OUTPUT_PATH:-${ROOT_DIR}/artifacts/observability/metrics-prometheus.txt}}"

if [ -z "${METRICS_TOKEN}" ]; then
  printf '[export:metrics-prometheus] missing token (OPENCLAW_BRIDGE_TOKEN or BRIDGE_METRICS_TOKEN)\n' >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_PATH}")"

TMP_FILE="$(mktemp "${ROOT_DIR}/.metrics-prometheus.XXXXXX.txt")"
cleanup() {
  rm -f "${TMP_FILE}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

curl -fsS \
  -H "Authorization: Bearer ${METRICS_TOKEN}" \
  -H "Accept: text/plain" \
  "http://${BRIDGE_HOST}:${BRIDGE_PORT}/metrics/prometheus" \
  > "${TMP_FILE}"

node --input-type=module -e '
import fs from "node:fs";

const filePath = process.argv[1];
const text = fs.readFileSync(filePath, "utf8");
const required = [
  "bridge_events_total",
  "bridge_events_qos_total{qos=\"critical\"}",
  "bridge_event_e2e_latency_ms_total{stat=\"p95\"}",
  "bridge_authn_failures_total",
  "bridge_action_gate_decisions_total{decision=\"allow\"}"
];

for (const metric of required) {
  if (!text.includes(metric)) {
    throw new Error(`prometheus export missing metric: ${metric}`);
  }
}
' "${TMP_FILE}"

mv "${TMP_FILE}" "${OUTPUT_PATH}"
trap - EXIT INT TERM

printf '[export:metrics-prometheus] wrote %s\n' "${OUTPUT_PATH}"
