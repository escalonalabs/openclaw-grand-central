import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { connect, type Socket } from "node:net";
import test from "node:test";

import { WebSocketBridgeServer } from "../src/websocketServer.ts";
import type { BridgeEvent } from "../src/types.ts";

async function waitForNextTick(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function openAuthorizedRawWebSocket(
  host: string,
  port: number,
  token: string,
): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = connect(port, host);
    let response = "";

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer) => {
      response += chunk.toString("utf8");
      if (!response.includes("\r\n\r\n")) {
        return;
      }

      cleanup();
      if (response.startsWith("HTTP/1.1 101")) {
        resolve(socket);
        return;
      }

      socket.destroy();
      reject(new Error(`websocket handshake failed: ${response.split("\r\n")[0] ?? ""}`));
    };

    socket.on("error", onError);
    socket.on("data", onData);
    socket.on("connect", () => {
      const websocketKey = createHash("sha1")
        .update(`${Date.now()}-${Math.random()}`)
        .digest("base64");
      socket.write(
        `GET /events HTTP/1.1\r\n` +
          `Host: ${host}:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          `Sec-WebSocket-Key: ${websocketKey}\r\n` +
          `Authorization: Bearer ${token}\r\n` +
          "\r\n",
      );
    });
  });
}

function eventOf(
  id: string,
  eventType: string,
  occurredAt: string,
  payload: Record<string, unknown> = {},
): BridgeEvent {
  return {
    version: "1.0",
    eventId: id,
    occurredAt,
    eventType,
    severity: "info",
    source: {
      agentId: "agent-test",
      workspaceId: "workspace-omnia",
      laneId: "lane-main",
      sessionId: "session-a",
    },
    payload,
  };
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
    version: "1.0",
    eventId: "evt-one",
    occurredAt: "2026-03-01T12:00:01.000Z",
    eventType: "one",
    severity: "info",
    source: {
      agentId: "agent-test",
      workspaceId: "workspace-omnia",
      laneId: "lane-main",
      sessionId: "session-a",
    },
    payload: { n: 1 },
  });
  server.publish({
    version: "1.0",
    eventId: "evt-two",
    occurredAt: "2026-03-01T12:00:02.000Z",
    eventType: "two",
    severity: "info",
    source: {
      agentId: "agent-test",
      workspaceId: "workspace-omnia",
      laneId: "lane-main",
      sessionId: "session-a",
    },
    payload: { n: 2 },
  });
  server.publish({
    version: "1.0",
    eventId: "evt-three",
    occurredAt: "2026-03-01T12:00:03.000Z",
    eventType: "three",
    severity: "info",
    source: {
      agentId: "agent-test",
      workspaceId: "workspace-omnia",
      laneId: "lane-main",
      sessionId: "session-a",
    },
    payload: { n: 3 },
  });

  await waitForNextTick();
  const snapshot = server.getMetrics();

  assert.deepEqual(snapshot, {
    droppedEvents: 1,
    connectedClients: 0,
    queueDepth: 0,
  });
});

test("server exposes e2e latency and qos counters in operational metrics", async () => {
  const server = new WebSocketBridgeServer({
    host: "127.0.0.1",
    port: 30_001,
    queueCapacity: 8,
    dropPolicy: "drop-oldest",
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 120_000,
  });

  const baseTime = Date.now();
  server.publish(
    eventOf(
      "evt-critical",
      "approval.requested",
      new Date(baseTime - 150).toISOString(),
    ),
  );
  server.publish(
    eventOf(
      "evt-stateful",
      "lane.enqueue",
      new Date(baseTime - 300).toISOString(),
    ),
  );
  server.publish(
    eventOf(
      "evt-best",
      "render.tick",
      new Date(baseTime - 600).toISOString(),
    ),
  );

  await waitForNextTick();
  const snapshot = server.getOperationalMetrics();

  assert.equal(snapshot.bridge_events_total, 3);
  assert.deepEqual(snapshot.bridge_events_qos_total, {
    best_effort: 1,
    stateful: 1,
    critical: 1,
  });
  assert.deepEqual(snapshot.bridge_events_lane_total, {
    "lane-main": 3,
  });
  assert.deepEqual(snapshot.bridge_events_session_total, {
    "session-a": 3,
  });
  assert.equal(snapshot.bridge_event_e2e_latency_ms.total.count, 3);
  assert.equal(snapshot.bridge_event_e2e_latency_ms.by_qos.critical.count, 1);
  assert.equal(snapshot.bridge_event_e2e_latency_ms.by_qos.stateful.count, 1);
  assert.equal(snapshot.bridge_event_e2e_latency_ms.by_qos.best_effort.count, 1);
  assert.equal(snapshot.bridge_event_e2e_latency_ms.total.max >= 150, true);
});

test("server enforces authn/authz on /metrics and exposes security counters", async () => {
  const server = new WebSocketBridgeServer({
    host: "127.0.0.1",
    port: 0,
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 120_000,
    security: {
      tokenResolver: () => "expected-token",
      scopesResolver: () => ["metrics:read", "telemetry:read", "control:write"],
      actionAllowlist: [],
    },
  });

  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;

  const unauthorized = await fetch(`${baseUrl}/metrics`);
  assert.equal(unauthorized.status, 401);

  const forbidden = await fetch(`${baseUrl}/metrics`, {
    headers: {
      Authorization: "Bearer wrong-token",
    },
  });
  assert.equal(forbidden.status, 401);

  const authorized = await fetch(`${baseUrl}/metrics`, {
    headers: {
      Authorization: "Bearer expected-token",
    },
  });
  assert.equal(authorized.status, 200);

  const actionDecision = await fetch(`${baseUrl}/actions/restart-lane`, {
    method: "POST",
    headers: {
      Authorization: "Bearer expected-token",
    },
  });
  assert.equal(actionDecision.status, 403);
  const actionDecisionPayload = (await actionDecision.json()) as {
    action: string;
    allowed: boolean;
    reason: string;
    scope: string;
    duplicate: boolean;
  };
  assert.equal(actionDecisionPayload.reason, "action_allowlist_empty");
  assert.equal(actionDecisionPayload.duplicate, false);

  const metricsAfterAction = await fetch(`${baseUrl}/metrics`, {
    headers: {
      Authorization: "Bearer expected-token",
    },
  });
  assert.equal(metricsAfterAction.status, 200);

  const snapshot = (await metricsAfterAction.json()) as {
    bridge_events_total: number;
    bridge_events_qos_total: {
      best_effort: number;
      stateful: number;
      critical: number;
    };
    bridge_events_session_total: Record<string, number>;
    bridge_event_e2e_latency_ms: {
      total: { count: number };
      by_qos: {
        best_effort: { count: number };
        stateful: { count: number };
        critical: { count: number };
      };
    };
    bridge_authn_failures_total: number;
    bridge_authz_denies_total: number;
    bridge_redaction_applied_total: number;
    bridge_redaction_failures_total: number;
    bridge_action_gate_decisions_total: { allow: number; deny: number };
    bridge_action_receipts_total: {
      accepted: number;
      duplicate: number;
      rejected: number;
    };
    bridge_action_idempotency_replays_total: number;
    bridge_policy_pack_state: {
      active_pack_id: string;
      active_pack_version: number;
      history_depth: number;
    };
    bridge_policy_pack_operations_total: {
      validate: { accepted: number; rejected: number };
      apply: { accepted: number; rejected: number };
      rollback: { accepted: number; rejected: number };
    };
  };

  assert.equal(snapshot.bridge_events_total, 0);
  assert.deepEqual(snapshot.bridge_events_qos_total, {
    best_effort: 0,
    stateful: 0,
    critical: 0,
  });
  assert.deepEqual(snapshot.bridge_events_session_total, {});
  assert.equal(snapshot.bridge_event_e2e_latency_ms.total.count, 0);
  assert.equal(snapshot.bridge_authn_failures_total >= 2, true);
  assert.equal(snapshot.bridge_authz_denies_total, 0);
  assert.equal(snapshot.bridge_redaction_applied_total, 0);
  assert.equal(snapshot.bridge_redaction_failures_total, 0);
  assert.deepEqual(snapshot.bridge_action_gate_decisions_total, {
    allow: 0,
    deny: 1,
  });
  assert.deepEqual(snapshot.bridge_action_receipts_total, {
    accepted: 0,
    duplicate: 0,
    rejected: 1,
  });
  assert.equal(snapshot.bridge_action_idempotency_replays_total, 0);
  assert.equal(snapshot.bridge_policy_pack_state.active_pack_version, 1);
  assert.equal(snapshot.bridge_policy_pack_state.history_depth, 0);
  assert.deepEqual(snapshot.bridge_policy_pack_operations_total, {
    validate: { accepted: 0, rejected: 0 },
    apply: { accepted: 0, rejected: 0 },
    rollback: { accepted: 0, rejected: 0 },
  });

  await server.stop();
});

test("server exposes prometheus metrics with authz and json parity", async () => {
  const server = new WebSocketBridgeServer({
    host: "127.0.0.1",
    port: 0,
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 120_000,
    security: {
      tokenResolver: () => "expected-token",
      scopesResolver: () => ["metrics:read", "telemetry:read", "control:write"],
    },
  });

  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;
  server.publish(
    eventOf(
      "evt-prometheus",
      "approval.requested",
      new Date(Date.now() - 350).toISOString(),
      { qos: "critical" },
    ),
  );
  await waitForNextTick();

  const unauthorized = await fetch(`${baseUrl}/metrics/prometheus`);
  assert.equal(unauthorized.status, 401);

  const authorized = await fetch(`${baseUrl}/metrics/prometheus`, {
    headers: {
      Authorization: "Bearer expected-token",
    },
  });
  assert.equal(authorized.status, 200);
  const contentType = authorized.headers.get("content-type") ?? "";
  assert.equal(contentType.includes("text/plain"), true);
  const prometheusText = await authorized.text();

  const jsonMetricsResponse = await fetch(`${baseUrl}/metrics`, {
    headers: {
      Authorization: "Bearer expected-token",
    },
  });
  assert.equal(jsonMetricsResponse.status, 200);
  const snapshot = (await jsonMetricsResponse.json()) as {
    bridge_events_total: number;
    bridge_authn_failures_total: number;
    bridge_action_gate_decisions_total: { allow: number; deny: number };
    bridge_action_receipts_total: { accepted: number; duplicate: number; rejected: number };
    bridge_action_idempotency_replays_total: number;
    bridge_policy_pack_state: {
      active_pack_id: string;
      active_pack_version: number;
      history_depth: number;
    };
    bridge_policy_pack_operations_total: {
      validate: { accepted: number; rejected: number };
      apply: { accepted: number; rejected: number };
      rollback: { accepted: number; rejected: number };
    };
    bridge_events_qos_total: {
      critical: number;
    };
    bridge_events_lane_total: Record<string, number>;
    bridge_events_session_total: Record<string, number>;
  };

  assert.equal(
    prometheusText.includes(`bridge_events_total ${snapshot.bridge_events_total}`),
    true,
  );
  assert.equal(
    prometheusText.includes(
      `bridge_events_qos_total{qos="critical"} ${snapshot.bridge_events_qos_total.critical}`,
    ),
    true,
  );
  assert.equal(
    prometheusText.includes(
      `bridge_events_lane_total{lane="lane-main"} ${snapshot.bridge_events_lane_total["lane-main"] ?? 0}`,
    ),
    true,
  );
  assert.equal(
    prometheusText.includes(
      `bridge_events_session_total{session="session-a"} ${snapshot.bridge_events_session_total["session-a"] ?? 0}`,
    ),
    true,
  );
  assert.equal(
    prometheusText.includes(
      `bridge_authn_failures_total ${snapshot.bridge_authn_failures_total}`,
    ),
    true,
  );
  assert.equal(
    prometheusText.includes(
      `bridge_action_gate_decisions_total{decision="allow"} ${snapshot.bridge_action_gate_decisions_total.allow}`,
    ),
    true,
  );
  assert.equal(
    prometheusText.includes(
      `bridge_action_gate_decisions_total{decision="deny"} ${snapshot.bridge_action_gate_decisions_total.deny}`,
    ),
    true,
  );
  assert.equal(
    prometheusText.includes(
      `bridge_action_receipts_total{status="accepted"} ${snapshot.bridge_action_receipts_total.accepted}`,
    ),
    true,
  );
  assert.equal(
    prometheusText.includes(
      `bridge_action_idempotency_replays_total ${snapshot.bridge_action_idempotency_replays_total}`,
    ),
    true,
  );
  assert.equal(
    prometheusText.includes(
      `bridge_policy_pack_active_version ${snapshot.bridge_policy_pack_state.active_pack_version}`,
    ),
    true,
  );
  assert.equal(
    prometheusText.includes(
      `bridge_policy_pack_history_depth ${snapshot.bridge_policy_pack_state.history_depth}`,
    ),
    true,
  );
  assert.equal(
    prometheusText.includes(
      `bridge_policy_pack_operations_total{operation="apply",result="accepted"} ${snapshot.bridge_policy_pack_operations_total.apply.accepted}`,
    ),
    true,
  );
  assert.equal(
    prometheusText.includes('bridge_event_e2e_latency_ms_total{stat="p95"}'),
    true,
  );
  assert.equal(
    prometheusText.includes('bridge_event_e2e_latency_ms_by_qos{qos="critical",stat="p99"}'),
    true,
  );

  await server.stop();
});

test("server action gate allows configured actions and returns reason codes", async () => {
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

  const allowed = await fetch(`${baseUrl}/actions/restart-lane`, {
    method: "POST",
    headers: {
      Authorization: "Bearer expected-token",
    },
  });
  assert.equal(allowed.status, 202);
  const allowedPayload = (await allowed.json()) as {
    action: string;
    allowed: boolean;
    reason: string;
    scope: string;
    duplicate: boolean;
    idempotencyKey: string;
    correlationId: string;
    receipt: {
      receiptId: string;
      status: string;
      attempts: number;
    };
  };
  assert.equal(allowedPayload.allowed, true);
  assert.equal(allowedPayload.reason, "action_allowed");
  assert.equal(allowedPayload.duplicate, false);
  assert.equal(allowedPayload.receipt.status, "accepted");
  assert.equal(allowedPayload.receipt.attempts, 1);

  const denied = await fetch(`${baseUrl}/actions/stop-lane`, {
    method: "POST",
    headers: {
      Authorization: "Bearer expected-token",
    },
  });
  assert.equal(denied.status, 403);
  const deniedPayload = (await denied.json()) as {
    action: string;
    allowed: boolean;
    reason: string;
    scope: string;
    duplicate: boolean;
    receipt: {
      status: string;
    };
  };
  assert.equal(deniedPayload.allowed, false);
  assert.equal(deniedPayload.reason, "action_not_allowlisted");
  assert.equal(deniedPayload.duplicate, false);
  assert.equal(deniedPayload.receipt.status, "rejected");

  const invalid = await fetch(`${baseUrl}/actions/restart/lane`, {
    method: "POST",
    headers: {
      Authorization: "Bearer expected-token",
    },
  });
  assert.equal(invalid.status, 400);
  const invalidPayload = (await invalid.json()) as {
    action: string;
    allowed: boolean;
    reason: string;
    scope: string;
    duplicate: boolean;
    receipt: {
      status: string;
      statusCode: number;
    };
  };
  assert.equal(invalidPayload.allowed, false);
  assert.equal(invalidPayload.reason, "action_invalid");
  assert.equal(invalidPayload.duplicate, false);
  assert.equal(invalidPayload.receipt.status, "rejected");
  assert.equal(invalidPayload.receipt.statusCode, 400);

  const firstIdempotent = await fetch(`${baseUrl}/actions/restart-lane`, {
    method: "POST",
    headers: {
      Authorization: "Bearer expected-token",
      "Idempotency-Key": "idem-123",
      "X-Correlation-Id": "corr-123",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payload: {
        laneId: "lane-a",
      },
    }),
  });
  assert.equal(firstIdempotent.status, 202);
  const firstPayload = (await firstIdempotent.json()) as {
    duplicate: boolean;
    receipt: {
      receiptId: string;
      attempts: number;
      status: string;
    };
    correlationId: string;
  };
  assert.equal(firstPayload.duplicate, false);
  assert.equal(firstPayload.correlationId, "corr-123");
  assert.equal(firstPayload.receipt.status, "accepted");
  assert.equal(firstPayload.receipt.attempts, 1);

  const replayedIdempotent = await fetch(`${baseUrl}/actions/restart-lane`, {
    method: "POST",
    headers: {
      Authorization: "Bearer expected-token",
      "Idempotency-Key": "idem-123",
      "X-Correlation-Id": "corr-456",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payload: {
        laneId: "lane-a",
      },
    }),
  });
  assert.equal(replayedIdempotent.status, 200);
  const replayPayload = (await replayedIdempotent.json()) as {
    duplicate: boolean;
    correlationId: string;
    receipt: {
      receiptId: string;
      attempts: number;
      status: string;
    };
  };
  assert.equal(replayPayload.duplicate, true);
  assert.equal(replayPayload.correlationId, "corr-123");
  assert.equal(replayPayload.receipt.receiptId, firstPayload.receipt.receiptId);
  assert.equal(replayPayload.receipt.attempts, 2);
  assert.equal(replayPayload.receipt.status, "duplicate");

  await server.stop();
});

test("server policy pack lifecycle supports validate apply rollback without downtime", async () => {
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
  const host = "127.0.0.1";
  const port = server.getPort();
  const baseUrl = `http://${host}:${port}`;
  const activeSocket = await openAuthorizedRawWebSocket(host, port, "expected-token");

  try {
    const unauthorized = await fetch(`${baseUrl}/policy/packs`);
    assert.equal(unauthorized.status, 401);

    const stateBefore = await fetch(`${baseUrl}/policy/packs`, {
      headers: {
        Authorization: "Bearer expected-token",
      },
    });
    assert.equal(stateBefore.status, 200);
    const stateBeforePayload = (await stateBefore.json()) as {
      activePack: {
        packId: string;
        allowlist: readonly string[];
        version: number;
      };
      historyDepth: number;
    };
    assert.equal(stateBeforePayload.activePack.version, 1);
    assert.equal(stateBeforePayload.activePack.allowlist.includes("restart-lane"), true);
    assert.equal(stateBeforePayload.historyDepth, 0);

    const invalidValidate = await fetch(`${baseUrl}/policy/packs/validate`, {
      method: "POST",
      headers: {
        Authorization: "Bearer expected-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        packId: "ops/v2",
        allowlist: ["restart/lane"],
      }),
    });
    assert.equal(invalidValidate.status, 200);
    const invalidValidatePayload = (await invalidValidate.json()) as {
      valid: boolean;
      issues: Array<{ code: string }>;
    };
    assert.equal(invalidValidatePayload.valid, false);
    assert.equal(
      invalidValidatePayload.issues.some((issue) => issue.code === "policy_pack_id_invalid"),
      true,
    );

    const apply = await fetch(`${baseUrl}/policy/packs/apply`, {
      method: "POST",
      headers: {
        Authorization: "Bearer expected-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        packId: "ops-v2",
        description: "operate pause lane only",
        allowlist: ["pause-lane"],
      }),
    });
    assert.equal(apply.status, 202);
    const applyPayload = (await apply.json()) as {
      applied: boolean;
      activePack: { version: number; packId: string };
      historyDepth: number;
    };
    assert.equal(applyPayload.applied, true);
    assert.equal(applyPayload.activePack.packId, "ops-v2");
    assert.equal(applyPayload.activePack.version, 2);
    assert.equal(applyPayload.historyDepth, 1);

    const restartDenied = await fetch(`${baseUrl}/actions/restart-lane`, {
      method: "POST",
      headers: {
        Authorization: "Bearer expected-token",
      },
    });
    assert.equal(restartDenied.status, 403);
    const restartDeniedPayload = (await restartDenied.json()) as { reason: string };
    assert.equal(restartDeniedPayload.reason, "action_not_allowlisted");

    const pauseAllowed = await fetch(`${baseUrl}/actions/pause-lane`, {
      method: "POST",
      headers: {
        Authorization: "Bearer expected-token",
      },
    });
    assert.equal(pauseAllowed.status, 202);

    const rollback = await fetch(`${baseUrl}/policy/packs/rollback`, {
      method: "POST",
      headers: {
        Authorization: "Bearer expected-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetPackId: "runtime-default",
      }),
    });
    assert.equal(rollback.status, 202);
    const rollbackPayload = (await rollback.json()) as {
      rolledBack: boolean;
      rolledBackToPackId: string;
      activePack: {
        packId: string;
        version: number;
      };
      historyDepth: number;
    };
    assert.equal(rollbackPayload.rolledBack, true);
    assert.equal(rollbackPayload.rolledBackToPackId, "runtime-default");
    assert.equal(rollbackPayload.activePack.version, 1);
    assert.equal(rollbackPayload.historyDepth, 0);

    const restartAllowedAgain = await fetch(`${baseUrl}/actions/restart-lane`, {
      method: "POST",
      headers: {
        Authorization: "Bearer expected-token",
      },
    });
    assert.equal(restartAllowedAgain.status, 202);

    await waitForNextTick();
    assert.equal(server.getMetrics().connectedClients, 1);

    const metricsResponse = await fetch(`${baseUrl}/metrics`, {
      headers: {
        Authorization: "Bearer expected-token",
      },
    });
    assert.equal(metricsResponse.status, 200);
    const metrics = (await metricsResponse.json()) as {
      bridge_policy_pack_state: {
        active_pack_id: string;
        active_pack_version: number;
        history_depth: number;
      };
      bridge_policy_pack_operations_total: {
        validate: { accepted: number; rejected: number };
        apply: { accepted: number; rejected: number };
        rollback: { accepted: number; rejected: number };
      };
    };
    assert.equal(metrics.bridge_policy_pack_state.active_pack_id, "runtime-default");
    assert.equal(metrics.bridge_policy_pack_state.active_pack_version, 1);
    assert.equal(metrics.bridge_policy_pack_state.history_depth, 0);
    assert.equal(metrics.bridge_policy_pack_operations_total.validate.rejected >= 1, true);
    assert.equal(metrics.bridge_policy_pack_operations_total.apply.accepted >= 1, true);
    assert.equal(metrics.bridge_policy_pack_operations_total.rollback.accepted >= 1, true);
  } finally {
    activeSocket.destroy();
    await server.stop();
  }
});

