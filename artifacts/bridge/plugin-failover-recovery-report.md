# Plugin Failover Recovery Verification

- Commit: c9325b2902bd43e4794de998042fe3286e889672
- Timestamp (UTC): 2026-03-02T03:46:59Z

## Validated scenarios

- Native plugin rejection triggers fallback mode with deterministic reasonCode.
- Fallback ingestion remains available during degraded primary state.
- Recovery to primary route succeeds after plugin resumes acceptance.
- Plugin ingest normalization surfaces deterministic reasonCode for degraded plugin path.
- Plugin ingest handler exceptions map to deterministic handler error reasonCode.
- Plugin ingest invalid result shapes map to deterministic invalid_result reasonCode.
