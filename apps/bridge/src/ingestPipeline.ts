import {
  createLogTailAdapter,
  type LogTailAdapterOptions,
} from "./logTailAdapter.ts";
import {
  createPluginAdapter,
  type PluginAdapterOptions,
} from "./pluginAdapter.ts";
import type {
  BridgeEvent,
  BridgeEventEmitter,
  LogTailAdapter,
  PluginAdapter,
} from "./types.ts";

export interface BridgeIngestFeatureFlags {
  readonly nativePluginPrimary: boolean;
  readonly logTailFallback: boolean;
}

export interface BridgeIngestPipelineOptions {
  readonly pluginAdapter?: PluginAdapter;
  readonly logTailAdapter?: LogTailAdapter;
  readonly pluginOptions?: PluginAdapterOptions;
  readonly logTailOptions?: LogTailAdapterOptions;
  readonly featureFlags?: Partial<BridgeIngestFeatureFlags>;
}

export type BridgeIngestMode = "primary" | "fallback" | "blocked";
export type BridgeIngestRoute = "plugin-primary" | "fallback-log-tail" | "blocked";
export type BridgeIngestSource = "native-plugin" | "log-tail-parser" | "none";
export type BridgeIngestReasonCode =
  | "primary_healthy"
  | "primary_disabled"
  | "primary_transport_stub"
  | "primary_unavailable"
  | "primary_emit_rejected"
  | "fallback_disabled"
  | "fallback_inactive_primary_healthy"
  | "fallback_line_ignored";

export interface BridgeIngestStrategy {
  readonly primaryInput: "native-plugin";
  readonly fallbackInput: "log-tail-parser" | "disabled";
  readonly mode: BridgeIngestMode;
  readonly reasonCode: BridgeIngestReasonCode;
  readonly reason: string | null;
}

export interface BridgeIngestResult {
  readonly route: BridgeIngestRoute;
  readonly mode: BridgeIngestMode;
  readonly source: BridgeIngestSource;
  readonly event: BridgeEvent | null;
  readonly reasonCode?: BridgeIngestReasonCode;
  readonly reason?: string;
}

