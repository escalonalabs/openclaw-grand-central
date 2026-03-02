#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="${ROOT_DIR}/artifacts/security/security-rotation-report.md"

log() {
  printf '[verify:security-rotation] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

cd "${ROOT_DIR}"

run npm --workspace @openclaw/bridge test -- --test-name-pattern "authorize accepts previous token during rotation grace window"
run npm --workspace @openclaw/bridge test -- --test-name-pattern "server rotates token/scopes without dropping active websocket clients"

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Security Rotation Verification"
  echo
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Validated scenarios"
  echo
  echo "- Rotation grace accepts previous and active token during transition."
  echo "- Runtime token/scope rotation endpoint works without dropping active websocket clients."
  echo "- Rotated scopes enforce authz (missing metrics:read yields missing_scope)."
} > "${REPORT_PATH}"

log "Security rotation verification passed"
log "Report: ${REPORT_PATH}"
