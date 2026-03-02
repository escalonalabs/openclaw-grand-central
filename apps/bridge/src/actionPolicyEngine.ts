export type ActionPolicyReasonCode =
  | "action_allowed"
  | "action_invalid"
  | "action_allowlist_empty"
  | "action_not_allowlisted";

export type ActionPolicyPackValidationErrorCode =
  | "policy_pack_id_invalid"
  | "policy_pack_allowlist_required"
  | "policy_pack_allowlist_empty"
  | "policy_pack_action_invalid";

export type ActionPolicyPackApplyReasonCode =
  | "policy_pack_applied"
  | "policy_pack_invalid"
  | "policy_pack_id_conflict";

export type ActionPolicyPackRollbackReasonCode =
  | "policy_pack_rollback_applied"
  | "policy_pack_rollback_unavailable"
  | "policy_pack_target_not_found";

export interface ActionPolicyDecision {
  readonly allowed: boolean;
  readonly reason: ActionPolicyReasonCode;
  readonly statusCode: number;
}

export interface ActionPolicyEngineOptions {
  readonly allowlist?: readonly string[];
  readonly env?: Record<string, string | undefined>;
}

export interface ActionPolicyEngine {
  readonly allowlist: readonly string[];
  decide(action: string): ActionPolicyDecision;
}

export interface ActionPolicyPack {
  readonly packId: string;
  readonly version: number;
  readonly allowlist: readonly string[];
  readonly description?: string;
  readonly createdAt: string;
}

export interface ActionPolicyPackInput {
  readonly packId?: string;
  readonly allowlist?: readonly string[];
  readonly description?: string;
}

export interface ActionPolicyPackValidationIssue {
  readonly code: ActionPolicyPackValidationErrorCode;
  readonly detail?: string;
}

export interface ActionPolicyPackValidationResult {
  readonly valid: boolean;
  readonly packId: string;
  readonly allowlist: readonly string[];
  readonly issues: readonly ActionPolicyPackValidationIssue[];
}

export interface ActionPolicyPackApplyResult {
  readonly applied: boolean;
  readonly reason: ActionPolicyPackApplyReasonCode;
  readonly activePack: ActionPolicyPack;
  readonly previousPack: ActionPolicyPack | null;
  readonly validation: ActionPolicyPackValidationResult;
  readonly historyDepth: number;
}

export interface ActionPolicyPackRollbackResult {
  readonly rolledBack: boolean;
  readonly reason: ActionPolicyPackRollbackReasonCode;
  readonly activePack: ActionPolicyPack;
  readonly rolledBackFromPackId: string | null;
  readonly rolledBackToPackId: string | null;
  readonly historyDepth: number;
}

export interface ActionPolicyPackManagerState {
  readonly activePack: ActionPolicyPack;
  readonly history: readonly ActionPolicyPack[];
  readonly historyDepth: number;
}

export interface ActionPolicyPackManagerOptions {
  readonly allowlist?: readonly string[];
  readonly env?: Record<string, string | undefined>;
  readonly initialPackId?: string;
  readonly initialDescription?: string;
  readonly maxHistoryDepth?: number;
  readonly now?: () => string;
}

export interface ActionPolicyPackManager {
  getState(): ActionPolicyPackManagerState;
  validate(input: ActionPolicyPackInput): ActionPolicyPackValidationResult;
  apply(input: ActionPolicyPackInput): ActionPolicyPackApplyResult;
  rollback(targetPackId?: string): ActionPolicyPackRollbackResult;
  decide(action: string): ActionPolicyDecision;
}

const ACTION_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,127})$/;
const POLICY_PACK_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,63})$/;
const DEFAULT_POLICY_PACK_ID = "default";
const DEFAULT_POLICY_PACK_HISTORY_DEPTH = 32;
const DEFAULT_POLICY_PACK_DESCRIPTION = "runtime baseline allowlist";

export function createActionPolicyEngine(
  options: ActionPolicyEngineOptions = {},
): ActionPolicyEngine {
  const env = options.env ?? resolveRuntimeEnv();
  const allowlistInput = options.allowlist ?? parseActionAllowlist(env.OPENCLAW_BRIDGE_ACTION_ALLOWLIST);
  const allowlist = normalizeActionAllowlist(allowlistInput);
  const allowset = new Set(allowlist);

  return {
    allowlist,
    decide(action) {
      const normalizedAction = normalizeActionName(action);
      if (!normalizedAction) {
        return {
          allowed: false,
          reason: "action_invalid",
          statusCode: 400,
        };
      }

      if (allowset.size === 0) {
        return {
          allowed: false,
          reason: "action_allowlist_empty",
          statusCode: 403,
        };
      }

      if (!allowset.has(normalizedAction)) {
        return {
          allowed: false,
          reason: "action_not_allowlisted",
          statusCode: 403,
        };
      }

      return {
        allowed: true,
        reason: "action_allowed",
        statusCode: 202,
      };
    },
  };
}

