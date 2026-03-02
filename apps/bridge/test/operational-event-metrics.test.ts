import assert from "node:assert/strict";
import test from "node:test";

import {
  BridgeOperationalEventMetricsRegistry,
  resolveBridgeEventQos,
} from "../src/operationalEventMetrics.ts";
import type { BridgeEvent } from "../src/types.ts";

function eventOf(
  eventType: string,
  occurredAt: string,
  payload: Record<string, unknown> = {},
  laneId = "lane-main",
  sessionId = "session-1",
): BridgeEvent {
  return {
    version: "1.0",
    eventId: `${eventType}-${occurredAt}`,
    occurredAt,
    eventType,
    severity: "info",
    source: {
      agentId: "agent-test",
      workspaceId: "workspace-omnia",
      laneId,
      sessionId,
    },
    payload,
  };
}

test("resolveBridgeEventQos maps payload override and event types", () => {
  assert.equal(
    resolveBridgeEventQos(eventOf("lane.enqueue", "2026-03-01T12:00:00.000Z")),
    "stateful",
  );
  assert.equal(
    resolveBridgeEventQos(eventOf("approval.requested", "2026-03-01T12:00:00.000Z")),
    "critical",
  );
  assert.equal(
    resolveBridgeEventQos(
      eventOf("telemetry.unknown", "2026-03-01T12:00:00.000Z", { qos: "critical" }),
    ),
    "critical",
  );
  assert.equal(
    resolveBridgeEventQos(eventOf("render.tick", "2026-03-01T12:00:00.000Z")),
    "best_effort",
  );
});

test("operational metrics track qos counters and e2e latency snapshots", () => {
  const registry = new BridgeOperationalEventMetricsRegistry({
    maxLatencySamples: 64,
  });

  const emittedAtMs = new Date("2026-03-01T12:00:10.000Z").valueOf();
  registry.recordEmitAttempt(
    eventOf("approval.requested", "2026-03-01T12:00:09.500Z"),
    emittedAtMs,
  ); // 500ms critical
  registry.recordEmitAttempt(
    eventOf("lane.enqueue", "2026-03-01T12:00:09.000Z"),
    emittedAtMs,
  ); // 1000ms stateful
  registry.recordEmitAttempt(
    eventOf(
      "render.tick",
      "2026-03-01T12:00:08.000Z",
      {},
      "lane-secondary",
      "session-2",
    ),
    emittedAtMs,
  ); // 2000ms best_effort

  const snapshot = registry.snapshot();

  assert.equal(snapshot.bridge_events_total, 3);
  assert.deepEqual(snapshot.bridge_events_qos_total, {
    best_effort: 1,
    stateful: 1,
    critical: 1,
  });
  assert.deepEqual(snapshot.bridge_events_lane_total, {
    "lane-main": 2,
    "lane-secondary": 1,
  });
  assert.deepEqual(snapshot.bridge_events_session_total, {
    "session-1": 2,
    "session-2": 1,
  });

  assert.equal(snapshot.bridge_event_e2e_latency_ms.total.count, 3);
  assert.equal(snapshot.bridge_event_e2e_latency_ms.total.min, 500);
  assert.equal(snapshot.bridge_event_e2e_latency_ms.total.max, 2000);
  assert.equal(snapshot.bridge_event_e2e_latency_ms.by_qos.critical.count, 1);
  assert.equal(snapshot.bridge_event_e2e_latency_ms.by_qos.stateful.count, 1);
  assert.equal(snapshot.bridge_event_e2e_latency_ms.by_qos.best_effort.count, 1);
});

test("operational metrics ignore invalid occurredAt for latency but keep counters", () => {
  const registry = new BridgeOperationalEventMetricsRegistry({
    maxLatencySamples: 64,
  });

  registry.recordEmitAttempt(
    eventOf("approval.requested", "invalid-time"),
    Date.now(),
  );
  const snapshot = registry.snapshot();

  assert.equal(snapshot.bridge_events_total, 1);
  assert.equal(snapshot.bridge_events_qos_total.critical, 1);
  assert.equal(snapshot.bridge_event_e2e_latency_ms.total.count, 0);
});
