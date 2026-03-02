import assert from "node:assert/strict";
import test from "node:test";

import { BridgeIngestPipeline } from "../src/ingestPipeline.ts";
import type {
  BridgeEvent,
  BridgeEventEmitter,
  LogTailAdapter,
  PluginAdapter,
  PluginAdapterKind,
} from "../src/types.ts";

function makeEvent(eventType: string): BridgeEvent {
  return {
    version: "1.0",
    eventId: `evt-${eventType}`,
    occurredAt: "2026-03-01T00:00:00.000Z",
    eventType,
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

function createPluginAdapter(
  kind: PluginAdapterKind,
  options: { shouldReject?: () => boolean } = {},
): PluginAdapter {
  let emit: BridgeEventEmitter | null = null;

  return {
    name: "plugin",
    kind,
    async start(handler) {
      emit = handler;
    },
    async stop() {
      emit = null;
    },
    emitPluginEvent(payload: Record<string, unknown>) {
      const event = makeEvent(
        typeof payload.eventType === "string" ? payload.eventType : "plugin.event",
      );
      const reject = options.shouldReject?.() ?? false;
      if (!reject) {
        emit?.(event);
      }
      return {
        accepted: !reject,
        stub: kind !== "plugin-native",
        reason:
          reject && kind === "plugin-native"
            ? "simulated native plugin rejection"
            : kind === "plugin-native"
              ? undefined
              : "stub",
        reasonCode: reject ? "plugin_emit_rejected" : "plugin_emitted",
        event,
      };
    },
  };
}

function createLogTailAdapter(): LogTailAdapter {
  let emit: BridgeEventEmitter | null = null;
  return {
    name: "log-tail",
    kind: "log-tail",
    async start(handler) {
      emit = handler;
    },
    async stop() {
      emit = null;
    },
    ingestLine(_line: string) {
      const event = makeEvent("lane.enqueue");
      emit?.(event);
      return event;
    },
  };
}

test("pipeline uses fallback route when native plugin primary is disabled", async () => {
  const pipeline = new BridgeIngestPipeline({
    pluginAdapter: createPluginAdapter("plugin-stub"),
    logTailAdapter: createLogTailAdapter(),
    featureFlags: {
      nativePluginPrimary: false,
      logTailFallback: true,
    },
  });

  const emitted: BridgeEvent[] = [];
  await pipeline.start((event) => emitted.push(event));
  assert.equal(pipeline.getStrategy().mode, "fallback");
  assert.equal(pipeline.getStrategy().reasonCode, "primary_disabled");

  const result = pipeline.ingestFallbackLine("raw line");
  assert.equal(result.route, "fallback-log-tail");
  assert.equal(result.mode, "fallback");
  assert.equal(result.source, "log-tail-parser");
  assert.equal(result.event?.eventType, "lane.enqueue");
  assert.equal(emitted.length, 1);

  await pipeline.stop();
});

test("pipeline blocks traffic when plugin is stub and fallback is disabled", async () => {
  const pipeline = new BridgeIngestPipeline({
    pluginAdapter: createPluginAdapter("plugin-stub"),
    logTailAdapter: createLogTailAdapter(),
    featureFlags: {
      nativePluginPrimary: true,
      logTailFallback: false,
    },
  });

  await pipeline.start(() => {});
  assert.equal(pipeline.getStrategy().mode, "blocked");
  assert.equal(pipeline.getStrategy().reasonCode, "fallback_disabled");

  const pluginResult = pipeline.ingestPluginPayload({ eventType: "approval.requested" });
  assert.equal(pluginResult.route, "blocked");
  assert.equal(pluginResult.event, null);
  assert.equal(pluginResult.reasonCode, "fallback_disabled");

  const fallbackResult = pipeline.ingestFallbackLine("raw line");
  assert.equal(fallbackResult.route, "blocked");
  assert.equal(fallbackResult.event, null);
  assert.equal(fallbackResult.reasonCode, "fallback_disabled");

  await pipeline.stop();
});

test("pipeline routes to native plugin when plugin adapter is native", async () => {
  const pipeline = new BridgeIngestPipeline({
    pluginAdapter: createPluginAdapter("plugin-native"),
    logTailAdapter: createLogTailAdapter(),
    featureFlags: {
      nativePluginPrimary: true,
      logTailFallback: true,
    },
  });

  const emitted: BridgeEvent[] = [];
  await pipeline.start((event) => emitted.push(event));
  assert.equal(pipeline.getStrategy().mode, "primary");
  assert.equal(pipeline.getStrategy().reasonCode, "primary_healthy");

  const pluginResult = pipeline.ingestPluginPayload({ eventType: "approval.requested" });
  assert.equal(pluginResult.route, "plugin-primary");
  assert.equal(pluginResult.mode, "primary");
  assert.equal(pluginResult.source, "native-plugin");
  assert.equal(pluginResult.event?.eventType, "approval.requested");

  const fallbackResult = pipeline.ingestFallbackLine("raw line");
  assert.equal(fallbackResult.route, "blocked");
  assert.equal(fallbackResult.event, null);
  assert.equal(fallbackResult.reasonCode, "fallback_inactive_primary_healthy");
  assert.equal(emitted.length, 1);

  await pipeline.stop();
});

test("pipeline degrades to fallback when native plugin rejects and recovers on next success", async () => {
  let rejectNative = true;
  const pipeline = new BridgeIngestPipeline({
    pluginAdapter: createPluginAdapter("plugin-native", {
      shouldReject: () => rejectNative,
    }),
    logTailAdapter: createLogTailAdapter(),
    featureFlags: {
      nativePluginPrimary: true,
      logTailFallback: true,
    },
  });

  const emitted: BridgeEvent[] = [];
  await pipeline.start((event) => emitted.push(event));
  assert.equal(pipeline.getStrategy().mode, "primary");

  const rejectedPlugin = pipeline.ingestPluginPayload({
    eventType: "approval.requested",
  });
  assert.equal(rejectedPlugin.route, "blocked");
  assert.equal(rejectedPlugin.mode, "fallback");
  assert.equal(rejectedPlugin.event, null);
  assert.equal(rejectedPlugin.reasonCode, "primary_emit_rejected");

  const fallbackResult = pipeline.ingestFallbackLine("raw line");
  assert.equal(fallbackResult.route, "fallback-log-tail");
  assert.equal(fallbackResult.mode, "fallback");
  assert.equal(fallbackResult.event?.eventType, "lane.enqueue");

  rejectNative = false;
  const recoveredPlugin = pipeline.ingestPluginPayload({
    eventType: "approval.requested",
  });
  assert.equal(recoveredPlugin.route, "plugin-primary");
  assert.equal(recoveredPlugin.mode, "primary");
  assert.equal(recoveredPlugin.event?.eventType, "approval.requested");
  assert.equal(emitted.length, 2);

  await pipeline.stop();
});
