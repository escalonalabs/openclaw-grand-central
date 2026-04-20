import assert from "node:assert/strict";
import test from "node:test";

import { BridgeCore, type BridgeClient } from "../src/bridgeCore.ts";
import type { BridgeEvent } from "../src/types.ts";

class FakeClient implements BridgeClient {
  public readonly id: string;
  public readonly messages: string[] = [];
  public closeReason: { code?: number; reason?: string } | null = null;

  public constructor(id: string) {
    this.id = id;
  }

  public send(payload: string): void {
    this.messages.push(payload);
  }

  public close(code?: number, reason?: string): void {
    this.closeReason = { code, reason };
  }
}

function eventOf(id: string): BridgeEvent {
  return {
    type: id,
    payload: { id },
    timestamp: 1,
  };
}

test("bridge core applies drop-newest policy under queue pressure", () => {
  const core = new BridgeCore({
    queueCapacity: 2,
    dropPolicy: "drop-newest",
    autoFlush: false,
  });

  const client = new FakeClient("client-1");
  core.addOrReplaceClient(client);

  core.publish(eventOf("event-1"));
  core.publish(eventOf("event-2"));
  core.publish(eventOf("event-3"));

  const beforeFlush = core.getMetrics();
  assert.deepEqual(beforeFlush, {
    droppedEvents: 1,
    connectedClients: 1,
    queueDepth: 2,
  });

  core.flushNow();

  const afterFlush = core.getMetrics();
  assert.deepEqual(afterFlush, {
    droppedEvents: 1,
    connectedClients: 1,
    queueDepth: 0,
  });

  const parsedEvents = client.messages.map((message) => {
    return JSON.parse(message) as BridgeEvent;
  });
  assert.deepEqual(
    parsedEvents.map((message) => message.type),
    ["event-1", "event-2"],
  );
});

test("bridge core replaces same-id client and closes previous connection", () => {
  const core = new BridgeCore({
    queueCapacity: 4,
    dropPolicy: "drop-oldest",
    autoFlush: false,
  });

  const firstClient = new FakeClient("stable-client");
  const secondClient = new FakeClient("stable-client");

  core.addOrReplaceClient(firstClient);
  const replacement = core.addOrReplaceClient(secondClient);

  assert.equal(replacement.replaced, true);
  assert.deepEqual(firstClient.closeReason, {
    code: 4001,
    reason: "reconnected",
  });
  assert.deepEqual(core.getMetrics(), {
    droppedEvents: 0,
    connectedClients: 1,
    queueDepth: 0,
  });
});
