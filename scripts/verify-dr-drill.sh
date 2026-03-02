#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
VERIFY_INTEGRITY_SCRIPT="${ROOT_DIR}/scripts/verify-dr-integrity.sh"

RUN_ID="${DR_RUN_ID:-$(date -u +"%Y%m%dT%H%M%SZ")}"
REPORT_PATH="${ROOT_DIR}/artifacts/dr/dr-drill-report-${RUN_ID}.md"
LATEST_REPORT_PATH="${ROOT_DIR}/artifacts/dr/dr-drill-report-latest.md"

log() {
  printf '[verify:dr-drill] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

cd "${ROOT_DIR}"

run env DR_RUN_ID="${RUN_ID}" "${VERIFY_INTEGRITY_SCRIPT}"
run npm --workspace @openclaw/bridge test
run npm run verify:docker-smoke

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# DR Drill Verification"
  echo
  echo "- Run ID: ${RUN_ID}"
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Executed gates"
  echo
  echo "- verify:dr-integrity"
  echo "- bridge tests"
  echo "- docker smoke"
} > "${REPORT_PATH}"

cp "${REPORT_PATH}" "${LATEST_REPORT_PATH}"

log "DR drill verification passed"
log "Report: ${REPORT_PATH}"
