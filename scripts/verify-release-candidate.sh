#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

RELEASE_TAG="${1:-v0.1.0}"
SAFE_TAG="$(printf '%s' "${RELEASE_TAG}" | tr '/:' '__')"
NOTES_PATH="${ROOT_DIR}/artifacts/release/release-notes-${SAFE_TAG}.md"
EVIDENCE_PATH="${ROOT_DIR}/artifacts/release/release-candidate-evidence-${SAFE_TAG}.md"

log() {
  printf '[verify:release-candidate] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

assert_non_empty_file() {
  if [ ! -s "$1" ]; then
    log "required artifact missing or empty: $1"
    exit 1
  fi
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

run "${ROOT_DIR}/scripts/render-release-notes.sh" "${RELEASE_TAG}" "${NOTES_PATH}"

if grep -F "No dedicated changelog section was found" "${NOTES_PATH}" >/dev/null 2>&1; then
  log "release notes integrity check failed (missing changelog section for tag ${RELEASE_TAG})"
  exit 1
fi

if ! grep -E "^## \\[${RELEASE_TAG}\\]|^## \\[${RELEASE_TAG#v}\\]" "${NOTES_PATH}" >/dev/null 2>&1; then
  log "release notes integrity check failed (header for ${RELEASE_TAG} not found)"
  exit 1
fi

assert_non_empty_file "${ROOT_DIR}/artifacts/observability/metrics-snapshot.json"
assert_non_empty_file "${ROOT_DIR}/artifacts/observability/metrics-alert-test-snapshot.json"
assert_non_empty_file "${ROOT_DIR}/artifacts/observability/alert-report.json"

mkdir -p "$(dirname "${EVIDENCE_PATH}")"
{
  echo "# Release Candidate Evidence"
  echo
  echo "- Tag candidate: ${RELEASE_TAG}"
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Local gate execution"
  echo
  echo "- typecheck"
  echo "- schema tests"
  echo "- bridge tests"
  echo "- web tests"
  echo "- smoke e2e"
  echo "- docker smoke verification"
  echo "- observability export verification"
  echo "- observability alerts verification"
  echo "- release notes render + integrity checks"
  echo
  echo "## Artifacts"
  echo
  echo "- ${NOTES_PATH#${ROOT_DIR}/}"
  echo "- artifacts/observability/metrics-snapshot.json"
  echo "- artifacts/observability/metrics-alert-test-snapshot.json"
  echo "- artifacts/observability/alert-report.json"
} > "${EVIDENCE_PATH}"

log "Release candidate verification passed"
log "Evidence file: ${EVIDENCE_PATH}"
