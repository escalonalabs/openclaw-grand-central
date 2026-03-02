# Release Checklist v0.1.0

## Preconditions

1. Branch is up-to-date with `main`.
2. No open blocker tagged `security` or `contract`.
3. Docker compose config validates in target environment:

```bash
docker compose -f infra/docker/docker-compose.dev.yml config
```

## Quality gates

Run the professional one-command rehearsal before tagging:

```bash
npm run release:candidate -- v0.1.0
```

If troubleshooting is needed, run granular gates:

```bash
npm run verify:release-pipeline -- v0.1.0
npm run typecheck
npm --workspace @openclaw/schema test
npm --workspace @openclaw/bridge test
npm --workspace @openclaw/web test
npm run test:e2e:smoke
npm run verify:docker-smoke
npm run verify:observability-export
npm run verify:observability-alerts
npm run verify:observability-prometheus
npm run verify:dr-integrity
npm run verify:dr-drill
npm run verify:cycle3-readiness
npm run verify:cycle3-regression
npm run verify:runbooks-dr
npm run verify:release-traceability -- v0.1.0
npm run verify:release-candidate -- v0.1.0
npm run verify:cycle2-regression
```

## Security checks

1. Confirm bridge token is configured in runtime:
`OPENCLAW_BRIDGE_TOKEN`.
2. Confirm scope mapping includes `metrics:read` and `telemetry:read`.
3. Verify `/metrics` rejects missing/invalid token and accepts valid scope.

## Documentation checks

1. Update `CHANGELOG.md`.
2. Confirm roadmap section reflects completed and blocked tasks.
3. Confirm ADR references are up to date for architecture and security.
4. Confirm incident runbook is current: `docs/runbooks/INCIDENT_RESPONSE_CYCLE2.md`.
5. Confirm DR automation runbook is current: `docs/runbooks/DISASTER_RECOVERY_CYCLE3.md`.
6. Confirm cycle closeout runbook is current: `docs/runbooks/CYCLE3_CLOSEOUT_v0.1.0.md`.

## Release steps

1. Merge approved PRs into `main`.
2. Create annotated semver tag (`v0.x.y`).
3. Push tag and let `.github/workflows/release.yml` run gates + publish notes.
4. Verify release artifacts include evidence and observability snapshots.
