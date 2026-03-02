# Bridge Adapters (MVP)

This document defines the adapter contract used by `apps/bridge` and the two adapters:

- `log-tail` (implemented)
- `plugin` (callable stub, no production transport)

## Contract

Every bridge adapter must expose:

- `name: string`
- `kind: string`
- `start(handler)` to register an event sink
- `stop()` to disable emission

Runtime validation is available through `assertAdapterContract(adapter)`.

## Normalized Event Shape

All adapters emit the canonical Station Event v1 envelope:

- `version: "1.0"`
- `eventId: string` deterministic hash for event identity
- `occurredAt: string` ISO timestamp
- `eventType: string` event type (`lane.enqueue`, `exec.approval`, etc.)
- `severity: "debug" | "info" | "warn" | "error"`
- `source: { agentId, workspaceId, laneId, sessionId }`
- `payload: Record<string, unknown>`

Normalization is handled by `normalizeStationEvent()`.

## Log-Tail Adapter

Factory: `createLogTailAdapter(options?)`

Capabilities:

- Parses JSON lines directly.
- Falls back to key-value parsing for plain-text lines.
- Supports `ingestLine(rawLine)` for incremental pipeline processing.
- Emits normalized events via `start(handler)`.

MVP parser notes:

- Recognizes common keys (`event`, `level`, `lane`, `agent`, `station`, `message`).
- Extracts unknown keys into `metadata`.
- Performs light scalar coercion (`"3"` -> `3`, `"true"` -> `true`).

## Plugin Adapter (native + stub)

Factory: `createPluginAdapter(options?)`

Current behavior:

- Fully contract-compliant and callable.
- Accepts payloads through `emitPluginEvent(payload)`.
- Supports two transport modes:
  - `stub` (default): returns `stub=true` with explicit reason.
  - `http-ingest` (`kind=plugin-native`): treats payload as native transport input.
- In native mode, bridge can accept payloads via:
  - `POST /ingest/plugin` (JSON body)
  - bridge runtime wires this route to `BridgeIngestPipeline.ingestPluginPayload()`.

Environment switches:

- `OPENCLAW_BRIDGE_NATIVE_PLUGIN_ENABLED=1`
- `OPENCLAW_BRIDGE_PLUGIN_TRANSPORT=http-ingest`

Security:

- `/ingest/plugin` requires bearer token with scope `control:write`.
- Runtime token/scope rotation endpoint:
  - `POST /security/rotate`
  - requires bearer token with scope `control:write`
  - payload:
    - `token` (required)
    - `scopes` (optional array)
    - `graceMs` (optional, default `30000`, max `300000`)
  - response includes masked token fingerprint and active scopes.

Degradation and fallback behavior:

- If native plugin emit is rejected, ingest returns deterministic
  `reasonCode=primary_emit_rejected`.
- When log-tail fallback is enabled, mode switches to `fallback` and operators
  can continue ingesting through fallback path.
- If fallback is disabled, mode remains `blocked` with
  `reasonCode=fallback_disabled`.
- While primary is healthy, direct fallback ingest attempts are rejected with
  `reasonCode=fallback_inactive_primary_healthy`.

Bridge ingest reason codes (pipeline-level):

- `primary_healthy`
- `primary_disabled`
- `primary_transport_stub`
- `primary_unavailable`
- `primary_emit_rejected`
- `fallback_disabled`
- `fallback_inactive_primary_healthy`
- `fallback_line_ignored`

## Action Gates Policy Engine

Mutating endpoints under `/actions/<action>` are protected by the bridge action
policy engine.

Behavior:

- Allowlist-only decisions (default deny).
- Deterministic reason codes: `action_allowed`,
  `action_not_allowlisted`, `action_allowlist_empty`, `action_invalid`.
- Structured audit events are emitted through the existing action-gate security
  control.

Configuration:

- `OPENCLAW_BRIDGE_ACTION_ALLOWLIST=restart-lane,resume-lane,pause-lane`
  (CSV, case-insensitive normalization).

Action receipts and idempotency:

- `POST /actions/<action>` now emits structured receipts for auditability.
- Input supports:
  - Header `Idempotency-Key` (recommended)
  - Header `X-Correlation-Id` (optional)
  - JSON body:
    - `idempotencyKey` (optional)
    - `correlationId` (optional)
    - `payload` (optional object)
- Replays with same `action + idempotency key` return the original receipt with
  `duplicate=true` and increment replay counters.
- Response includes:
  - `receipt.receiptId`
  - `receipt.status` (`accepted` | `duplicate` | `rejected`)
  - `receipt.attempts`
  - `receipt.requestHash`
  - `receipt.createdAt` / `receipt.lastAttemptAt`

Policy pack lifecycle manager (`validate/apply/rollback`):

- Runtime policy packs govern the active action allowlist used by action gates.
- Default active pack bootstraps from `OPENCLAW_BRIDGE_ACTION_ALLOWLIST`.
- Lifecycle endpoints:
  - `GET /policy/packs` returns active pack + rollback history.
  - `POST /policy/packs/validate` validates a candidate policy pack.
  - `POST /policy/packs/apply` applies a validated pack at runtime.
  - `POST /policy/packs/rollback` rolls back to previous or target pack id.
- Payload shape (`validate/apply`):
  - `packId` (optional, pattern `^[a-z0-9](?:[a-z0-9._:-]{0,63})$`)
  - `description` (optional)
  - `allowlist` (required for apply; array of action names)
- Rollback payload:
  - `targetPackId` (optional; default rollback to immediate previous pack)
- Scope requirement:
  - all `/policy/packs*` endpoints require bearer token with `policy:admin`.
- Runtime guarantees:
  - apply/rollback updates are hot (no bridge restart required),
  - action-gate decisions switch immediately to active pack.

## Test Coverage

Current tests validate:

- Contract compliance of both adapters.
- Callable behavior of plugin stub.
- Native plugin mode behavior and pipeline primary route.
- Log-tail JSON parsing and key-value parsing pipeline.
- Empty-line handling for log-tail ingestion.