const DEFAULT_INGEST_FLAGS: BridgeIngestFeatureFlags = {
  nativePluginPrimary: false,
  logTailFallback: true,
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function resolveBridgeIngestFeatureFlags(
  env: Record<string, string | undefined> = resolveRuntimeEnv(),
): BridgeIngestFeatureFlags {
  return {
    nativePluginPrimary: parseBooleanFlag(
      env.OPENCLAW_BRIDGE_NATIVE_PLUGIN_ENABLED,
      DEFAULT_INGEST_FLAGS.nativePluginPrimary,
    ),
    logTailFallback: parseBooleanFlag(
      env.OPENCLAW_BRIDGE_LOG_FALLBACK_ENABLED,
      DEFAULT_INGEST_FLAGS.logTailFallback,
    ),
  };
}

export class BridgeIngestPipeline {
  private readonly pluginAdapter: PluginAdapter;
  private readonly logTailAdapter: LogTailAdapter;
  private readonly featureFlags: BridgeIngestFeatureFlags;
  private started = false;
  private primaryDegraded = false;

  public constructor(options: BridgeIngestPipelineOptions = {}) {
    const envFlags = resolveBridgeIngestFeatureFlags();
    this.featureFlags = {
      nativePluginPrimary:
        options.featureFlags?.nativePluginPrimary ?? envFlags.nativePluginPrimary,
      logTailFallback: options.featureFlags?.logTailFallback ?? envFlags.logTailFallback,
    };
    this.pluginAdapter =
      options.pluginAdapter ?? createPluginAdapter(options.pluginOptions);
    this.logTailAdapter =
      options.logTailAdapter ?? createLogTailAdapter(options.logTailOptions);
  }

  public async start(handler: BridgeEventEmitter): Promise<void> {
    if (this.started) {
      return;
    }

    await this.pluginAdapter.start(handler);
    await this.logTailAdapter.start(handler);
    this.started = true;
  }

  public async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.pluginAdapter.stop();
    await this.logTailAdapter.stop();
    this.started = false;
  }

  public getStrategy(): BridgeIngestStrategy {
    const fallbackInput = this.featureFlags.logTailFallback
      ? "log-tail-parser"
      : "disabled";

    if (this.isNativePluginReady()) {
      return {
        primaryInput: "native-plugin",
        fallbackInput,
        mode: "primary",
        reasonCode: "primary_healthy",
        reason: null,
      };
    }

    if (this.primaryDegraded) {
      if (this.featureFlags.logTailFallback) {
        return {
          primaryInput: "native-plugin",
          fallbackInput,
          mode: "fallback",
          reasonCode: "primary_emit_rejected",
          reason:
            "Native plugin primary is degraded after emit rejection; fallback route is active.",
        };
      }

      return {
        primaryInput: "native-plugin",
        fallbackInput,
        mode: "blocked",
        reasonCode: "fallback_disabled",
        reason:
          "Native plugin primary is degraded after emit rejection. Log-tail fallback is disabled (OPENCLAW_BRIDGE_LOG_FALLBACK_ENABLED=0).",
      };
    }

    const primaryGap = this.describePrimaryGap();

    if (this.featureFlags.logTailFallback) {
      return {
        primaryInput: "native-plugin",
        fallbackInput,
        mode: "fallback",
        reasonCode: primaryGap.reasonCode,
        reason: primaryGap.reason,
      };
    }

    return {
      primaryInput: "native-plugin",
      fallbackInput,
      mode: "blocked",
      reasonCode: "fallback_disabled",
      reason: `${primaryGap.reason} Log-tail fallback is disabled (OPENCLAW_BRIDGE_LOG_FALLBACK_ENABLED=0).`,
    };
  }

  public ingestPluginPayload(payload: Record<string, unknown> = {}): BridgeIngestResult {
    if (!this.isNativePluginConfigured()) {
      const strategy = this.getStrategy();
      return {
        route: "blocked",
        mode: strategy.mode,
        source: "none",
        event: null,
        reasonCode: strategy.reasonCode,
        reason: strategy.reason ?? undefined,
      };
    }

    const result = this.pluginAdapter.emitPluginEvent(payload);
    const accepted = result.accepted ?? true;
    if (!accepted || !result.event) {
      this.primaryDegraded = true;
      const reasonCode = "primary_emit_rejected" as const;
      const reason =
        result.reason ??
        "Native plugin primary rejected payload during ingest processing.";
      if (this.featureFlags.logTailFallback) {
        return {
          route: "blocked",
          mode: "fallback",
          source: "none",
          event: null,
          reasonCode,
          reason: `${reason} Fallback remains available via log-tail parser.`,
        };
      }

      return {
        route: "blocked",
        mode: "blocked",
        source: "none",
        event: null,
        reasonCode,
        reason: `${reason} Log-tail fallback is disabled (OPENCLAW_BRIDGE_LOG_FALLBACK_ENABLED=0).`,
      };
    }

    this.primaryDegraded = false;
    return {
      route: "plugin-primary",
      mode: "primary",
      source: "native-plugin",
      event: result.event,
    };
  }

  public ingestFallbackLine(line: string): BridgeIngestResult {
    if (this.getStrategy().mode === "primary") {
      return {
        route: "blocked",
        mode: "primary",
        source: "none",
        event: null,
        reasonCode: "fallback_inactive_primary_healthy",
        reason:
          "Fallback parser is secondary and inactive while native plugin primary is healthy.",
      };
    }

    if (!this.featureFlags.logTailFallback) {
      return {
        route: "blocked",
        mode: "blocked",
        source: "none",
        event: null,
        reasonCode: "fallback_disabled",
        reason:
          "Fallback parser is disabled (OPENCLAW_BRIDGE_LOG_FALLBACK_ENABLED=0).",
      };
    }

    const event = this.logTailAdapter.ingestLine(line);
    if (!event) {
      return {
        route: "fallback-log-tail",
        mode: "fallback",
        source: "log-tail-parser",
        event: null,
        reasonCode: "fallback_line_ignored",
        reason: "Log-tail parser ignored an empty or unparseable line.",
      };
    }

    return {
      route: "fallback-log-tail",
      mode: "fallback",
      source: "log-tail-parser",
      event,
    };
  }

  private isNativePluginReady(): boolean {
    return this.isNativePluginConfigured() && !this.primaryDegraded;
  }

  private isNativePluginConfigured(): boolean {
    return (
      this.featureFlags.nativePluginPrimary &&
      this.pluginAdapter.kind === "plugin-native"
    );
  }

  private describePrimaryGap(): {
    reasonCode: BridgeIngestReasonCode;
    reason: string;
  } {
    if (!this.featureFlags.nativePluginPrimary) {
      return {
        reasonCode: "primary_disabled",
        reason:
          "Native plugin primary is disabled (OPENCLAW_BRIDGE_NATIVE_PLUGIN_ENABLED=0).",
      };
    }

    if (this.pluginAdapter.kind !== "plugin-native") {
      return {
        reasonCode: "primary_transport_stub",
        reason:
          "Native plugin transport is not wired; adapter is running in \"plugin-stub\" mode.",
      };
    }

    return {
      reasonCode: "primary_unavailable",
      reason: "Native plugin primary is unavailable.",
    };
  }
}

function parseBooleanFlag(rawValue: string | undefined, fallback: boolean): boolean {
  if (rawValue === undefined) {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return fallback;
}

function resolveRuntimeEnv(): Record<string, string | undefined> {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };

  return maybeProcess.process?.env ?? {};
}
