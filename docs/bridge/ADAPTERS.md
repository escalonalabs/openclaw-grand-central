# Bridge Adapters (MVP)

This document defines the adapter contract used by `apps/bridge` and the two MVP adapters:

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

All adapters emit a `StationEvent`-like payload:

- `id: string` deterministic hash for event identity
- `ts: string` ISO timestamp
- `source: string` adapter source name
- `type: string` event type (`lane.enqueue`, `exec.approval`, etc.)
- `level: "debug" | "info" | "warn" | "error"`
- `message: string`
- `laneId: string | null`
- `agentId: string | null`
- `stationId: string | null`
- `metadata: Record<string, string | number | boolean | null>`
- `raw: unknown` original payload/line

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

## Plugin Adapter Stub

Factory: `createPluginAdapter(options?)`

Current behavior:

- Fully contract-compliant and callable.
- Accepts payloads through `emitPluginEvent(payload)`.
- Emits normalized events with `metadata.stub = true`.
- Returns a stub response with reason text.

TODO (intentionally not in MVP):

- Wire real OpenClaw plugin/hook transport.
- Replace generic payload handling with production schema and auth model.

## Test Coverage

Current tests validate:

- Contract compliance of both adapters.
- Callable behavior of plugin stub.
- Log-tail JSON parsing and key-value parsing pipeline.
- Empty-line handling for log-tail ingestion.
