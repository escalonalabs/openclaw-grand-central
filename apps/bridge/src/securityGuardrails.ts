import type { BridgeEvent } from "./types.ts";
import {
  createActionPolicyEngine,
  type ActionPolicyDecision,
} from "./actionPolicyEngine.ts";

const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|api[_-]?key)/i;

type SecurityControl = "authn" | "authz" | "redaction" | "action-gate";
type SecurityDecision = "allow" | "deny" | "applied";

export interface SecurityAuditEvent {
  readonly control: SecurityControl;
  readonly decision: SecurityDecision;
  readonly reason: string;
  readonly scope?: string;
  readonly action?: string;
  readonly eventType?: string;
}

export interface SecurityRequiredScopes {
  readonly telemetryRead: string;
  readonly metricsRead: string;
  readonly actionWrite: string;
  readonly policyAdmin: string;
}

export interface SecurityAuthorizationResult {
  readonly allowed: boolean;
  readonly statusCode: number;
  readonly reason: string;
  readonly scopes: readonly string[];
}

export interface SecurityActionDecision {
  readonly allowed: boolean;
  readonly statusCode: number;
  readonly reason: string;
  readonly scope: string;
}

export interface SecurityActionPolicyDecision extends ActionPolicyDecision {}

export interface BridgeSecurityOptions {
  readonly tokenResolver?: () => string | readonly string[];
  readonly scopesResolver?: (token: string) => readonly string[];
  readonly requiredScopes?: Partial<SecurityRequiredScopes>;
  readonly redactHook?: (event: BridgeEvent) => BridgeEvent;
  readonly auditHook?: (event: SecurityAuditEvent) => void;
  readonly actionAllowlist?: readonly string[];
  readonly actionPolicy?: (
    action: string,
    scopes: readonly string[],
  ) => SecurityActionPolicyDecision;
}

export interface BridgeSecurityGuardrails {
  readonly requiredScopes: SecurityRequiredScopes;
  authorize(
    authorizationHeader: string | readonly string[] | undefined,
    requiredScope: string,
  ): SecurityAuthorizationResult;
  redactEvent(event: BridgeEvent): BridgeEvent | null;
  decideAction(
    action: string,
    authorizationHeader: string | readonly string[] | undefined,
    requiredScope?: string,
  ): SecurityActionDecision;
}

const DEFAULT_REQUIRED_SCOPES: SecurityRequiredScopes = {
  telemetryRead: "telemetry:read",
  metricsRead: "metrics:read",
  actionWrite: "control:write",
  policyAdmin: "policy:admin",
};

const DEFAULT_SCOPE_SET = [
  DEFAULT_REQUIRED_SCOPES.telemetryRead,
  DEFAULT_REQUIRED_SCOPES.metricsRead,
];

