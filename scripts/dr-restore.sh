#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

RUN_ID="${DR_RUN_ID:-$(date -u +"%Y%m%dT%H%M%SZ")}"
ARCHIVE_PATH="${1:-${ROOT_DIR}/artifacts/dr/dr-backup-latest.tar.gz}"
MANIFEST_PATH="${2:-${ROOT_DIR}/artifacts/dr/dr-backup-latest.manifest.json}"
RESTORE_DIR="${3:-${ROOT_DIR}/artifacts/dr/restore-${RUN_ID}}"
REPORT_PATH="${ROOT_DIR}/artifacts/dr/dr-restore-${RUN_ID}.md"
LATEST_REPORT_PATH="${ROOT_DIR}/artifacts/dr/dr-restore-latest.md"

log() {
  printf '[dr:restore] %s\n' "$1"
}

if [ ! -s "${ARCHIVE_PATH}" ]; then
  log "backup archive missing or empty: ${ARCHIVE_PATH}"
  exit 1
fi

if [ ! -s "${MANIFEST_PATH}" ]; then
  log "manifest missing or empty: ${MANIFEST_PATH}"
  exit 1
fi

if [ -d "${RESTORE_DIR}" ] && find "${RESTORE_DIR}" -mindepth 1 -print -quit 2>/dev/null | grep -q .; then
  log "restore directory is not empty: ${RESTORE_DIR}"
  exit 1
fi

mkdir -p "${RESTORE_DIR}"

log "Extracting backup archive into ${RESTORE_DIR}"
tar -xzf "${ARCHIVE_PATH}" -C "${RESTORE_DIR}"

log "Validating restored files against manifest"
node --input-type=module -e '
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const restoreDir = process.argv[1];
const archivePath = process.argv[2];
const manifestPath = process.argv[3];

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const files = Array.isArray(manifest.files) ? manifest.files : [];
if (files.length === 0) {
  throw new Error("manifest does not contain files");
}

for (const file of files) {
  if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string") {
    throw new Error("invalid manifest entry");
  }
  const restoredPath = path.join(restoreDir, file.path);
  const content = fs.readFileSync(restoredPath);
  const digest = crypto.createHash("sha256").update(content).digest("hex");
  if (digest !== file.sha256) {
    throw new Error(`sha256 mismatch: ${file.path}`);
  }
  if (typeof file.bytes === "number" && content.length !== file.bytes) {
    throw new Error(`size mismatch: ${file.path}`);
  }
}

if (manifest.archive && typeof manifest.archive.sha256 === "string") {
  const archiveDigest = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  if (archiveDigest !== manifest.archive.sha256) {
    throw new Error("archive sha256 mismatch");
  }
}
' "${RESTORE_DIR}" "${ARCHIVE_PATH}" "${MANIFEST_PATH}"

FILE_COUNT="$(node --input-type=module -e 'import fs from "node:fs"; const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); console.log((manifest.files ?? []).length);' "${MANIFEST_PATH}")"

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# DR Restore Report"
  echo
  echo "- Run ID: ${RUN_ID}"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- Restored files: ${FILE_COUNT}"
  echo "- Restore directory: ${RESTORE_DIR#${ROOT_DIR}/}"
  echo
  echo "## Inputs"
  echo
  echo "- Archive: ${ARCHIVE_PATH#${ROOT_DIR}/}"
  echo "- Manifest: ${MANIFEST_PATH#${ROOT_DIR}/}"
} > "${REPORT_PATH}"

cp "${REPORT_PATH}" "${LATEST_REPORT_PATH}"

log "Restore verification completed"
log "Report: ${REPORT_PATH}"
