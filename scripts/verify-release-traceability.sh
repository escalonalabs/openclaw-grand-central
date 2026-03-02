#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

RELEASE_TAG="${1:-v0.1.0}"
SAFE_TAG="$(printf '%s' "${RELEASE_TAG}" | tr '/:' '__')"
MANIFEST_PATH="${ROOT_DIR}/artifacts/release/release-candidate-manifest-${SAFE_TAG}.json"
REPORT_PATH="${ROOT_DIR}/artifacts/release/release-traceability-audit-${SAFE_TAG}.md"

REQUIRED_PATHS="
artifacts/release/release-pipeline-audit-${SAFE_TAG}.md
artifacts/release/release-candidate-evidence-${SAFE_TAG}.md
artifacts/release/release-notes-${SAFE_TAG}.md
artifacts/observability/metrics-snapshot.json
artifacts/observability/metrics-alert-test-snapshot.json
artifacts/observability/alert-report.json
artifacts/runbooks/runbook-dr-audit.md
"

log() {
  printf '[verify:release-traceability] %s\n' "$1"
}

for relative_path in ${REQUIRED_PATHS}; do
  absolute_path="${ROOT_DIR}/${relative_path}"
  if [ ! -s "${absolute_path}" ]; then
    log "required evidence file missing or empty: ${relative_path}"
    exit 1
  fi
done

if [ ! -s "${MANIFEST_PATH}" ]; then
  log "manifest missing or empty: ${MANIFEST_PATH}"
  exit 1
fi

node --input-type=module -e '
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.argv[1];
const releaseTag = process.argv[2];
const manifestPath = process.argv[3];
const requiredPaths = process.argv.slice(4);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.tag !== releaseTag) {
  throw new Error(`manifest tag mismatch: expected ${releaseTag}, got ${manifest.tag}`);
}

const byPath = new Map();
for (const item of manifest.files ?? []) {
  if (item && typeof item.path === "string") {
    byPath.set(item.path, item);
  }
}

for (const relativePath of requiredPaths) {
  const absolutePath = path.join(rootDir, relativePath);
  const content = fs.readFileSync(absolutePath);
  const digest = crypto.createHash("sha256").update(content).digest("hex");
  const fromManifest = byPath.get(relativePath);
  if (!fromManifest) {
    throw new Error(`manifest missing file entry: ${relativePath}`);
  }
  if (fromManifest.sha256 !== digest) {
    throw new Error(`sha256 mismatch for ${relativePath}`);
  }
}
' "${ROOT_DIR}" "${RELEASE_TAG}" "${MANIFEST_PATH}" ${REQUIRED_PATHS}

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Release Traceability Audit"
  echo
  echo "- Tag: ${RELEASE_TAG}"
  echo "- Manifest: ${MANIFEST_PATH#${ROOT_DIR}/}"
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Verified evidence files"
  echo
  for relative_path in ${REQUIRED_PATHS}; do
    echo "- ${relative_path}"
  done
} > "${REPORT_PATH}"

log "Release traceability verification passed"
log "Audit report: ${REPORT_PATH}"
