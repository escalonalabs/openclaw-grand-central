#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="${ROOT_DIR}/artifacts/release/cycle3-readiness-audit.md"
RELEASE_AUTOMATION="${ROOT_DIR}/docs/runbooks/RELEASE_AUTOMATION.md"
RELEASE_CHECKLIST="${ROOT_DIR}/docs/runbooks/RELEASE_CHECKLIST_v0.1.0.md"
DR_RUNBOOK="${ROOT_DIR}/docs/runbooks/DISASTER_RECOVERY_CYCLE3.md"
CLOSEOUT_RUNBOOK="${ROOT_DIR}/docs/runbooks/CYCLE3_CLOSEOUT_v0.1.0.md"

log() {
  printf '[verify:cycle3-readiness] %s\n' "$1"
}

require_file() {
  if [ ! -f "$1" ]; then
    log "required file missing: $1"
    exit 1
  fi
}

require_pattern() {
  file_path="$1"
  pattern="$2"
  if ! grep -F -- "$pattern" "${file_path}" >/dev/null 2>&1; then
    log "missing pattern in ${file_path#${ROOT_DIR}/}: ${pattern}"
    exit 1
  fi
}

require_file "${RELEASE_AUTOMATION}"
require_file "${RELEASE_CHECKLIST}"
require_file "${DR_RUNBOOK}"
require_file "${CLOSEOUT_RUNBOOK}"

require_pattern "${RELEASE_AUTOMATION}" "npm run verify:dr-drill"
require_pattern "${RELEASE_AUTOMATION}" "npm run verify:cycle3-readiness"
require_pattern "${RELEASE_AUTOMATION}" "npm run verify:cycle3-regression"

require_pattern "${RELEASE_CHECKLIST}" "npm run verify:dr-drill"
require_pattern "${RELEASE_CHECKLIST}" "npm run verify:cycle3-readiness"
require_pattern "${RELEASE_CHECKLIST}" "npm run verify:cycle3-regression"
require_pattern "${RELEASE_CHECKLIST}" "docs/runbooks/CYCLE3_CLOSEOUT_v0.1.0.md"

require_pattern "${DR_RUNBOOK}" "npm run verify:dr-drill"
require_pattern "${CLOSEOUT_RUNBOOK}" "npm run verify:cycle3-readiness"
require_pattern "${CLOSEOUT_RUNBOOK}" "npm run verify:cycle3-regression"

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Cycle 3 Readiness Audit"
  echo
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Verified documentation"
  echo
  echo "- docs/runbooks/RELEASE_AUTOMATION.md"
  echo "- docs/runbooks/RELEASE_CHECKLIST_v0.1.0.md"
  echo "- docs/runbooks/DISASTER_RECOVERY_CYCLE3.md"
  echo "- docs/runbooks/CYCLE3_CLOSEOUT_v0.1.0.md"
  echo
  echo "## Validated command markers"
  echo
  echo "- verify:dr-drill"
  echo "- verify:cycle3-readiness"
  echo "- verify:cycle3-regression"
} > "${REPORT_PATH}"

log "Cycle 3 readiness verification passed"
log "Audit report: ${REPORT_PATH}"
