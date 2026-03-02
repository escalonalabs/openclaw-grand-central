#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="${ROOT_DIR}/artifacts/benchmark/lane-fairness-report.md"

log() {
  printf '[verify:lane-fairness] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

cd "${ROOT_DIR}"

run npm --workspace @openclaw/bridge test -- --test-name-pattern "bridge core applies weighted fairness by qos and round robin by lane"
run npm run verify:synthetic-load

SNAPSHOT_PATH="${ROOT_DIR}/artifacts/benchmark/synthetic-load-latest.json"
if [ ! -s "${SNAPSHOT_PATH}" ]; then
  log "missing synthetic load snapshot: ${SNAPSHOT_PATH}"
  exit 1
fi

node --input-type=module -e '
import fs from "node:fs";

const snapshotPath = process.argv[1];
const reportPath = process.argv[2];
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const laneTotals = snapshot.bridge_events_lane_total ?? {};
const orderedLanes = Object.keys(laneTotals).sort();

const lines = [
  "# Lane Fairness Verification",
  "",
  `- Snapshot: ${snapshotPath}`,
  `- Timestamp (UTC): ${new Date().toISOString()}`,
  "",
  "## Lane totals",
  "",
  ...orderedLanes.map((lane) => `- ${lane}: ${laneTotals[lane]}`),
];

fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
' "${SNAPSHOT_PATH}" "${REPORT_PATH}"

log "Lane fairness verification passed"
log "Report: ${REPORT_PATH}"
