#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="${ROOT_DIR}/artifacts/security/action-idempotency-report.md"

log() {
  printf '[verify:action-idempotency] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

cd "${ROOT_DIR}"

run npm --workspace @openclaw/bridge test -- --test-name-pattern "server action gate allows configured actions and returns reason codes"

node --input-type=module -e '
import fs from "node:fs";
import { WebSocketBridgeServer } from "./apps/bridge/src/index.ts";

const server = new WebSocketBridgeServer({
  host: "127.0.0.1",
  port: 0,
  heartbeatIntervalMs: 60_000,
  heartbeatTimeoutMs: 120_000,
  security: {
    tokenResolver: () => "expected-token",
    scopesResolver: () => ["metrics:read", "telemetry:read", "control:write"],
    actionAllowlist: ["restart-lane", "resume-lane"],
  },
});

await server.start();
const baseUrl = `http://127.0.0.1:${server.getPort()}`;

const runAction = async (action, options = {}) => {
  const response = await fetch(`${baseUrl}/actions/${action}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer expected-token",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(options.body ?? {}),
  });
  const payload = await response.json();
  return { status: response.status, payload };
};

const submit = await runAction("restart-lane", {
  headers: {
    "Idempotency-Key": "idem-e2e-1",
    "X-Correlation-Id": "corr-e2e-1",
  },
  body: {
    payload: {
      laneId: "lane-main",
      operation: "restart",
    },
  },
});
if (submit.status !== 202 || submit.payload.duplicate !== false) {
  throw new Error("submit step failed");
}

const ack = await runAction("restart-lane", {
  headers: {
    "Idempotency-Key": "idem-e2e-1",
    "X-Correlation-Id": "corr-e2e-2",
  },
  body: {
    payload: {
      laneId: "lane-main",
      operation: "restart",
    },
  },
});
if (ack.status !== 200 || ack.payload.duplicate !== true) {
  throw new Error("ack/replay step failed");
}

const retry = await runAction("restart-lane", {
  headers: {
    "Idempotency-Key": "idem-e2e-2",
    "X-Correlation-Id": "corr-e2e-3",
  },
  body: {
    payload: {
      laneId: "lane-main",
      operation: "restart",
    },
  },
});
if (retry.status !== 202 || retry.payload.duplicate !== false) {
  throw new Error("retry step failed");
}

const rejected = await runAction("stop-lane", {
  headers: {
    "Idempotency-Key": "idem-e2e-deny",
    "X-Correlation-Id": "corr-e2e-deny",
  },
});
if (rejected.status !== 403 || rejected.payload.allowed !== false) {
  throw new Error("rejected step failed");
}

const metricsResponse = await fetch(`${baseUrl}/metrics`, {
  headers: {
    Authorization: "Bearer expected-token",
  },
});
if (metricsResponse.status !== 200) {
  throw new Error("metrics read failed");
}
const metrics = await metricsResponse.json();
if ((metrics.bridge_action_receipts_total?.accepted ?? 0) < 2) {
  throw new Error("accepted receipts counter below expected threshold");
}
if ((metrics.bridge_action_receipts_total?.duplicate ?? 0) < 1) {
  throw new Error("duplicate receipts counter below expected threshold");
}
if ((metrics.bridge_action_receipts_total?.rejected ?? 0) < 1) {
  throw new Error("rejected receipts counter below expected threshold");
}
if ((metrics.bridge_action_idempotency_replays_total ?? 0) < 1) {
  throw new Error("idempotency replays counter below expected threshold");
}

await server.stop();

const lines = [
  "# Action Idempotency Verification",
  "",
  `- Timestamp (UTC): ${new Date().toISOString()}`,
  "",
  "## Steps",
  "",
  `- submit: status=${submit.status}, duplicate=${submit.payload.duplicate}`,
  `- ack/replay: status=${ack.status}, duplicate=${ack.payload.duplicate}`,
  `- retry new key: status=${retry.status}, duplicate=${retry.payload.duplicate}`,
  `- rejected action: status=${rejected.status}, allowed=${rejected.payload.allowed}`,
  "",
  "## Metrics",
  "",
  `- bridge_action_receipts_total.accepted=${metrics.bridge_action_receipts_total.accepted}`,
  `- bridge_action_receipts_total.duplicate=${metrics.bridge_action_receipts_total.duplicate}`,
  `- bridge_action_receipts_total.rejected=${metrics.bridge_action_receipts_total.rejected}`,
  `- bridge_action_idempotency_replays_total=${metrics.bridge_action_idempotency_replays_total}`,
];

fs.mkdirSync("artifacts/security", { recursive: true });
fs.writeFileSync(process.argv[1], `${lines.join("\n")}\n`, "utf8");
' "${REPORT_PATH}"

run npm run verify:docker-smoke

log "Action idempotency verification passed"
log "Report: ${REPORT_PATH}"
