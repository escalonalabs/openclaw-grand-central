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