export function createBridgeSecurityGuardrails(
  options: BridgeSecurityOptions = {},
): BridgeSecurityGuardrails {
  const requiredScopes: SecurityRequiredScopes = {
    telemetryRead:
      options.requiredScopes?.telemetryRead ?? DEFAULT_REQUIRED_SCOPES.telemetryRead,
    metricsRead:
      options.requiredScopes?.metricsRead ?? DEFAULT_REQUIRED_SCOPES.metricsRead,
    actionWrite: options.requiredScopes?.actionWrite ?? DEFAULT_REQUIRED_SCOPES.actionWrite,
    policyAdmin:
      options.requiredScopes?.policyAdmin ?? DEFAULT_REQUIRED_SCOPES.policyAdmin,
  };
  const auditHook = options.auditHook ?? (() => {});
  const tokenResolver = options.tokenResolver ?? (() => resolveRuntimeEnv().OPENCLAW_BRIDGE_TOKEN ?? "");
  const scopesResolver =
    options.scopesResolver ?? (() => parseScopes(resolveRuntimeEnv().OPENCLAW_BRIDGE_SCOPES));
  const redactHook = options.redactHook ?? defaultRedactHook;
  const defaultActionPolicyEngine = createActionPolicyEngine({
    allowlist: options.actionAllowlist,
  });
  const actionPolicy =
    options.actionPolicy ??
    ((action: string) => defaultActionPolicyEngine.decide(action));

  return {
    requiredScopes,
    authorize(authorizationHeader, requiredScope) {
      const expectedTokens = resolveExpectedTokens(tokenResolver());
      const providedToken = extractBearerToken(authorizationHeader);

      if (expectedTokens.length === 0) {
        auditHook({
          control: "authn",
          decision: "deny",
          reason: "token_not_configured",
        });
        return {
          allowed: false,
          statusCode: 503,
          reason: "token_not_configured",
          scopes: [],
        };
      }

      if (!providedToken) {
        auditHook({
          control: "authn",
          decision: "deny",
          reason: "invalid_or_missing_token",
        });
        return {
          allowed: false,
          statusCode: 401,
          reason: "invalid_or_missing_token",
          scopes: [],
        };
      }

      const matchedToken = expectedTokens.find((candidateToken) =>
        constantTimeStringEqual(providedToken, candidateToken),
      );
      if (!matchedToken) {
        auditHook({
          control: "authn",
          decision: "deny",
          reason: "invalid_or_missing_token",
        });
        return {
          allowed: false,
          statusCode: 401,
          reason: "invalid_or_missing_token",
          scopes: [],
        };
      }

      auditHook({
        control: "authn",
        decision: "allow",
        reason: "token_valid",
      });

      const grantedScopes = toUniqueScopes(scopesResolver(matchedToken));
      if (!grantedScopes.includes(requiredScope)) {
        auditHook({
          control: "authz",
          decision: "deny",
          reason: "missing_scope",
          scope: requiredScope,
        });
        return {
          allowed: false,
          statusCode: 403,
          reason: "missing_scope",
          scopes: grantedScopes,
        };
      }

      return {
        allowed: true,
        statusCode: 200,
        reason: "ok",
        scopes: grantedScopes,
      };
    },
    redactEvent(event) {
      try {
        const redacted = redactHook(event);
        auditHook({
          control: "redaction",
          decision: "applied",
          reason: "ok",
          eventType: event.eventType,
        });
        return redacted;
      } catch {
        auditHook({
          control: "redaction",
          decision: "deny",
          reason: "hook_error",
          eventType: event.eventType,
        });
        return null;
      }
    },
    decideAction(action, authorizationHeader, requiredScope = requiredScopes.actionWrite) {
      const authz = this.authorize(authorizationHeader, requiredScope);
      if (!authz.allowed) {
        auditHook({
          control: "action-gate",
          decision: "deny",
          reason: authz.reason,
          scope: requiredScope,
          action,
        });
        return {
          allowed: false,
          statusCode: authz.statusCode,
          reason: authz.reason,
          scope: requiredScope,
        };
      }

      const decision = actionPolicy(action, authz.scopes);
      const allowed = decision.allowed;
      const statusCode = decision.statusCode ?? (allowed ? 202 : 403);
      auditHook({
        control: "action-gate",
        decision: allowed ? "allow" : "deny",
        reason: decision.reason,
        scope: requiredScope,
        action,
      });

      return {
        allowed,
        statusCode,
        reason: decision.reason,
        scope: requiredScope,
      };
    },
  };
}

export function extractBearerToken(
  headerValue: string | readonly string[] | undefined,
): string {
  const rawValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof rawValue !== "string") {
    return "";
  }

  const match = rawValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export function defaultRedactHook(event: BridgeEvent): BridgeEvent {
  const cloned = cloneValue(event) as BridgeEvent;

  function redact(node: unknown): void {
    if (!node || typeof node !== "object") {
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        (node as Record<string, unknown>)[key] = "[REDACTED]";
        continue;
      }

      redact(value);
    }
  }

  redact(cloned);
  return cloned;
}

function parseScopes(rawValue: string | undefined): readonly string[] {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return DEFAULT_SCOPE_SET;
  }

  const scopes = rawValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return scopes.length > 0 ? scopes : DEFAULT_SCOPE_SET;
}

function constantTimeStringEqual(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    mismatch |= leftCode ^ rightCode;
  }

  return mismatch === 0;
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  if (value && typeof value === "object") {
    const cloned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      cloned[key] = cloneValue(item);
    }
    return cloned;
  }

  return value;
}

function toUniqueScopes(scopes: readonly string[]): readonly string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
}

function resolveExpectedTokens(
  resolvedTokenValue: string | readonly string[],
): readonly string[] {
  if (typeof resolvedTokenValue === "string") {
    const token = resolvedTokenValue.trim();
    if (token.length === 0) {
      return [];
    }

    return [token];
  }

  if (Array.isArray(resolvedTokenValue)) {
    return resolvedTokenValue
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}

function resolveRuntimeEnv(): Record<string, string | undefined> {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return maybeProcess.process?.env ?? {};
}
