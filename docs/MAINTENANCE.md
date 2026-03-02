# Maintenance Guide

## Weekly routine

1. Review open issues and stale PRs
2. Run CI manually (`workflow_dispatch`) if needed
3. Review Dependabot updates
4. Update backlog ADRs and changelog

## Release routine

1. Merge approved PRs to `main`
2. Update `CHANGELOG.md`
3. Tag release (`v0.x.y`)
4. Publish release notes

Before tagging, execute the release checklist:

- `docs/runbooks/RELEASE_CHECKLIST_v0.1.0.md`
- `docs/runbooks/RELEASE_AUTOMATION.md`
- `docs/runbooks/INCIDENT_RESPONSE_CYCLE2.md`
- `docs/runbooks/DISASTER_RECOVERY_CYCLE3.md`
- `docs/runbooks/CYCLE3_CLOSEOUT_v0.1.0.md`

Recommended local release validations:

- `npm run release:candidate -- v0.1.0`
- `npm run verify:release-pipeline -- v0.1.0`
- `npm run verify:release-candidate -- v0.1.0`
- `npm run verify:release-traceability -- v0.1.0`
- `npm run verify:observability-prometheus`
- `npm run verify:synthetic-load`
- `npm run verify:lane-fairness`
- `npm run verify:action-idempotency`
- `npm run verify:policy-pack-rollback`
- `npm run verify:operational-timeline-ui`
- `npm run verify:observability-slo-bundle`
- `npm run verify:dashboard-slo-export`
- `npm run verify:security-rotation`
- `npm run verify:dr-integrity`
- `npm run verify:dr-drill`
- `npm run verify:cycle3-readiness`
- `npm run verify:cycle3-regression`
- `npm run verify:runbooks-dr`
- `npm run verify:cycle2-regression`

## Local update commands

```bash
git checkout main
git pull --rebase origin main
```

## Local Docker dev environment

Start bridge + web services:

```bash
./scripts/dev-up.sh
```

Stop services:

```bash
./scripts/dev-down.sh
```

Use custom ports when needed:

```bash
BRIDGE_PORT=3100 WEB_PORT=5174 ./scripts/dev-up.sh
```

Validate compose wiring before pushing changes:

```bash
docker compose -f infra/docker/docker-compose.dev.yml config
```

Run full Docker smoke verification (config + up + ps + down):

```bash
npm run verify:docker-smoke
```
