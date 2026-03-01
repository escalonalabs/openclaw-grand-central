# Metrics specification: bridge, security, and SLO baseline

## Status
Draft baseline

## Scope
Defines telemetry and security metrics for the bridge path from OpenClaw event
ingest to dashboard delivery.

## Assumptions
- Metric names below are baseline proposals and may be refined during
  implementation.
- The bridge can emit counters, gauges, and histograms.
- `critical` events in ADR-0003 map to operationally important signals.

## Service level objectives (SLOs)

| SLO | SLI | Target | Window |
|---|---|---|---|
| End-to-end telemetry latency | p95(`bridge_event_e2e_latency_ms`) | <= 100 ms | rolling 1 hour |
| Critical event latency | p99(`bridge_event_e2e_latency_ms{qos="critical"}`) | <= 250 ms | rolling 1 hour |
| Critical delivery reliability | `1 - (critical_failures / critical_total)` | >= 99.9% | rolling 24 hours |
| Bridge availability | successful health checks / total checks | >= 99.5% | rolling 30 days |

## Metric catalog

| Metric | Type | Labels | Definition |
|---|---|---|---|
| `bridge_events_total` | Counter | `event_type`, `qos`, `source` | Total normalized events accepted by bridge. |
| `bridge_event_e2e_latency_ms` | Histogram | `event_type`, `qos` | Time from event ingest to client emit attempt. |
| `bridge_ws_clients` | Gauge | `namespace` | Active WebSocket clients. |
| `bridge_authn_failures_total` | Counter | `reason` | Denied requests due to missing/invalid credentials. |
| `bridge_authz_denies_total` | Counter | `scope`, `reason` | Authorization denials by required scope. |
| `bridge_redaction_applied_total` | Counter | `rule` | Redaction operations successfully applied. |
| `bridge_redaction_failures_total` | Counter | `reason` | Redaction hook failures by reason code. |
| `bridge_action_gate_decisions_total` | Counter | `action`, `decision`, `reason` | Allow/deny decisions for mutating actions. |
| `bridge_critical_delivery_failures_total` | Counter | `event_type` | Critical events not delivered inside SLO bounds. |

## Measurement semantics
- Ingest timestamp: when bridge accepts an upstream event.
- Emit timestamp: when bridge attempts to fan out to subscribed clients.
- E2E latency: `emit_timestamp - ingest_timestamp`.
- Critical failure: any `qos=critical` event missing delivery guarantees defined
  by implementation policy.

## Alerting baseline
- Page on sustained SLO burn for critical latency or critical delivery
  reliability.
- Ticket on elevated authn/authz deny ratios (possible abuse or misconfig).
- Ticket on any non-zero redaction failure rate over 15 minutes.

## Dashboards
- Realtime operations: throughput, latency percentiles, connected clients.
- Security operations: auth failures, authz denies, gate decisions, redaction
  failures.
- Reliability: critical event success ratio and SLO burn-rate indicators.
