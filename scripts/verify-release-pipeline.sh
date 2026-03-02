#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
WORKFLOW_PATH="${ROOT_DIR}/.github/workflows/release.yml"
RUNBOOK_AUTOMATION="${ROOT_DIR}/docs/runbooks/RELEASE_AUTOMATION.md"

RELEASE_TAG="${1:-v0.1.0}"
SAFE_TAG="$(printf '%s' "${RELEASE_TAG}" | tr '/:' '__')"
NOTES_PATH="${ROOT_DIR}/artifacts/release/release-notes-${SAFE_TAG}.md"
REPORT_PATH="${ROOT_DIR}/artifacts/release/release-pipeline-audit-${SAFE_TAG}.md"
RUNBOOK_CHECKLIST_TAGGED="${ROOT_DIR}/docs/runbooks/RELEASE_CHECKLIST_${RELEASE_TAG}.md"
RUNBOOK_CHECKLIST_DEFAULT="${ROOT_DIR}/docs/runbooks/RELEASE_CHECKLIST_v0.1.0.md"

if [ -f "${RUNBOOK_CHECKLIST_TAGGED}" ]; then
  RUNBOOK_CHECKLIST="${RUNBOOK_CHECKLIST_TAGGED}"
else
  RUNBOOK_CHECKLIST="${RUNBOOK_CHECKLIST_DEFAULT}"
fi

log() {
  printf '[verify:release-pipeline] %s\n' "$1"
}

require_file() {
  if [ ! -f "$1" ]; then
    log "required file missing: $1"
    exit 1
  fi
}

require_workflow_pattern() {
  pattern="$1"
  if ! grep -F -- "$pattern" "${WORKFLOW_PATH}" >/dev/null 2>&1; then
    log "missing workflow pattern: ${pattern}"
    exit 1
  fi
}

require_file "${WORKFLOW_PATH}"
require_file "${RUNBOOK_AUTOMATION}"
require_file "${RUNBOOK_CHECKLIST}"
require_file "${ROOT_DIR}/scripts/render-release-notes.sh"
require_file "${ROOT_DIR}/scripts/verify-docker-smoke.sh"
require_file "${ROOT_DIR}/scripts/verify-observability-export.sh"
require_file "${ROOT_DIR}/scripts/verify-observability-alerts.sh"
require_file "${ROOT_DIR}/scripts/verify-runbooks-dr.sh"

log "Checking release workflow wiring and traceability patterns"
log "Using checklist: ${RUNBOOK_CHECKLIST#${ROOT_DIR}/}"
require_workflow_pattern "name: Release"
require_workflow_pattern "tags:"
require_workflow_pattern "- \"v*.*.*\""
require_workflow_pattern "npm run typecheck"
require_workflow_pattern "npm --workspace @openclaw/schema test"
require_workflow_pattern "npm --workspace @openclaw/bridge test"
require_workflow_pattern "npm --workspace @openclaw/web test"
require_workflow_pattern "npm run test:e2e:smoke"
require_workflow_pattern "npm run verify:docker-smoke"
require_workflow_pattern "npm run verify:observability-export"
require_workflow_pattern "npm run verify:observability-alerts"
require_workflow_pattern "npm run verify:runbooks-dr"
require_workflow_pattern "scripts/render-release-notes.sh"
require_workflow_pattern "actions/upload-artifact@v4"
require_workflow_pattern "softprops/action-gh-release@v2"
require_workflow_pattern "artifacts/release/release-notes.md"
require_workflow_pattern "artifacts/release/release-evidence.md"
require_workflow_pattern "artifacts/observability/metrics-snapshot.json"
require_workflow_pattern "artifacts/observability/metrics-alert-test-snapshot.json"
require_workflow_pattern "artifacts/observability/alert-report.json"
require_workflow_pattern "artifacts/runbooks/runbook-dr-audit.md"

log "Rendering release notes preview for ${RELEASE_TAG}"
"${ROOT_DIR}/scripts/render-release-notes.sh" "${RELEASE_TAG}" "${NOTES_PATH}" >/dev/null

if [ ! -s "${NOTES_PATH}" ]; then
  log "rendered notes file is empty: ${NOTES_PATH}"
  exit 1
fi

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Release Pipeline Audit"
  echo
  echo "- Tag audited: ${RELEASE_TAG}"
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Checks"
  echo
  echo "- Release workflow trigger is semver tag based."
  echo "- Pipeline includes typecheck, tests, smoke, docker, and observability gates."
  echo "- Pipeline includes runbook DR gate for incident readiness."
  echo "- Workflow publishes both build evidence and observability artifacts."
  echo "- Notes rendering from changelog is wired and preview is non-empty."
  echo "- Runbooks for release automation and checklist are present."
  echo "- Checklist selected for this tag: ${RUNBOOK_CHECKLIST#${ROOT_DIR}/}"
  echo
  echo "## Evidence files"
  echo
  echo "- ${NOTES_PATH#${ROOT_DIR}/}"
} > "${REPORT_PATH}"

log "Release pipeline audit passed"
log "Audit report: ${REPORT_PATH}"
