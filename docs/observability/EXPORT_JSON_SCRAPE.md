# Observability Export: JSON Scrape + Dashboard Base

## Objective

Provide a simple, reproducible bridge metrics export that external tools can
scrape as JSON while the project is still using a JSON `/metrics` contract.

## Scripts

### 1) Export a JSON metrics snapshot

```bash
OPENCLAW_BRIDGE_TOKEN=dev-observability-token \
./scripts/export-metrics-snapshot.sh
```

Default output:

- `artifacts/observability/metrics-snapshot.json`

You can override output path:

```bash
OPENCLAW_BRIDGE_TOKEN=dev-observability-token \
./scripts/export-metrics-snapshot.sh /tmp/openclaw-metrics.json
```

### 2) Verify export end-to-end

```bash
npm run verify:observability-export
```

What it validates:

- Local bridge stub boot with token/scopes configured.
- Authenticated `/metrics` read works.
- Snapshot is exported and includes required operational/security keys.
- QoS counters and latency fields are structurally valid.

### 3) Evaluate alert rules on a snapshot

```bash
./scripts/evaluate-alert-rules.sh \
  artifacts/observability/metrics-snapshot.json \
  artifacts/observability/alert-report.json
```

### 4) Verify alert firing end-to-end

```bash
npm run verify:observability-alerts
```

This command intentionally triggers alert conditions and validates that at least
one alert is firing in the generated report.

### 5) Export Prometheus text metrics

```bash
OPENCLAW_BRIDGE_TOKEN=dev-observability-token \
./scripts/export-metrics-prometheus.sh
```

Default output:

- `artifacts/observability/metrics-prometheus.txt`

### 6) Verify Prometheus parity against JSON

```bash
npm run verify:observability-prometheus
```

This command validates that key counters and latency values match between
`/metrics` (JSON) and `/metrics/prometheus` (text exposition format).

### 7) Run synthetic load benchmark + budget validation

```bash
npm run verify:synthetic-load
```

This command produces a versioned benchmark report and validates queue/latency
budgets plus lane-fairness coverage.

Dedicated lane-fairness verification (unit + benchmark):

```bash
npm run verify:lane-fairness
```

### 8) Build SLO bundle + executive summary from snapshot

```bash
npm run evaluate:slo-bundle -- \
  artifacts/observability/metrics-snapshot.json \
  artifacts/observability/slo-bundle.json \
  artifacts/observability/slo-executive-summary.md
```

### 9) Verify SLO bundle coherence (nominal)

```bash
npm run verify:observability-slo-bundle
```

### 10) Verify dashboard/SLO export in nominal and degraded modes

```bash
npm run verify:dashboard-slo-export
```

## Dashboard Base (JSON metrics source)

Use the exported JSON snapshot (or direct `/metrics` polling) to build an
initial dashboard with these panels:

1. Throughput
- `bridge_events_total`
- `bridge_events_qos_total.best_effort`
- `bridge_events_qos_total.stateful`
- `bridge_events_qos_total.critical`
- `bridge_events_lane_total.<lane-id>`
- `bridge_events_session_total.<session-id>`

2. Latency
- `bridge_event_e2e_latency_ms.total.p50`
- `bridge_event_e2e_latency_ms.total.p95`
- `bridge_event_e2e_latency_ms.total.p99`
- `bridge_event_e2e_latency_ms.by_qos.critical.p99`
- `slo-bundle.objectives[*]` status and delta

3. Security
- `bridge_authn_failures_total`
- `bridge_authz_denies_total`
- `bridge_action_gate_decisions_total.allow`
- `bridge_action_gate_decisions_total.deny`
- `bridge_action_receipts_total.accepted`
- `bridge_action_receipts_total.duplicate`
- `bridge_action_receipts_total.rejected`
- `bridge_action_idempotency_replays_total`
- `bridge_policy_pack_state.active_pack_version`
- `bridge_policy_pack_state.history_depth`
- `bridge_policy_pack_operations_total.validate.accepted`
- `bridge_policy_pack_operations_total.validate.rejected`
- `bridge_policy_pack_operations_total.apply.accepted`
- `bridge_policy_pack_operations_total.rollback.accepted`

4. Queue / Delivery Health
- `queueDepth`
- `droppedEvents`
- `connectedClients`

5. Executive context
- `top lanes` (from SLO bundle executive summary)
- `top sessions` (from SLO bundle executive summary)
- `health score` and `overall status` (from SLO bundle)

## Notes

- `/metrics` requires bearer token + `metrics:read` scope.
- `/metrics/prometheus` requires bearer token + `metrics:read` scope.
- For local/dev scraping, use a dedicated token with read-only scopes.
- JSON and Prometheus paths are both available in this phase.
- Baseline alert catalog: `docs/observability/ALERT_RULES_BASELINE.md`
- Benchmark profile and budgets: `docs/observability/SYNTHETIC_LOAD_BENCHMARK.md`
- SLO bundle and executive summary contract:
  `docs/observability/SLO_BUNDLE_EXECUTIVE.md`
