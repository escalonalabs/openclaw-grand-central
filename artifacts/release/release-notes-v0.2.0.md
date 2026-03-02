## [0.2.0] - 2026-03-02

### Added in 0.2.0

- Multi-lane scheduler fairness with lane/session QoS metrics.
- Action control plane with idempotent receipts and deterministic reason codes.
- Runtime policy pack lifecycle (`validate/apply/rollback`) without service restart.
- Operational timeline UI and incident context workflows for operators.
- DR phase 2 automation with encrypted backup/restore and retention policy.
- Release candidate traceability flow with manifest-based checksum verification.

### Security

- Hardened plugin ingest normalization with deterministic error contracts:
  `plugin_ingest_handler_error` and `plugin_ingest_invalid_result`.

### Operational

- Release/readiness documentation expanded for cycle 4 closeout and v0.2.0 gates.

## [0.1.0] - 2026-03-01
