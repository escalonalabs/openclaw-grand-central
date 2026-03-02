# Release Checklist v0.2.0

## Preconditions

1. Branch is up-to-date with `main`.
2. No open blocker tagged `security`, `contract`, or `readiness`.
3. Docker compose config validates in target environment:

```bash
docker compose -f infra/docker/docker-compose.dev.yml config
```

## Quality gates

Run the professional one-command rehearsal before tagging:

```bash
npm run release:candidate -- v0.2.0
```

If troubleshooting is needed, run granular gates:

```bash
npm run verify:release-pipeline -- v0.2.0
npm run typecheck
npm --workspace @openclaw/schema test
npm --workspace @openclaw/bridge test
npm --workspace @openclaw/web test
npm run test:e2e:smoke
npm run verify:docker-smoke
npm run verify:observability-export
npm run verify:observability-alerts
npm run verify:plugin-failover-recovery
npm run verify:dr-integrity
npm run verify:dr-drill
npm run verify:runbooks-dr
npm run verify:release-candidate -- v0.2.0
npm run verify:release-traceability -- v0.2.0
```

## Security checks

1. Confirm bridge token is configured in runtime:
`OPENCLAW_BRIDGE_TOKEN`.
2. Confirm scope mapping includes `metrics:read`, `telemetry:read`,
`actions:write`, and `policy:admin`.
3. Verify `/metrics` rejects missing/invalid token and accepts valid scope.
4. Verify plugin ingest failures return deterministic reason codes.

## Documentation checks

1. Update `CHANGELOG.md` for tag `v0.2.0`.
2. Confirm release automation is up-to-date:
`docs/runbooks/RELEASE_AUTOMATION.md`.
3. Confirm cycle closeout is updated:
`docs/runbooks/CYCLE4_CLOSEOUT_v0.2.0.md`.
4. Confirm DR automation runbook is current:
`docs/runbooks/DISASTER_RECOVERY_CYCLE3.md`.

## Release steps

1. Merge approved PRs into `main`.
2. Create annotated semver tag (`v0.x.y`).
3. Push tag and let `.github/workflows/release.yml` run gates + publish notes.
4. Verify release artifacts include evidence and observability snapshots.