export function createActionPolicyPackManager(
  options: ActionPolicyPackManagerOptions = {},
): ActionPolicyPackManager {
  const env = options.env ?? resolveRuntimeEnv();
  const allowlistInput = options.allowlist ?? parseActionAllowlist(env.OPENCLAW_BRIDGE_ACTION_ALLOWLIST);
  const normalizedAllowlist = normalizeActionAllowlist(allowlistInput);
  const nowResolver = options.now ?? (() => new Date().toISOString());
  const maxHistoryDepth = resolveMaxHistoryDepth(options.maxHistoryDepth);
  const normalizedInitialPackId = normalizePolicyPackId(
    options.initialPackId ?? DEFAULT_POLICY_PACK_ID,
  );
  const initialPackId =
    normalizedInitialPackId.length > 0
      ? normalizedInitialPackId
      : DEFAULT_POLICY_PACK_ID;

  let activePack = createActionPolicyPack({
    packId: initialPackId,
    version: 1,
    allowlist: normalizedAllowlist,
    description: options.initialDescription ?? DEFAULT_POLICY_PACK_DESCRIPTION,
    createdAt: nowResolver(),
  });
  let history: ActionPolicyPack[] = [];
  let nextVersion = 2;
  let activeEngine = createActionPolicyEngine({
    allowlist: activePack.allowlist,
  });

  return {
    getState() {
      return {
        activePack: cloneActionPolicyPack(activePack),
        history: history.map((pack) => cloneActionPolicyPack(pack)),
        historyDepth: history.length,
      };
    },
    validate(input) {
      return validateActionPolicyPackInput(input);
    },
    apply(input) {
      const validation = validateActionPolicyPackInput(input);
      if (!validation.valid) {
        return {
          applied: false,
          reason: "policy_pack_invalid",
          activePack: cloneActionPolicyPack(activePack),
          previousPack: null,
          validation,
          historyDepth: history.length,
        };
      }

      const requestedPackId =
        validation.packId.length > 0
          ? validation.packId
          : `policy-pack-v${nextVersion}`;
      const hasPackIdConflict =
        requestedPackId === activePack.packId ||
        history.some((pack) => pack.packId === requestedPackId);
      if (hasPackIdConflict) {
        return {
          applied: false,
          reason: "policy_pack_id_conflict",
          activePack: cloneActionPolicyPack(activePack),
          previousPack: null,
          validation,
          historyDepth: history.length,
        };
      }

      const previousPack = activePack;
      const nextPack = createActionPolicyPack({
        packId: requestedPackId,
        version: nextVersion,
        allowlist: validation.allowlist,
        description: input.description,
        createdAt: nowResolver(),
      });
      history = appendPolicyPackHistory(history, previousPack, maxHistoryDepth);
      activePack = nextPack;
      nextVersion += 1;
      activeEngine = createActionPolicyEngine({
        allowlist: activePack.allowlist,
      });

      return {
        applied: true,
        reason: "policy_pack_applied",
        activePack: cloneActionPolicyPack(activePack),
        previousPack: cloneActionPolicyPack(previousPack),
        validation,
        historyDepth: history.length,
      };
    },
    rollback(targetPackId) {
      if (history.length === 0) {
        return {
          rolledBack: false,
          reason: "policy_pack_rollback_unavailable",
          activePack: cloneActionPolicyPack(activePack),
          rolledBackFromPackId: null,
          rolledBackToPackId: null,
          historyDepth: history.length,
        };
      }

      let restoreIndex = history.length - 1;
      if (typeof targetPackId === "string" && targetPackId.trim().length > 0) {
        const normalizedTargetPackId = normalizePolicyPackId(targetPackId);
        restoreIndex = findPolicyPackIndexFromEnd(history, normalizedTargetPackId);
        if (restoreIndex < 0) {
          return {
            rolledBack: false,
            reason: "policy_pack_target_not_found",
            activePack: cloneActionPolicyPack(activePack),
            rolledBackFromPackId: null,
            rolledBackToPackId: null,
            historyDepth: history.length,
          };
        }
      }

      const restoredPack = history[restoreIndex];
      const previousActivePack = activePack;
      history = history.slice(0, restoreIndex);
      activePack = restoredPack;
      activeEngine = createActionPolicyEngine({
        allowlist: activePack.allowlist,
      });

      return {
        rolledBack: true,
        reason: "policy_pack_rollback_applied",
        activePack: cloneActionPolicyPack(activePack),
        rolledBackFromPackId: previousActivePack.packId,
        rolledBackToPackId: restoredPack.packId,
        historyDepth: history.length,
      };
    },
    decide(action) {
      return activeEngine.decide(action);
    },
  };
}

