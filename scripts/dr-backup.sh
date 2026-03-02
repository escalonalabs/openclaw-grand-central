#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

RUN_ID="${DR_RUN_ID:-$(date -u +"%Y%m%dT%H%M%SZ")}"
OUTPUT_DIR="${ROOT_DIR}/artifacts/dr"
ARCHIVE_PATH="${OUTPUT_DIR}/dr-backup-${RUN_ID}.tar.gz"
MANIFEST_PATH="${OUTPUT_DIR}/dr-backup-${RUN_ID}.manifest.json"
FILE_LIST_PATH="${OUTPUT_DIR}/dr-backup-${RUN_ID}.files.txt"
REPORT_PATH="${OUTPUT_DIR}/dr-backup-${RUN_ID}.md"
LATEST_ARCHIVE_PATH="${OUTPUT_DIR}/dr-backup-latest.tar.gz"
LATEST_MANIFEST_PATH="${OUTPUT_DIR}/dr-backup-latest.manifest.json"
LATEST_FILE_LIST_PATH="${OUTPUT_DIR}/dr-backup-latest.files.txt"
LATEST_REPORT_PATH="${OUTPUT_DIR}/dr-backup-latest.md"

CRITICAL_PATHS="
apps
packages
docs
scripts
infra/docker
.github/workflows
package.json
package-lock.json
tsconfig.json
tsconfig.base.json
README.md
CHANGELOG.md
.gitignore
"

log() {
  printf '[dr:backup] %s\n' "$1"
}

cd "${ROOT_DIR}"
mkdir -p "${OUTPUT_DIR}"

{
  for relative_path in ${CRITICAL_PATHS}; do
    if [ -d "${relative_path}" ]; then
      find "${relative_path}" -type f -print
    elif [ -f "${relative_path}" ]; then
      printf '%s\n' "${relative_path}"
    fi
  done
} | sort -u > "${FILE_LIST_PATH}"

if [ ! -s "${FILE_LIST_PATH}" ]; then
  log "no files selected for backup"
  exit 1
fi

log "Creating backup archive ${ARCHIVE_PATH#${ROOT_DIR}/}"
tar -czf "${ARCHIVE_PATH}" -C "${ROOT_DIR}" -T "${FILE_LIST_PATH}"

log "Generating manifest ${MANIFEST_PATH#${ROOT_DIR}/}"
node --input-type=module -e '
import crypto from "node:crypto";
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const rootDir = process.argv[1];
const fileListPath = process.argv[2];
const archivePath = process.argv[3];
const manifestPath = process.argv[4];
const runId = process.argv[5];

const files = fs
  .readFileSync(fileListPath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((relativePath) => {
    const absolutePath = path.join(rootDir, relativePath);
    const content = fs.readFileSync(absolutePath);
    return {
      path: relativePath,
      bytes: content.length,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
    };
  });

const archiveContent = fs.readFileSync(archivePath);
let commit = "unknown";
try {
  commit = execSync(`git -C "${rootDir}" rev-parse HEAD`, { encoding: "utf8" }).trim();
} catch {
  // ignore commit resolution failures outside git worktrees
}

const payload = {
  generatedAt: new Date().toISOString(),
  runId,
  commit,
  fileCount: files.length,
  files,
  archive: {
    path: path.relative(rootDir, archivePath),
    bytes: archiveContent.length,
    sha256: crypto.createHash("sha256").update(archiveContent).digest("hex"),
  },
};

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
' "${ROOT_DIR}" "${FILE_LIST_PATH}" "${ARCHIVE_PATH}" "${MANIFEST_PATH}" "${RUN_ID}"

FILE_COUNT="$(wc -l < "${FILE_LIST_PATH}" | tr -d ' ')"

cp "${ARCHIVE_PATH}" "${LATEST_ARCHIVE_PATH}"
cp "${MANIFEST_PATH}" "${LATEST_MANIFEST_PATH}"
cp "${FILE_LIST_PATH}" "${LATEST_FILE_LIST_PATH}"

{
  echo "# DR Backup Report"
  echo
  echo "- Run ID: ${RUN_ID}"
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "- Files captured: ${FILE_COUNT}"
  echo
  echo "## Artifacts"
  echo
  echo "- ${ARCHIVE_PATH#${ROOT_DIR}/}"
  echo "- ${MANIFEST_PATH#${ROOT_DIR}/}"
  echo "- ${FILE_LIST_PATH#${ROOT_DIR}/}"
} > "${REPORT_PATH}"

cp "${REPORT_PATH}" "${LATEST_REPORT_PATH}"

log "Backup completed"
log "Archive: ${ARCHIVE_PATH}"
log "Manifest: ${MANIFEST_PATH}"
