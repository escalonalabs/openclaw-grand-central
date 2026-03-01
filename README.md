# OpenClaw Grand Central

Real-time 3D command center for OpenClaw telemetry.

## What this project does

OpenClaw Grand Central visualizes live OpenClaw activity using a train-station metaphor:

- Agents as trains
- Workspaces as stations
- Sessions/lanes as tracks
- Exec approvals as traffic lights

## Current scope

- Architecture and ADR baseline
- Frontend prototype (`web/index.html`)
- CI for docs/link quality
- Repo governance for stable collaboration

## Repository layout

```text
.
├── bridge/
│   └── middleware/
├── docs/
│   ├── ARCHITECTURE_OPENCLAW_STATION.md
│   ├── adr/
│   ├── observability/
│   └── security/
├── web/
│   └── index.html
└── .github/
    ├── ISSUE_TEMPLATE/
    └── workflows/
```

## Quick start

Open the prototype locally:

```bash
xdg-open web/index.html
```

## Working model

1. Capture architecture changes in `docs/` first.
2. Record major decisions as ADRs in `docs/adr/`.
3. Capture security and observability contracts with each architecture update.
4. Implement in small PRs with tests and update docs in the same PR.

## Update cadence

- Weekly: review open issues, dependencies, and ADR backlog.
- Per change: update `CHANGELOG.md` and docs impacted.
- Per release: tag semver (`v0.x.y` while pre-production).

## License

MIT - see [LICENSE](LICENSE).
