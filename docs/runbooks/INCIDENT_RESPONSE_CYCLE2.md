# Incident Response Runbook (Cycle 2)

## Scope

Operational procedures for the three priority incidents defined in cycle 2:

1. Auth failures (`auth fail`)
2. Native plugin ingestion failures (`plugin fail`)
3. Bridge overload / latency degradation (`overload`)

## Incident Matrix

| Incident | Primary signal | Severity (default) | Escalate when |
|---|---|---|---|
| Auth fail | `bridge_authn_failures_detected` firing, sustained HTTP 401 on `/metrics` | SEV-2 | Token compromise suspicion or sustained auth denial over 15 min |
| Plugin fail | `/ingest/plugin` returns `503` (`plugin_ingest_unavailable` or `plugin_ingest_not_configured`) | SEV-2 | Route stays `blocked` and fallback disabled |
| Overload | `bridge_critical_latency_p99_slo_breach` firing, high `queueDepth`/`droppedEvents` | SEV-1 | `critical` latency p99 breach persists over 10 min with drops |

## Shared Response Workflow

1. Acknowledge incident and assign owner.
2. Stabilize impact (containment first).
3. Restore service path (primary or validated fallback).
4. Validate recovery with objective checks.
5. Capture timeline and close with post-incident actions.

---

## Playbook A: Auth Fail

### Detection

- Alert report shows `bridge_authn_failures_detected` as `firing`.
- `/metrics` requests return 401 unexpectedly for valid operators.

### Triage

1. Validate endpoint behavior with and without token:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/metrics
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer ${OPENCLAW_BRIDGE_TOKEN}" http://127.0.0.1:3000/metrics
```

2. Confirm runtime token is present and non-empty:

```bash
echo "${OPENCLAW_BRIDGE_TOKEN:+set}"
```

3. Export metrics snapshot for evidence:

```bash
npm run export:metrics-snapshot -- artifacts/observability/metrics-snapshot-auth-incident.json
```

### Containment

1. Rotate token and restart bridge service.
2. Restrict token distribution to operator group only.

### Recovery Validation

```bash
npm run verify:observability-alerts
```

Expected: alert test script passes and endpoint auth behavior is deterministic.

### Auth Fail Checklist

- [ ] 401/200 behavior verified with invalid vs valid token
- [ ] Token rotation completed
- [ ] Metrics evidence exported
- [ ] Recovery verification command passed

---

## Playbook B: Plugin Fail

### Detection

- Plugin ingest endpoint returns `503`.
- Ingest route degrades to fallback or blocked mode.

### Triage

1. Probe plugin ingest route:

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENCLAW_BRIDGE_TOKEN}" \
  -d '{"event":"approval.requested","approvalId":"incident-check"}' \
  http://127.0.0.1:3000/ingest/plugin
```

2. Validate plugin/fallback logic with deterministic tests:

```bash
node --test apps/bridge/test/ingestPipeline.test.ts
```

### Containment

1. If native plugin is unavailable, keep fallback enabled:
`OPENCLAW_BRIDGE_LOG_FALLBACK_ENABLED=1`.
2. If traffic is blocked, disable native primary temporarily:
`OPENCLAW_BRIDGE_NATIVE_PLUGIN_ENABLED=0`.

### Recovery Validation

```bash
npm --workspace @openclaw/bridge test
```

Expected: pipeline tests pass and no ingest regressions in bridge suite.

### Plugin Fail Checklist

- [ ] Plugin ingest behavior confirmed (`202` or controlled `503`)
- [ ] Fallback path enabled when primary unavailable
- [ ] Bridge test suite passed after mitigation
- [ ] Incident timeline recorded

---

## Playbook C: Overload

### Detection

- Alert report includes `bridge_critical_latency_p99_slo_breach`.
- `queueDepth`, `droppedEvents`, or p95/p99 latency trend upward.

### Triage

1. Export fresh snapshot:

```bash
npm run export:metrics-snapshot -- artifacts/observability/metrics-snapshot-overload-incident.json
```

2. Evaluate alert rules against current snapshot:

```bash
npm run evaluate:alert-rules -- artifacts/observability/metrics-snapshot-overload-incident.json artifacts/observability/alert-report-overload-incident.json
```

3. Review queue pressure and latency:
- `queueDepth`
- `droppedEvents`
- `bridge_event_e2e_latency_ms.total.p95`
- `bridge_event_e2e_latency_ms.by_qos.critical.p99`

### Containment

1. Reduce non-critical event pressure (throttle upstream best-effort producers).
2. Prioritize critical lanes/sessions operationally.
3. Scale bridge runtime capacity if infra permits.

### Recovery Validation

```bash
npm run verify:docker-smoke
npm run verify:observability-export
```

Expected: service remains healthy and metrics export remains consistent.

### Overload Checklist

- [ ] Snapshot and alert report captured
- [ ] Queue pressure reduced (drops stabilized)
- [ ] Critical latency returned under target window
- [ ] Recovery checks passed

---

## Cycle 2 DR Drill (Minimum)

Run weekly or before release tag:

```bash
npm run verify:release-pipeline -- v0.1.0
npm run verify:release-candidate -- v0.1.0
```

If both pass, DR readiness for cycle 2 is considered acceptable for release.
