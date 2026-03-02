#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="${ROOT_DIR}/artifacts/web/operational-timeline-ui-report.md"
APP_PATH="${ROOT_DIR}/apps/web/src/App.tsx"
STYLES_PATH="${ROOT_DIR}/apps/web/src/styles.css"

log() {
  printf '[verify:operational-timeline-ui] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

cd "${ROOT_DIR}"

run npm --workspace @openclaw/web test -- --testNamePattern timelineModel

node --input-type=module -e '
import fs from "node:fs";

const appPath = process.argv[1];
const stylesPath = process.argv[2];
const appSource = fs.readFileSync(appPath, "utf8");
const stylesSource = fs.readFileSync(stylesPath, "utf8");

const requiredAppSnippets = [
  "Ops Timeline",
  "aria-label=\"timeline-list\"",
  "Focus lane",
  "Focus session",
];
for (const snippet of requiredAppSnippets) {
  if (!appSource.includes(snippet)) {
    throw new Error(`missing timeline UI snippet in App.tsx: ${snippet}`);
  }
}

const requiredStyleSnippets = [
  ".timeline-card",
  ".timeline-list",
  ".timeline-item",
  ".timeline-actions",
  "@media (max-width: 900px)",
];
for (const snippet of requiredStyleSnippets) {
  if (!stylesSource.includes(snippet)) {
    throw new Error(`missing timeline style snippet: ${snippet}`);
  }
}

if (!stylesSource.includes(".timeline-actions") || !stylesSource.includes("grid-template-columns: repeat(2")) {
  throw new Error("mobile timeline action layout not found");
}
' "${APP_PATH}" "${STYLES_PATH}"

run npm run test:e2e:smoke
run npm run verify:docker-smoke

mkdir -p "$(dirname "${REPORT_PATH}")"
{
  echo "# Operational Timeline UI Verification"
  echo
  echo "- Commit: $(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "- Timestamp (UTC): $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "## Validated checks"
  echo
  echo "- timelineModel unit tests pass under @openclaw/web suite."
  echo "- App timeline panel and actions are present in UI source."
  echo "- Responsive CSS rules exist for desktop/mobile timeline rendering."
  echo "- Smoke e2e and docker smoke remain green."
} > "${REPORT_PATH}"

log "Operational timeline UI verification passed"
log "Report: ${REPORT_PATH}"
