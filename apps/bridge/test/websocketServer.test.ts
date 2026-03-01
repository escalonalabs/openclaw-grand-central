import assert from "node:assert/strict";
import test from "node:test";

import { WebSocketBridgeServer } from "../src/websocketServer.ts";

async function waitForNextTick(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

test("server metrics track queue drops without requiring network binds", async () => {
  const server = new WebSocketBridgeServer({
    host: "127.0.0.1",
    port: 30_000,
    queueCapacity: 2,
    dropPolicy: "drop-newest",
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 120_000,
  });

  server.publish({
    type: "one",
    payload: { n: 1 },
    timestamp: 1,
  });
  server.publish({
    type: "two",
    payload: { n: 2 },
    timestamp: 2,
  });
  server.publish({
    type: "three",
    payload: { n: 3 },
    timestamp: 3,
  });

  await waitForNextTick();
  const snapshot = server.getMetrics();

  assert.deepEqual(snapshot, {
    droppedEvents: 1,
    connectedClients: 0,
    queueDepth: 0,
  });
});
