#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="${ROOT_DIR}/artifacts/web/incident-ui-report.md"

log() {
  printf '[verify:incident-ui] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

cd "${ROOT_DIR}"

run npm --workspace @openclaw/web test -- --testNamePattern incidentModel
run npm run test:e2e:smoke
run npm run verify:docker-smoke

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Incident UI Verification"
  echo
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Validated checks"
  echo
  echo "- Incident model tests pass under web unit suite."
  echo "- Smoke e2e remains green with incident panel integrated."
  echo "- Docker smoke remains healthy with web + bridge services."
} > "${REPORT_PATH}"

log "Incident UI verification passed"
log "Report: ${REPORT_PATH}"
