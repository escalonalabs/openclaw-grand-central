# Metrics specification: bridge, security, and SLO baseline

## Status
Draft baseline

## Scope
Defines telemetry and security metrics for the bridge path from OpenClaw event
ingest to dashboard delivery.

## Assumptions
- Metric names below are implemented in the current JSON `/metrics` snapshot,
  and mirrored in `/metrics/prometheus`.
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
| `bridge_events_lane_total` | Counter | `lane` | Events emitted by lane (fairness and starvation visibility). |
| `bridge_events_session_total` | Counter | `session` | Events emitted by session (operational context reconstruction). |
| `bridge_event_e2e_latency_ms` | Histogram | `event_type`, `qos` | Time from event ingest to client emit attempt. |
| `bridge_ws_clients` | Gauge | `namespace` | Active WebSocket clients. |
| `bridge_authn_failures_total` | Counter | `reason` | Denied requests due to missing/invalid credentials. |
| `bridge_authz_denies_total` | Counter | `scope`, `reason` | Authorization denials by required scope. |
| `bridge_redaction_applied_total` | Counter | `rule` | Redaction operations successfully applied. |
| `bridge_redaction_failures_total` | Counter | `reason` | Redaction hook failures by reason code. |
| `bridge_action_gate_decisions_total` | Counter | `action`, `decision`, `reason` | Allow/deny decisions for mutating actions. |
| `bridge_action_receipts_total` | Counter | `status` | Action receipt outcomes (`accepted`, `duplicate`, `rejected`). |
| `bridge_action_idempotency_replays_total` | Counter | none | Idempotent replay count served from receipt cache. |
| `bridge_policy_pack_active_version` | Gauge | none | Active runtime policy pack version. |
| `bridge_policy_pack_history_depth` | Gauge | none | Rollback stack depth available for policy packs. |
| `bridge_policy_pack_operations_total` | Counter | `operation`, `result` | Lifecycle outcomes for `validate/apply/rollback`. |
| `bridge_critical_delivery_failures_total` | Counter | `event_type` | Critical events not delivered inside SLO bounds. |

## Current `/metrics` contracts

### JSON snapshot (`/metrics`)

The current bridge endpoint returns a JSON snapshot (not Prometheus text yet):

```json
{
  "droppedEvents": 0,
  "connectedClients": 0,
  "queueDepth": 0,
  "bridge_events_total": 0,
  "bridge_events_qos_total": {
    "best_effort": 0,
    "stateful": 0,
    "critical": 0
  },
  "bridge_events_lane_total": {
    "lane-main": 0
  },
  "bridge_events_session_total": {
    "session-main": 0
  },
  "bridge_event_e2e_latency_ms": {
    "total": {
      "count": 0,
      "min": 0,
      "max": 0,
      "avg": 0,
      "p50": 0,
      "p95": 0,
      "p99": 0
    },
    "by_qos": {
      "best_effort": {
        "count": 0,
        "min": 0,
        "max": 0,
        "avg": 0,
        "p50": 0,
        "p95": 0,
        "p99": 0
      },
      "stateful": {
        "count": 0,
        "min": 0,
        "max": 0,
        "avg": 0,
        "p50": 0,
        "p95": 0,
        "p99": 0
      },
      "critical": {
        "count": 0,
        "min": 0,
        "max": 0,
        "avg": 0,
        "p50": 0,
        "p95": 0,
        "p99": 0
      }
    }
  },
  "bridge_authn_failures_total": 0,
  "bridge_authz_denies_total": 0,
  "bridge_redaction_applied_total": 0,
  "bridge_redaction_failures_total": 0,
  "bridge_action_gate_decisions_total": {
    "allow": 0,
    "deny": 0
  },
  "bridge_action_receipts_total": {
    "accepted": 0,
    "duplicate": 0,
    "rejected": 0
  },
  "bridge_action_idempotency_replays_total": 0,
  "bridge_policy_pack_state": {
    "active_pack_id": "runtime-default",
    "active_pack_version": 1,
    "history_depth": 0
  },
  "bridge_policy_pack_operations_total": {
    "validate": {
      "accepted": 0,
      "rejected": 0
    },
    "apply": {
      "accepted": 0,
      "rejected": 0
    },
    "rollback": {
      "accepted": 0,
      "rejected": 0
    }
  }
}
```

- Access requires bearer token + `metrics:read` scope.
- WebSocket upgrades require bearer token + `telemetry:read` scope.
- Prometheus text export is available at `/metrics/prometheus` and uses the same
  auth requirements and semantic values as JSON.
- QoS mapping:
  - `critical`: `approval.*`, `security.*`, `exec.approval` (or payload override).
  - `stateful`: `lane.*`, `session.*`, `*.state` (or payload override).
  - `best_effort`: default for the rest.

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
  failures, policy pack lifecycle operations.
- Reliability: critical event success ratio and SLO burn-rate indicators.

## Export path
- JSON scrape workflow and dashboard base:
  `docs/observability/EXPORT_JSON_SCRAPE.md`
- Prometheus parity verification:
  `npm run verify:observability-prometheus`
- SLO bundle and executive summary evaluation:
  `npm run evaluate:slo-bundle`
- Baseline alert rules and thresholds:
  `docs/observability/ALERT_RULES_BASELINE.md`
