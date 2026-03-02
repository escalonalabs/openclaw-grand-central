#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
REPORT_PATH="${ROOT_DIR}/artifacts/security/policy-pack-rollback-report.md"

log() {
  printf '[verify:policy-pack-rollback] %s\n' "$1"
}

run() {
  log "Running: $*"
  "$@"
}

cd "${ROOT_DIR}"

run npm --workspace @openclaw/bridge test -- --test-name-pattern "policy pack"

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
    scopesResolver: () => [
      "metrics:read",
      "telemetry:read",
      "control:write",
      "policy:admin",
    ],
    actionAllowlist: ["restart-lane", "resume-lane"],
  },
});

await server.start();
const baseUrl = `http://127.0.0.1:${server.getPort()}`;

const postJson = async (path, body = {}, headers = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer expected-token",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { status: response.status, payload };
};

const invokeAction = async (action) => {
  const response = await fetch(`${baseUrl}/actions/${action}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer expected-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const payload = await response.json();
  return { status: response.status, payload };
};

const invalidValidation = await postJson("/policy/packs/validate", {
  packId: "ops/v2",
  allowlist: ["restart/lane"],
});
if (invalidValidation.status !== 200 || invalidValidation.payload.valid !== false) {
  throw new Error("invalid validation scenario failed");
}

const apply = await postJson("/policy/packs/apply", {
  packId: "ops-v2",
  description: "temporary pause lane control",
  allowlist: ["pause-lane"],
});
if (apply.status !== 202 || apply.payload.applied !== true) {
  throw new Error("policy pack apply failed");
}

const restartDenied = await invokeAction("restart-lane");
if (restartDenied.status !== 403 || restartDenied.payload.reason !== "action_not_allowlisted") {
  throw new Error("post-apply deny behavior failed");
}

const pauseAllowed = await invokeAction("pause-lane");
if (pauseAllowed.status !== 202 || pauseAllowed.payload.allowed !== true) {
  throw new Error("post-apply allow behavior failed");
}

const rollback = await postJson("/policy/packs/rollback", {
  targetPackId: "runtime-default",
});
if (rollback.status !== 202 || rollback.payload.rolledBack !== true) {
  throw new Error("policy pack rollback failed");
}

const restartAllowedAgain = await invokeAction("restart-lane");
if (restartAllowedAgain.status !== 202 || restartAllowedAgain.payload.allowed !== true) {
  throw new Error("post-rollback allow behavior failed");
}

const stateResponse = await fetch(`${baseUrl}/policy/packs`, {
  headers: {
    Authorization: "Bearer expected-token",
  },
});
if (stateResponse.status !== 200) {
  throw new Error("policy state read failed");
}
const state = await stateResponse.json();
if (state.activePack?.packId !== "runtime-default") {
  throw new Error("unexpected active policy pack after rollback");
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
if ((metrics.bridge_policy_pack_operations_total?.validate?.rejected ?? 0) < 1) {
  throw new Error("policy validate rejected counter below expected threshold");
}
if ((metrics.bridge_policy_pack_operations_total?.apply?.accepted ?? 0) < 1) {
  throw new Error("policy apply accepted counter below expected threshold");
}
if ((metrics.bridge_policy_pack_operations_total?.rollback?.accepted ?? 0) < 1) {
  throw new Error("policy rollback accepted counter below expected threshold");
}

await server.stop();

const lines = [
  "# Policy Pack Rollback Verification",
  "",
  `- Timestamp (UTC): ${new Date().toISOString()}`,
  "",
  "## Lifecycle",
  "",
  `- validate invalid pack: status=${invalidValidation.status}, valid=${invalidValidation.payload.valid}`,
  `- apply pack ops-v2: status=${apply.status}, applied=${apply.payload.applied}`,
  `- restart denied after apply: status=${restartDenied.status}, reason=${restartDenied.payload.reason}`,
  `- pause allowed after apply: status=${pauseAllowed.status}, allowed=${pauseAllowed.payload.allowed}`,
  `- rollback to runtime-default: status=${rollback.status}, rolledBack=${rollback.payload.rolledBack}`,
  `- restart allowed after rollback: status=${restartAllowedAgain.status}, allowed=${restartAllowedAgain.payload.allowed}`,
  "",
  "## Metrics",
  "",
  `- bridge_policy_pack_operations_total.validate.rejected=${metrics.bridge_policy_pack_operations_total.validate.rejected}`,
  `- bridge_policy_pack_operations_total.apply.accepted=${metrics.bridge_policy_pack_operations_total.apply.accepted}`,
  `- bridge_policy_pack_operations_total.rollback.accepted=${metrics.bridge_policy_pack_operations_total.rollback.accepted}`,
  `- bridge_policy_pack_state.active_pack_id=${metrics.bridge_policy_pack_state.active_pack_id}`,
  `- bridge_policy_pack_state.active_pack_version=${metrics.bridge_policy_pack_state.active_pack_version}`,
];

fs.mkdirSync("artifacts/security", { recursive: true });
fs.writeFileSync(process.argv[1], `${lines.join("\n")}\n`, "utf8");
' "${REPORT_PATH}"

run npm run verify:docker-smoke

log "Policy pack rollback verification passed"
log "Report: ${REPORT_PATH}"
