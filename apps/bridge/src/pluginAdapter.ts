import { assertAdapterContract } from "./adapterContract.ts";
import { normalizeStationEvent } from "./normalizeStationEvent.ts";
import type { BridgeEventEmitter, PluginAdapter } from "./types.ts";

export type PluginTransportMode = "stub" | "http-ingest";

export interface PluginAdapterOptions {
  readonly sourceDefaults?: {
    readonly agentId?: string;
    readonly workspaceId?: string;
    readonly laneId?: string;
    readonly sessionId?: string;
  };
  readonly transportMode?: PluginTransportMode;
}

export function createPluginAdapter(options: PluginAdapterOptions = {}): PluginAdapter {
  const transportMode = resolveTransportMode(options.transportMode);
  const adapterKind = transportMode === "http-ingest" ? "plugin-native" : "plugin-stub";
  const sourceDefaults = {
    agentId:
      options.sourceDefaults?.agentId ??
      (adapterKind === "plugin-native" ? "plugin-native" : "plugin-stub"),
    workspaceId: options.sourceDefaults?.workspaceId ?? "workspace-unknown",
    laneId: options.sourceDefaults?.laneId ?? "lane-unknown",
    sessionId: options.sourceDefaults?.sessionId ?? "session-unknown",
  };

  let emit: BridgeEventEmitter | null = null;
  let running = false;

  const adapter: PluginAdapter = {
    name: "plugin",
    kind: adapterKind,
    async start(handler) {
      if (typeof handler !== "function") {
        throw new TypeError("plugin adapter start(handler) requires a function.");
      }

      emit = handler;
      running = true;
    },
    async stop() {
      emit = null;
      running = false;
    },
    emitPluginEvent(payload: Record<string, unknown> = {}) {
      const event = normalizeStationEvent({
        timestamp: toTimestamp(payload.timestamp ?? payload.ts ?? payload.time),
        eventType: toNonEmptyString(payload.event ?? payload.type) ?? "plugin.todo",
        level: toNonEmptyString(payload.level) ?? "info",
        source: {
          agentId:
            toNonEmptyString(payload.agentId ?? payload.agent) ?? sourceDefaults.agentId,
          workspaceId:
            toNonEmptyString(
              payload.workspaceId ??
                payload.workspace ??
                payload.stationId ??
                payload.station,
            ) ??
            sourceDefaults.workspaceId,
          laneId: toNonEmptyString(payload.laneId ?? payload.lane) ?? sourceDefaults.laneId,
          sessionId:
            toNonEmptyString(payload.sessionId ?? payload.session) ??
            sourceDefaults.sessionId,
        },
        payload: {
          message:
            toNonEmptyString(payload.message) ??
            (adapterKind === "plugin-native"
              ? "plugin adapter native ingest payload accepted"
              : "plugin adapter stub: payload accepted, transport not wired yet"),
          ...toRecord(payload.metadata),
          ...(adapterKind === "plugin-native" ? {} : { stub: true }),
        },
        raw: payload,
      });

      if (running && emit) {
        emit(event);
      }

      return {
        accepted: true,
        stub: adapterKind !== "plugin-native",
        reason:
          adapterKind === "plugin-native"
            ? undefined
            : "OpenClaw production plugin transport is not integrated in this MVP.",
        reasonCode: adapterKind === "plugin-native" ? "plugin_emitted" : "plugin_stub",
        event,
      };
    },
  };

  return assertAdapterContract(adapter);
}

function toTimestamp(value: unknown): string | number | Date | undefined {
  if (value instanceof Date || typeof value === "string" || typeof value === "number") {
    return value;
  }

  return undefined;
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized === "" ? undefined : normalized;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function resolveTransportMode(
  explicitMode: PluginTransportMode | undefined,
): PluginTransportMode {
  if (explicitMode) {
    return explicitMode;
  }

  const env = resolveRuntimeEnv();
  const rawMode = env.OPENCLAW_BRIDGE_PLUGIN_TRANSPORT?.trim().toLowerCase();
  if (rawMode === "http-ingest") {
    return "http-ingest";
  }

  return "stub";
}

function resolveRuntimeEnv(): Record<string, string | undefined> {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return maybeProcess.process?.env ?? {};
}
