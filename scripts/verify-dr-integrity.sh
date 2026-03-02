#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
BACKUP_SCRIPT="${ROOT_DIR}/scripts/dr-backup.sh"
RESTORE_SCRIPT="${ROOT_DIR}/scripts/dr-restore.sh"

RUN_ID="${DR_RUN_ID:-$(date -u +"%Y%m%dT%H%M%SZ")}"
ARCHIVE_PATH="${ROOT_DIR}/artifacts/dr/dr-backup-${RUN_ID}.tar.gz"
MANIFEST_PATH="${ROOT_DIR}/artifacts/dr/dr-backup-${RUN_ID}.manifest.json"
RESTORE_DIR="${ROOT_DIR}/artifacts/dr/restore-integrity-${RUN_ID}"
REPORT_PATH="${ROOT_DIR}/artifacts/dr/dr-integrity-report-${RUN_ID}.md"
LATEST_REPORT_PATH="${ROOT_DIR}/artifacts/dr/dr-integrity-report-latest.md"

log() {
  printf '[verify:dr-integrity] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

cd "${ROOT_DIR}"

run env DR_RUN_ID="${RUN_ID}" "${BACKUP_SCRIPT}"

if [ -d "${RESTORE_DIR}" ]; then
  rm -rf "${RESTORE_DIR}"
fi

run env DR_RUN_ID="${RUN_ID}" "${RESTORE_SCRIPT}" "${ARCHIVE_PATH}" "${MANIFEST_PATH}" "${RESTORE_DIR}"

if [ ! -f "${RESTORE_DIR}/package.json" ]; then
  log "restored package.json not found at ${RESTORE_DIR}"
  exit 1
fi

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# DR Integrity Verification"
  echo
  echo "- Run ID: ${RUN_ID}"
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Checks"
  echo
  echo "- backup archive generated"
  echo "- backup manifest generated"
  echo "- restore hash/size validation passed"
  echo "- critical file check passed (package.json)"
  echo
  echo "## Artifacts"
  echo
  echo "- artifacts/dr/dr-backup-${RUN_ID}.tar.gz"
  echo "- artifacts/dr/dr-backup-${RUN_ID}.manifest.json"
  echo "- artifacts/dr/dr-backup-${RUN_ID}.md"
  echo "- artifacts/dr/dr-restore-${RUN_ID}.md"
  echo "- artifacts/dr/dr-integrity-report-${RUN_ID}.md"
} > "${REPORT_PATH}"

cp "${REPORT_PATH}" "${LATEST_REPORT_PATH}"

log "DR integrity verification passed"
log "Report: ${REPORT_PATH}"
