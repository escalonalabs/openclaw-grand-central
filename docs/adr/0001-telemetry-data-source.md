# ADR-0001: Telemetry data source for live visualization

## Status
Accepted

## Context
The dashboard needs near-real-time updates from OpenClaw with low parsing overhead and stable semantics.

## Decision
Use a native OpenClaw plugin/hook as primary event source. Keep log tailing as fallback mode.

## Consequences

### Positive
- Structured events with less parsing ambiguity
- Lower IO overhead than file polling
- Better long-term extensibility

### Negative
- Requires plugin lifecycle maintenance with OpenClaw updates
- Additional code path to test and secure

### Neutral
- Fallback parser remains necessary for degraded mode

## Alternatives considered
- Polling status JSON files: simpler but stale and IO-heavy
- Pure log tailing: easy bootstrap but weaker contracts
