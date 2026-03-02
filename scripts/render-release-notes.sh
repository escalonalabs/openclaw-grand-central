#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
CHANGELOG_PATH="${ROOT_DIR}/CHANGELOG.md"

RELEASE_TAG="${1:-}"
OUTPUT_PATH="${2:-${ROOT_DIR}/artifacts/release/release-notes.md}"

if [ -z "${RELEASE_TAG}" ]; then
  printf '[render:release-notes] usage: %s <tag> [output]\n' "$0" >&2
  exit 1
fi

if [ ! -f "${CHANGELOG_PATH}" ]; then
  printf '[render:release-notes] changelog not found: %s\n' "${CHANGELOG_PATH}" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_PATH}")"

NORMALIZED_TAG="${RELEASE_TAG#v}"

awk -v tag="${RELEASE_TAG}" -v normalizedTag="${NORMALIZED_TAG}" '
  ($0 ~ "^## \\[" tag "\\]" || $0 ~ "^## \\[" normalizedTag "\\]") {capture=1}
  capture {print}
  capture && /^## \[/ && $0 !~ "^## \\[" tag "\\]" && $0 !~ "^## \\[" normalizedTag "\\]" {exit}
' "${CHANGELOG_PATH}" > "${OUTPUT_PATH}.tmp"

if [ ! -s "${OUTPUT_PATH}.tmp" ]; then
  cat > "${OUTPUT_PATH}.tmp" <<EOF
# Release ${RELEASE_TAG}

No dedicated changelog section was found for \`${RELEASE_TAG}\`.

Please update \`CHANGELOG.md\` before publishing the release.
EOF
fi

mv "${OUTPUT_PATH}.tmp" "${OUTPUT_PATH}"
printf '[render:release-notes] wrote %s\n' "${OUTPUT_PATH}"
