import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAdapterContract,
  createLogTailAdapter,
  createPluginAdapter,
} from "../src/index.ts";

test("log-tail adapter implements the bridge adapter contract", async () => {
  const emitted: unknown[] = [];
  const adapter = createLogTailAdapter();

  assert.doesNotThrow(() => assertAdapterContract(adapter));

  await adapter.start((event) => emitted.push(event));

  const event = adapter.ingestLine(
    '{"timestamp":"2026-03-01T16:00:00.000Z","event":"lane.enqueue","laneId":"lane-a","agentId":"agent-7","message":"queued","level":"info"}'
  );

  assert.equal(event?.eventType, "lane.enqueue");
  assert.equal(event?.source.agentId, "agent-7");
  assert.equal(event?.source.laneId, "lane-a");
  assert.deepEqual(event?.payload, {
    queueDepth: 0,
    position: 0,
  });
  assert.equal(emitted.length, 1);

  await adapter.stop();
});

test("plugin adapter is a callable stub and remains contract compliant", async () => {
  const emitted: unknown[] = [];
  const adapter = createPluginAdapter();

  assert.doesNotThrow(() => assertAdapterContract(adapter));

  await adapter.start((event) => emitted.push(event));

  const result = adapter.emitPluginEvent({
    timestamp: "2026-03-01T16:02:00.000Z",
    event: "plugin.todo",
    laneId: "lane-plugin",
    message: "stub invocation",
  });

  assert.equal(result.stub, true);
  assert.equal(result.event.eventType, "plugin.todo");
  assert.equal(result.event.source.agentId, "plugin-stub");
  assert.equal(result.event.source.laneId, "lane-plugin");
  assert.equal(emitted.length, 1);

  await adapter.stop();
});

test("plugin adapter supports native transport mode", async () => {
  const emitted: unknown[] = [];
  const adapter = createPluginAdapter({
    transportMode: "http-ingest",
  });

  assert.doesNotThrow(() => assertAdapterContract(adapter));
  assert.equal(adapter.kind, "plugin-native");

  await adapter.start((event) => emitted.push(event));

  const result = adapter.emitPluginEvent({
    timestamp: "2026-03-01T16:03:00.000Z",
    event: "approval.requested",
    laneId: "lane-native",
    agentId: "agent-native",
    message: "native payload",
  });

  assert.equal(result.stub, false);
  assert.equal(result.reason, undefined);
  assert.equal(result.event.eventType, "approval.requested");
  assert.equal(result.event.source.agentId, "agent-native");
  assert.equal(result.event.source.laneId, "lane-native");
  assert.equal(emitted.length, 1);

  await adapter.stop();
});
