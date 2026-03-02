import assert from "node:assert/strict";
import test from "node:test";

import { createLogTailAdapter, parseLogLine } from "../src/index.ts";

test("parseLogLine parses JSON log lines into canonical intermediate shape", () => {
  const parsed = parseLogLine(
    '{"timestamp":"2026-03-01T17:10:00.000Z","event":"tool.start","laneId":"lane-1","agentId":"agent-1","message":"tool started","meta":{"tool":"bash"}}'
  );

  assert.equal(parsed?.event, "tool.start");
  assert.equal(parsed?.laneId, "lane-1");
  assert.equal(parsed?.agentId, "agent-1");
  assert.equal(parsed?.metadata.tool, "bash");
});

test("log-tail adapter parses key-value lines and emits normalized station events", async () => {
  const emitted: unknown[] = [];
  const adapter = createLogTailAdapter();
  await adapter.start((event) => emitted.push(event));

  const event = adapter.ingestLine(
    '2026-03-01T17:00:00.000Z level=warn event=exec.approval lane=lane-22 agent=agent-5 station=workspace-omnia message="approval required" queueDepth=3'
  );

  assert.equal(event?.eventType, "exec.approval");
  assert.equal(event?.severity, "warn");
  assert.equal(event?.source.laneId, "lane-22");
  assert.equal(event?.source.agentId, "agent-5");
  assert.equal(event?.source.workspaceId, "workspace-omnia");
  assert.equal(event?.payload.queueDepth, 3);
  assert.equal(emitted.length, 1);

  await adapter.stop();
});

test("log-tail adapter maps approval.requested payload to canonical keys", async () => {
  const emitted: unknown[] = [];
  const adapter = createLogTailAdapter();
  await adapter.start((event) => emitted.push(event));

  const event = adapter.ingestLine(
    '2026-03-01T17:00:00.000Z level=warn event=approval.requested lane=lane-22 agent=agent-5 station=workspace-omnia command="npm run deploy"'
  );

  assert.equal(event?.eventType, "approval.requested");
  assert.deepEqual(event?.payload, {
    approvalId: "unknown-approval",
    command: "npm run deploy",
  });
  assert.equal(emitted.length, 1);

  await adapter.stop();
});

test("log-tail adapter ignores empty lines", async () => {
  const emitted: unknown[] = [];
  const adapter = createLogTailAdapter();
  await adapter.start((event) => emitted.push(event));

  const event = adapter.ingestLine("   ");
  assert.equal(event, null);
  assert.equal(emitted.length, 0);

  await adapter.stop();
});
