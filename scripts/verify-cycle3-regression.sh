#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="${ROOT_DIR}/artifacts/regression/cycle3-regression-report.md"

log() {
  printf '[verify:cycle3-regression] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

cd "${ROOT_DIR}"

run npm run typecheck
run npm --workspace @openclaw/schema test
run npm --workspace @openclaw/bridge test
run npm --workspace @openclaw/web test
run npm run test:e2e:smoke
run npm run verify:docker-smoke
run npm run verify:observability-export
run npm run verify:observability-prometheus
run npm run verify:observability-alerts
run npm run verify:security-rotation
run npm run verify:synthetic-load
run npm run verify:dr-drill
run npm run verify:cycle3-readiness

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Cycle 3 Regression Report"
  echo
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Executed gates"
  echo
  echo "- typecheck"
  echo "- schema tests"
  echo "- bridge tests"
  echo "- web tests"
  echo "- smoke e2e"
  echo "- docker smoke"
  echo "- observability export"
  echo "- observability prometheus parity"
  echo "- observability alerts"
  echo "- security rotation"
  echo "- synthetic load"
  echo "- dr drill"
  echo "- cycle3 readiness docs audit"
} > "${REPORT_PATH}"

log "Cycle 3 regression verification passed"
log "Report: ${REPORT_PATH}"