export function parseActionAllowlist(rawValue: string | undefined): readonly string[] {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return [];
  }

  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeActionName(rawAction: string): string {
  if (typeof rawAction !== "string") {
    return "";
  }

  const normalized = rawAction.trim().toLowerCase();
  return ACTION_NAME_PATTERN.test(normalized) ? normalized : "";
}

function normalizeActionAllowlist(actions: readonly string[]): readonly string[] {
  const normalized = actions
    .map((action) => normalizeActionName(action))
    .filter((action) => action.length > 0);
  return [...new Set(normalized)];
}

function normalizePolicyPackId(rawPackId: string): string {
  if (typeof rawPackId !== "string") {
    return "";
  }

  const normalized = rawPackId.trim().toLowerCase();
  return POLICY_PACK_ID_PATTERN.test(normalized) ? normalized : "";
}

function normalizePolicyPackDescription(rawDescription: string | undefined): string | undefined {
  if (typeof rawDescription !== "string") {
    return undefined;
  }

  const normalized = rawDescription.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  if (normalized.length > 240) {
    return normalized.slice(0, 240);
  }
  return normalized;
}

function validateActionPolicyPackInput(
  input: ActionPolicyPackInput,
): ActionPolicyPackValidationResult {
  const issues: ActionPolicyPackValidationIssue[] = [];

  const normalizedPackId =
    typeof input.packId === "string" && input.packId.trim().length > 0
      ? normalizePolicyPackId(input.packId)
      : "";
  if (
    typeof input.packId === "string" &&
    input.packId.trim().length > 0 &&
    normalizedPackId.length === 0
  ) {
    issues.push({
      code: "policy_pack_id_invalid",
      detail: "packId must match ^[a-z0-9](?:[a-z0-9._:-]{0,63})$",
    });
  }

  let normalizedAllowlist: readonly string[] = [];
  if (!input.allowlist) {
    issues.push({
      code: "policy_pack_allowlist_required",
      detail: "allowlist is required",
    });
  } else {
    const invalidActions: string[] = [];
    const normalized = input.allowlist
      .map((rawAction) => {
        const normalizedAction = normalizeActionName(rawAction);
        if (normalizedAction.length === 0) {
          invalidActions.push(rawAction);
        }
        return normalizedAction;
      })
      .filter((action) => action.length > 0);

    normalizedAllowlist = [...new Set(normalized)];
    for (const invalidAction of invalidActions) {
      issues.push({
        code: "policy_pack_action_invalid",
        detail: invalidAction,
      });
    }

    if (normalizedAllowlist.length === 0) {
      issues.push({
        code: "policy_pack_allowlist_empty",
        detail: "allowlist must contain at least one valid action",
      });
    }
  }

  return {
    valid: issues.length === 0,
    packId: normalizedPackId,
    allowlist: normalizedAllowlist,
    issues,
  };
}

function appendPolicyPackHistory(
  history: readonly ActionPolicyPack[],
  pack: ActionPolicyPack,
  maxHistoryDepth: number,
): ActionPolicyPack[] {
  const nextHistory = [...history, cloneActionPolicyPack(pack)];
  if (nextHistory.length <= maxHistoryDepth) {
    return nextHistory;
  }
  return nextHistory.slice(nextHistory.length - maxHistoryDepth);
}

function createActionPolicyPack(input: {
  packId: string;
  version: number;
  allowlist: readonly string[];
  description?: string;
  createdAt: string;
}): ActionPolicyPack {
  const normalizedDescription = normalizePolicyPackDescription(input.description);
  return {
    packId: input.packId,
    version: input.version,
    allowlist: [...input.allowlist],
    description: normalizedDescription,
    createdAt: input.createdAt,
  };
}

function cloneActionPolicyPack(pack: ActionPolicyPack): ActionPolicyPack {
  return {
    packId: pack.packId,
    version: pack.version,
    allowlist: [...pack.allowlist],
    description: pack.description,
    createdAt: pack.createdAt,
  };
}

function resolveMaxHistoryDepth(rawDepth: number | undefined): number {
  if (typeof rawDepth !== "number" || !Number.isFinite(rawDepth)) {
    return DEFAULT_POLICY_PACK_HISTORY_DEPTH;
  }

  return Math.max(1, Math.floor(rawDepth));
}

function findPolicyPackIndexFromEnd(
  history: readonly ActionPolicyPack[],
  targetPackId: string,
): number {
  if (targetPackId.length === 0) {
    return -1;
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].packId === targetPackId) {
      return index;
    }
  }

  return -1;
}

function resolveRuntimeEnv(): Record<string, string | undefined> {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return maybeProcess.process?.env ?? {};
}
