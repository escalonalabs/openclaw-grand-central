#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
RUN_SCRIPT="${ROOT_DIR}/scripts/run-synthetic-load-benchmark.sh"
BUDGET_SCRIPT="${ROOT_DIR}/scripts/verify-synthetic-load-budgets.sh"

RUN_ID="${BENCH_RUN_ID:-$(date -u +"%Y%m%dT%H%M%SZ")}"
SNAPSHOT_PATH="${ROOT_DIR}/artifacts/benchmark/synthetic-load-${RUN_ID}.json"

log() {
  printf '[verify:synthetic-load] %s\n' "$1"
}

log "Executing synthetic load benchmark run ${RUN_ID}"
BENCH_RUN_ID="${RUN_ID}" "${RUN_SCRIPT}" >/dev/null

log "Evaluating synthetic load budgets for ${RUN_ID}"
"${BUDGET_SCRIPT}" "${SNAPSHOT_PATH}" "${RUN_ID}" >/dev/null

log "Synthetic load verification passed"
log "Snapshot: ${SNAPSHOT_PATH}"
log "Reports:"
log "  - artifacts/benchmark/synthetic-load-${RUN_ID}.md"
log "  - artifacts/benchmark/synthetic-load-budget-report-${RUN_ID}.md"
