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

function eventOf(
  id: string,
  overrides: {
    laneId?: string;
    sessionId?: string;
    eventType?: string;
    qos?: "critical" | "stateful" | "best_effort";
    priority?: string;
  } = {},
): BridgeEvent {
  const payload: Record<string, unknown> = { id };
  if (overrides.qos) {
    payload.qos = overrides.qos;
  }
  if (overrides.priority) {
    payload.priority = overrides.priority;
  }

  return {
    version: "1.0",
    eventId: id,
    occurredAt: "2026-03-01T12:00:00.000Z",
    eventType: overrides.eventType ?? id,
    severity: "info",
    source: {
      agentId: "agent-test",
      workspaceId: "workspace-omnia",
      laneId: overrides.laneId ?? "lane-main",
      sessionId: overrides.sessionId ?? "session-test",
    },
    payload,
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
    parsedEvents.map((message) => message.eventType),
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

test("bridge core applies weighted fairness by qos and round robin by lane", () => {
  const core = new BridgeCore({
    queueCapacity: 64,
    dropPolicy: "drop-oldest",
    autoFlush: false,
  });
  const client = new FakeClient("client-fair");
  core.addOrReplaceClient(client);

  for (let index = 0; index < 6; index += 1) {
    core.publish(
      eventOf(`critical-a-${index}`, {
        laneId: "lane-a",
        eventType: "approval.requested",
        qos: "critical",
      }),
    );
    core.publish(
      eventOf(`critical-b-${index}`, {
        laneId: "lane-b",
        eventType: "approval.requested",
        qos: "critical",
      }),
    );
  }

  for (let index = 0; index < 3; index += 1) {
    core.publish(
      eventOf(`best-c-${index}`, {
        laneId: "lane-c",
        eventType: "render.tick",
        qos: "best_effort",
      }),
    );
  }

  core.flushNow();

  const emittedEvents = client.messages.map((message) => {
    return JSON.parse(message) as BridgeEvent;
  });

  const firstBestEffortIndex = emittedEvents.findIndex((event) => {
    return event.source.laneId === "lane-c";
  });
  assert.notEqual(firstBestEffortIndex, -1);
  assert.equal(firstBestEffortIndex <= 6, true);

  const firstCriticalWindow = emittedEvents
    .slice(0, 8)
    .filter((event) => event.payload.qos === "critical");
  const criticalLaneCounts = firstCriticalWindow.reduce<Record<string, number>>(
    (counts, event) => {
      const laneId = event.source.laneId;
      counts[laneId] = (counts[laneId] ?? 0) + 1;
      return counts;
    },
    {},
  );

  assert.equal((criticalLaneCounts["lane-a"] ?? 0) > 0, true);
  assert.equal((criticalLaneCounts["lane-b"] ?? 0) > 0, true);

  assert.deepEqual(core.getMetrics(), {
    droppedEvents: 0,
    connectedClients: 1,
    queueDepth: 0,
  });
});
