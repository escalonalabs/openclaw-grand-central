import assert from "node:assert/strict";
import test from "node:test";

import type { BridgeIngestResult } from "../src/ingestPipeline.ts";
import {
  createPluginIngestHandlerErrorPayload,
  normalizePluginIngestResult,
} from "../src/websocketServer.ts";

function makeEvent() {
  return {
    version: "1.0",
    eventId: "evt-1",
    occurredAt: "2026-03-02T00:00:00.000Z",
    eventType: "approval.requested",
    severity: "info",
    source: {
      agentId: "agent-1",
      workspaceId: "workspace-omnia",
      laneId: "lane-1",
      sessionId: "session-1",
    },
    payload: {},
  };
}

test(
  "plugin ingest normalization preserves deterministic degrade reasonCode when event is unavailable",
  () => {
    const degraded: BridgeIngestResult = {
      route: "blocked",
      mode: "fallback",
      source: "none",
      event: null,
      reasonCode: "primary_emit_rejected",
      reason: "Native plugin rejected payload.",
    };

    const normalized = normalizePluginIngestResult(degraded);
    assert.equal(normalized.ok, false);
    if (!normalized.ok) {
      assert.equal(normalized.value.error, "Native plugin rejected payload.");
      assert.equal(normalized.value.reasonCode, "primary_emit_rejected");
      assert.equal(normalized.value.mode, "fallback");
      assert.equal(normalized.value.route, "blocked");
    }
  },
);

test("plugin ingest normalization rejects invalid result shape", () => {
  const invalid = {
    route: "blocked",
    mode: "fallback",
    source: "none",
    event: null,
    reasonCode: 500,
  } as unknown as BridgeIngestResult;

  const normalized = normalizePluginIngestResult(invalid);
  assert.equal(normalized.ok, false);
  if (!normalized.ok) {
    assert.equal(normalized.value.error, "plugin_ingest_invalid_result");
    assert.equal(normalized.value.reasonCode, "plugin_ingest_invalid_result");
    assert.equal(normalized.value.mode, "blocked");
    assert.equal(normalized.value.route, "blocked");
  }
});

test("plugin ingest normalization returns accepted event for valid payload", () => {
  const accepted: BridgeIngestResult = {
    route: "plugin-primary",
    mode: "primary",
    source: "native-plugin",
    event: makeEvent(),
  };

  const normalized = normalizePluginIngestResult(accepted);
  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.equal(normalized.value.event.eventId, "evt-1");
    assert.equal(normalized.value.route, "plugin-primary");
    assert.equal(normalized.value.mode, "primary");
    assert.equal(normalized.value.source, "native-plugin");
  }
});

test("plugin ingest handler error payload is deterministic", () => {
  const payload = createPluginIngestHandlerErrorPayload();
  assert.deepEqual(payload, {
    error: "plugin_ingest_handler_error",
    reasonCode: "plugin_ingest_handler_error",
    mode: "blocked",
    route: "blocked",
  });
});
