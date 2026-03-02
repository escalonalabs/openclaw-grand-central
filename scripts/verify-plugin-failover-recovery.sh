#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="${ROOT_DIR}/artifacts/bridge/plugin-failover-recovery-report.md"

log() {
  printf '[verify:plugin-failover-recovery] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

cd "${ROOT_DIR}"

run node --test --test-name-pattern "pipeline degrades to fallback when native plugin rejects and recovers on next success" ./apps/bridge/test/ingestPipeline.test.ts
run node --test --test-name-pattern "plugin ingest normalization preserves deterministic degrade reasonCode when event is unavailable" ./apps/bridge/test/plugin-ingest-normalization.test.ts
run node --test --test-name-pattern "plugin ingest normalization rejects invalid result shape" ./apps/bridge/test/plugin-ingest-normalization.test.ts
run node --test --test-name-pattern "plugin ingest handler error payload is deterministic" ./apps/bridge/test/plugin-ingest-normalization.test.ts

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Plugin Failover Recovery Verification"
  echo
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Validated scenarios"
  echo
  echo "- Native plugin rejection triggers fallback mode with deterministic reasonCode."
  echo "- Fallback ingestion remains available during degraded primary state."
  echo "- Recovery to primary route succeeds after plugin resumes acceptance."
  echo "- Plugin ingest normalization surfaces deterministic reasonCode for degraded plugin path."
  echo "- Plugin ingest handler exceptions map to deterministic handler error reasonCode."
  echo "- Plugin ingest invalid result shapes map to deterministic invalid_result reasonCode."
} > "${REPORT_PATH}"

log "Plugin failover recovery verification passed"
log "Report: ${REPORT_PATH}"
