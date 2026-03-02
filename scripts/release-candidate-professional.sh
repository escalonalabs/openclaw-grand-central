#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

RELEASE_TAG="${1:-v0.1.0}"
SAFE_TAG="$(printf '%s' "${RELEASE_TAG}" | tr '/:' '__')"
MANIFEST_PATH="${ROOT_DIR}/artifacts/release/release-candidate-manifest-${SAFE_TAG}.json"
BUNDLE_PATH="${ROOT_DIR}/artifacts/release/release-candidate-bundle-${SAFE_TAG}.md"

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
  printf '[release:candidate] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

cd "${ROOT_DIR}"

run npm run verify:release-pipeline -- "${RELEASE_TAG}"
run npm run verify:release-candidate -- "${RELEASE_TAG}"
run npm run verify:runbooks-dr

log "Generating release manifest with checksums"
node --input-type=module -e '
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.argv[1];
const releaseTag = process.argv[2];
const manifestPath = process.argv[3];
const filePaths = process.argv.slice(4);

const files = filePaths.map((relativePath) => {
  const absolutePath = path.join(rootDir, relativePath);
  const content = fs.readFileSync(absolutePath);
  return {
    path: relativePath,
    bytes: content.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
});

const commit = execSync(`git -C "${rootDir}" rev-parse HEAD`, { encoding: "utf8" }).trim();
const payload = {
  generatedAt: new Date().toISOString(),
  tag: releaseTag,
  commit,
  files,
};

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
' "${ROOT_DIR}" "${RELEASE_TAG}" "${MANIFEST_PATH}" ${REQUIRED_PATHS}

run npm run verify:release-traceability -- "${RELEASE_TAG}"

mkdir -p "$(dirname "${BUNDLE_PATH}")"
{
  echo "# Professional Release Candidate Bundle"
  echo
  echo "- Tag: ${RELEASE_TAG}"
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Executed flow"
  echo
  echo "- verify:release-pipeline"
  echo "- verify:release-candidate"
  echo "- verify:runbooks-dr"
  echo "- verify:release-traceability"
  echo
  echo "## Bundle manifest"
  echo
  echo "- ${MANIFEST_PATH#${ROOT_DIR}/}"
  echo
  echo "## Evidence set"
  echo
  for relative_path in ${REQUIRED_PATHS}; do
    echo "- ${relative_path}"
  done
} > "${BUNDLE_PATH}"

log "Professional release candidate flow completed"
log "Bundle: ${BUNDLE_PATH}"