test("server accepts native plugin ingest payloads when wired", async () => {
  const ingestedPayloads: Array<Record<string, unknown>> = [];
  const server = new WebSocketBridgeServer({
    host: "127.0.0.1",
    port: 0,
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 120_000,
    security: {
      tokenResolver: () => "expected-token",
      scopesResolver: () => ["metrics:read", "telemetry:read", "control:write"],
    },
    ingestPluginPayload: (payload) => {
      ingestedPayloads.push(payload);
      return {
        route: "plugin-primary",
        mode: "primary",
        source: "native-plugin",
        event: {
          version: "1.0",
          eventId: "evt-plugin-1",
          occurredAt: "2026-03-01T20:00:00.000Z",
          eventType: "approval.requested",
          severity: "info",
          source: {
            agentId: "plugin-native",
            workspaceId: "workspace-omnia",
            laneId: "lane-1",
            sessionId: "session-1",
          },
          payload: {
            approvalId: "ap-1",
            command: "deploy",
          },
        },
      };
    },
  });

  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;

  const rejectedWithoutAuth = await fetch(`${baseUrl}/ingest/plugin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ eventType: "approval.requested" }),
  });
  assert.equal(rejectedWithoutAuth.status, 401);

  const accepted = await fetch(`${baseUrl}/ingest/plugin`, {
    method: "POST",
    headers: {
      Authorization: "Bearer expected-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      eventType: "approval.requested",
      agentId: "agent-native",
      laneId: "lane-native",
    }),
  });

  assert.equal(accepted.status, 202);
  const payload = (await accepted.json()) as {
    accepted: boolean;
    eventId: string;
    route: string;
    mode: string;
    source: string;
  };
  assert.equal(payload.accepted, true);
  assert.equal(payload.route, "plugin-primary");
  assert.equal(payload.mode, "primary");
  assert.equal(payload.source, "native-plugin");
  assert.equal(payload.eventId, "evt-plugin-1");
  assert.equal(ingestedPayloads.length, 1);
  assert.equal(ingestedPayloads[0].eventType, "approval.requested");

  await server.stop();
});

test("server surfaces deterministic reasonCode when plugin ingest is degraded", async () => {
  const server = new WebSocketBridgeServer({
    host: "127.0.0.1",
    port: 0,
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 120_000,
    security: {
      tokenResolver: () => "expected-token",
      scopesResolver: () => ["metrics:read", "telemetry:read", "control:write"],
    },
    ingestPluginPayload: () => ({
      route: "blocked",
      mode: "fallback",
      source: "none",
      event: null,
      reasonCode: "primary_emit_rejected",
      reason: "native plugin rejected payload; fallback path is active",
    }),
  });

  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;

  const degraded = await fetch(`${baseUrl}/ingest/plugin`, {
    method: "POST",
    headers: {
      Authorization: "Bearer expected-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ eventType: "approval.requested" }),
  });

  assert.equal(degraded.status, 503);
  const payload = (await degraded.json()) as {
    error: string;
    reasonCode: string;
    mode: string;
    route: string;
  };
  assert.equal(payload.error, "native plugin rejected payload; fallback path is active");
  assert.equal(payload.reasonCode, "primary_emit_rejected");
  assert.equal(payload.mode, "fallback");
  assert.equal(payload.route, "blocked");

  await server.stop();
});

test("server rotates token/scopes without dropping active websocket clients", async () => {
  const server = new WebSocketBridgeServer({
    host: "127.0.0.1",
    port: 0,
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 120_000,
    security: {
      tokenResolver: () => "token-old",
      scopesResolver: () => ["metrics:read", "telemetry:read", "control:write"],
    },
  });

  await server.start();
  const host = "127.0.0.1";
  const port = server.getPort();
  const baseUrl = `http://${host}:${port}`;
  const activeSocket = await openAuthorizedRawWebSocket(host, port, "token-old");

  await waitForNextTick();
  assert.equal(server.getMetrics().connectedClients, 1);

  const rotationOne = await fetch(`${baseUrl}/security/rotate`, {
    method: "POST",
    headers: {
      Authorization: "Bearer token-old",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: "token-new",
      scopes: ["metrics:read", "telemetry:read", "control:write"],
      graceMs: 0,
    }),
  });
  assert.equal(rotationOne.status, 202);
  const rotationOnePayload = (await rotationOne.json()) as {
    rotated: boolean;
    graceMsApplied: number;
    activeScopes: readonly string[];
  };
  assert.equal(rotationOnePayload.rotated, true);
  assert.equal(rotationOnePayload.graceMsApplied, 0);
  assert.equal(rotationOnePayload.activeScopes.includes("metrics:read"), true);

  await waitForNextTick();
  assert.equal(server.getMetrics().connectedClients, 1);

  const oldTokenDenied = await fetch(`${baseUrl}/metrics`, {
    headers: {
      Authorization: "Bearer token-old",
    },
  });
  assert.equal(oldTokenDenied.status, 401);

  const newTokenAllowed = await fetch(`${baseUrl}/metrics`, {
    headers: {
      Authorization: "Bearer token-new",
    },
  });
  assert.equal(newTokenAllowed.status, 200);

  const rotationTwo = await fetch(`${baseUrl}/security/rotate`, {
    method: "POST",
    headers: {
      Authorization: "Bearer token-new",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: "token-newer",
      scopes: ["telemetry:read", "control:write"],
      graceMs: 0,
    }),
  });
  assert.equal(rotationTwo.status, 202);

  const metricsMissingScope = await fetch(`${baseUrl}/metrics`, {
    headers: {
      Authorization: "Bearer token-newer",
    },
  });
  assert.equal(metricsMissingScope.status, 403);
  const missingScopePayload = (await metricsMissingScope.json()) as {
    error: string;
  };
  assert.equal(missingScopePayload.error, "missing_scope");

  const actionWithRotatedToken = await fetch(`${baseUrl}/actions/restart-lane`, {
    method: "POST",
    headers: {
      Authorization: "Bearer token-newer",
    },
  });
  assert.equal(actionWithRotatedToken.status, 403);
  const actionPayload = (await actionWithRotatedToken.json()) as {
    reason: string;
  };
  assert.equal(actionPayload.reason, "action_allowlist_empty");

  activeSocket.end();
  await server.stop();
});
