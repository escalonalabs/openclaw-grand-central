#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

BRIDGE_HOST="${BRIDGE_HOST:-127.0.0.1}"
BRIDGE_PORT="${BRIDGE_PORT:-3000}"
METRICS_TOKEN="${OPENCLAW_BRIDGE_TOKEN:-${BRIDGE_METRICS_TOKEN:-}}"
OUTPUT_PATH="${1:-${METRICS_OUTPUT_PATH:-${ROOT_DIR}/artifacts/observability/metrics-snapshot.json}}"

if [ -z "${METRICS_TOKEN}" ]; then
  printf '[export:metrics-snapshot] missing token (OPENCLAW_BRIDGE_TOKEN or BRIDGE_METRICS_TOKEN)\n' >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_PATH}")"

TMP_FILE="$(mktemp "${ROOT_DIR}/.metrics-snapshot.XXXXXX.json")"
cleanup() {
  rm -f "${TMP_FILE}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

curl -fsS \
  -H "Authorization: Bearer ${METRICS_TOKEN}" \
  -H "Accept: application/json" \
  "http://${BRIDGE_HOST}:${BRIDGE_PORT}/metrics" \
  > "${TMP_FILE}"

node --input-type=module -e '
import fs from "node:fs";

const filePath = process.argv[1];
const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
const required = [
  "droppedEvents",
  "connectedClients",
  "queueDepth",
  "bridge_events_total",
  "bridge_events_qos_total",
  "bridge_events_session_total",
  "bridge_event_e2e_latency_ms",
  "bridge_authn_failures_total",
  "bridge_authz_denies_total",
  "bridge_action_gate_decisions_total"
];

for (const key of required) {
  if (!Object.prototype.hasOwnProperty.call(snapshot, key)) {
    throw new Error(`metrics snapshot missing key: ${key}`);
  }
}
' "${TMP_FILE}"

mv "${TMP_FILE}" "${OUTPUT_PATH}"
trap - EXIT INT TERM

printf '[export:metrics-snapshot] wrote %s\n' "${OUTPUT_PATH}"
