# SLO Bundle + Executive Summary

## Objective

Generate a single artifact that consolidates operational SLO compliance and a
short executive view (risk, lanes, sessions, security, queue) from the current
bridge metrics snapshot.

## Commands

Evaluate bundle from an existing snapshot:

```bash
npm run evaluate:slo-bundle -- \
  artifacts/observability/metrics-snapshot.json \
  artifacts/observability/slo-bundle.json \
  artifacts/observability/slo-executive-summary.md
```

Verify nominal coherence (bundle + executive panels):

```bash
npm run verify:observability-slo-bundle
```

Verify nominal/degraded dashboard behavior:

```bash
npm run verify:dashboard-slo-export
```

## SLO objectives in bundle

- `slo_bridge_total_latency_p95` (`<= 100 ms`)
- `slo_bridge_critical_latency_p99` (`<= 250 ms`)
- `slo_bridge_critical_delivery_reliability` (`>= 99.9%`)

## Artifact outputs

- JSON bundle:
  `artifacts/observability/slo-bundle*.json`
- Markdown executive summaries:
  `artifacts/observability/slo-*.md`
- Verification report:
  `artifacts/observability/dashboard-slo-export-report.md`

## Notes

- Executive section includes top lanes and top sessions using:
  - `bridge_events_lane_total`
  - `bridge_events_session_total`
- Nominal/degraded verification is deterministic and local; no external
  services are required.
