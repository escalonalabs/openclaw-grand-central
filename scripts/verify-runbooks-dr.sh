#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
RUNBOOK_PATH="${ROOT_DIR}/docs/runbooks/INCIDENT_RESPONSE_CYCLE2.md"
DR_RUNBOOK_PATH="${ROOT_DIR}/docs/runbooks/DISASTER_RECOVERY_CYCLE3.md"
REPORT_PATH="${ROOT_DIR}/artifacts/runbooks/runbook-dr-audit.md"

log() {
  printf '[verify:runbooks-dr] %s\n' "$1"
}

require_file() {
  if [ ! -f "$1" ]; then
    log "required file missing: $1"
    exit 1
  fi
}

require_pattern() {
  pattern="$1"
  if ! grep -F -- "$pattern" "${RUNBOOK_PATH}" >/dev/null 2>&1; then
    log "missing runbook pattern: ${pattern}"
    exit 1
  fi
}

require_file "${RUNBOOK_PATH}"
require_file "${DR_RUNBOOK_PATH}"
require_file "${ROOT_DIR}/docs/runbooks/RELEASE_AUTOMATION.md"
require_file "${ROOT_DIR}/docs/runbooks/RELEASE_CHECKLIST_v0.1.0.md"

log "Checking incident runbook coverage and executability markers"
require_pattern "Playbook A: Auth Fail"
require_pattern "Playbook B: Plugin Fail"
require_pattern "Playbook C: Overload"
require_pattern "Auth Fail Checklist"
require_pattern "Plugin Fail Checklist"
require_pattern "Overload Checklist"
require_pattern "npm run verify:observability-alerts"
require_pattern "npm run verify:docker-smoke"
require_pattern "npm run verify:release-candidate -- v0.1.0"

if ! grep -F -- "npm run verify:dr-drill" "${DR_RUNBOOK_PATH}" >/dev/null 2>&1; then
  log "missing DR runbook marker: npm run verify:dr-drill"
  exit 1
fi

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Runbook DR Audit"
  echo
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Coverage"
  echo
  echo "- auth fail: covered"
  echo "- plugin fail: covered"
  echo "- overload: covered"
  echo "- dr automation runbook: covered"
  echo "- checklists: covered"
  echo "- release/DR drill commands: covered"
} > "${REPORT_PATH}"

log "Runbook DR verification passed"
log "Audit report: ${REPORT_PATH}"
