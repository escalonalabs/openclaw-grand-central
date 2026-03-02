# Alert Rules Baseline (JSON Metrics)

## Scope

Defines the minimum actionable alert coverage for Cycle 2 using the current
JSON `/metrics` snapshot.

## Rule set

| Alert ID | Metric path | Condition | Severity | Action |
|---|---|---|---|---|
| `bridge_critical_latency_p99_slo_breach` | `bridge_event_e2e_latency_ms.by_qos.critical.p99` | `> 250` | `critical` | Page on-call, investigate bridge and upstream source delay. |
| `bridge_total_latency_p95_slo_breach` | `bridge_event_e2e_latency_ms.total.p95` | `> 100` | `warn` | Open ticket and inspect throughput/backpressure trends. |
| `bridge_authn_failures_detected` | `bridge_authn_failures_total` | `> 0` | `warn` | Validate token distribution and detect abuse patterns. |
| `bridge_authz_denies_detected` | `bridge_authz_denies_total` | `> 0` | `warn` | Confirm scope mapping and control-plane permissions. |
| `bridge_redaction_failures_detected` | `bridge_redaction_failures_total` | `> 0` | `critical` | Treat as data-leak risk, stop rollouts until resolved. |
| `bridge_dropped_events_detected` | `droppedEvents` | `> 0` | `warn` | Review queue pressure and QoS behavior. |
| `bridge_queue_depth_pressure` | `queueDepth` | `> 64` | `warn` | Scale consumers or reduce ingest pressure. |

## Execution

Evaluate rules from a snapshot:

```bash
./scripts/evaluate-alert-rules.sh \
  artifacts/observability/metrics-snapshot.json \
  artifacts/observability/alert-report.json
```

Require at least one firing alert (for validation scenarios):

```bash
REQUIRE_FIRING=1 \
./scripts/evaluate-alert-rules.sh \
  artifacts/observability/metrics-alert-test-snapshot.json \
  artifacts/observability/alert-report.json
```

## Validation workflow

Run end-to-end validation that forces real alert conditions:

```bash
npm run verify:observability-alerts
```

The command validates:

- Authn failure alert firing.
- Critical latency alert firing.
- Alert report artifact generation.
