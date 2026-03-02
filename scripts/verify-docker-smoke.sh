#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.dev.yml"
DOCKER_BIN="${DOCKER_BIN:-docker}"

export BRIDGE_PORT="${BRIDGE_PORT:-3000}"
export WEB_PORT="${WEB_PORT:-5173}"

log() {
  printf '[verify:docker-smoke] %s\n' "$1"
}

cleanup() {
  "${DOCKER_BIN}" compose -f "${COMPOSE_FILE}" down --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

log "Validating compose configuration"
"${DOCKER_BIN}" compose -f "${COMPOSE_FILE}" config >/dev/null

log "Starting bridge and web services"
"${DOCKER_BIN}" compose -f "${COMPOSE_FILE}" up --build -d >/dev/null

log "Inspecting running services"
PS_OUTPUT="$("${DOCKER_BIN}" compose -f "${COMPOSE_FILE}" ps)"
printf '%s\n' "${PS_OUTPUT}"

if ! printf '%s\n' "${PS_OUTPUT}" | grep -E "bridge.*Up" >/dev/null; then
  log "Bridge service is not up"
  exit 1
fi

if ! printf '%s\n' "${PS_OUTPUT}" | grep -E "web.*Up" >/dev/null; then
  log "Web service is not up"
  exit 1
fi

log "Docker smoke verification passed"
