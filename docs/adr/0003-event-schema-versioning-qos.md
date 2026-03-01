# ADR-0003: Event schema versioning and QoS policy

## Status
Accepted

## Context
ADR-0001 selected a native OpenClaw hook as the primary telemetry source with
log tailing as fallback. The bridge therefore normalizes events from more than
one upstream shape.

Without a versioning contract, parser and UI changes can silently break in
production. Without explicit QoS classes, high-volume updates can starve
critical security and approval signals.

## Assumptions
- Telemetry continues to flow through the bridge over WebSockets.
- A durable event bus is not yet part of this repository.
- Consumers can tolerate additive fields if unknown fields are ignored.

## Decision
Adopt a canonical event envelope with explicit versioning and QoS classification.

Required top-level fields for bridge-emitted events:

- `schema_version` (`major.minor`)
- `event_id` (producer-unique identifier)
- `event_type` (stable event name)
- `occurred_at` (UTC timestamp)
- `source` (hook or fallback parser)
- `qos` (`best_effort`, `stateful`, or `critical`)
- `payload` (event-specific body)

Versioning policy:

- `minor` increments are additive only.
- `major` increments are required for removals, renames, or semantic changes.
- Producers MUST include `schema_version` on every event.
- Consumers MUST ignore unknown fields and branch on `schema_version`.
- Fallback log parsing MUST map raw lines into the same canonical envelope.

QoS policy:

- `best_effort`: may be dropped under pressure (render hints, noisy updates).
- `stateful`: should be delivered at least once; deduplicate by `event_id`.
- `critical`: security and approval events; prioritize delivery and replay.

This ADR defines policy and contracts only. Transport-level retry, replay, and
backpressure mechanics are implementation work tracked outside this document.

## Consequences

### Positive
- Schema evolution is explicit and testable.
- Producers and consumers have a stable compatibility contract.
- Critical security events receive priority over cosmetic updates.

### Negative
- Bridge code must maintain version mappers when major changes happen.
- Additional test coverage is required for version compatibility and QoS paths.

### Neutral
- Existing event producers need envelope normalization before broadcast.

## Alternatives considered
- No explicit schema versioning: simpler short-term, fragile long-term.
- Single QoS bucket: easier implementation, poor behavior under load spikes.
- Per-consumer custom schemas: flexible but hard to govern and validate.
