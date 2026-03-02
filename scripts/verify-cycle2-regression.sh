#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="${ROOT_DIR}/artifacts/regression/cycle2-regression-report.md"

log() {
  printf '[verify:cycle2-regression] %s\n' "$1"
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
run npm run verify:observability-alerts
run npm run verify:release-pipeline -- v0.1.0
run npm run verify:runbooks-dr

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Cycle 2 Regression Report"
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
  echo "- observability alerts"
  echo "- release pipeline audit"
  echo "- runbook DR audit"
} > "${REPORT_PATH}"

log "Cycle 2 regression verification passed"
log "Report: ${REPORT_PATH}"
