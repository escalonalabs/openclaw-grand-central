#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker/docker-compose.dev.yml"

export BRIDGE_PORT="${BRIDGE_PORT:-3000}"
export WEB_PORT="${WEB_PORT:-5173}"

docker compose -f "${COMPOSE_FILE}" up --build -d "$@"
