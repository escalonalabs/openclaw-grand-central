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
- Monorepo and TypeScript foundation
- Frontend prototype (`web/index.html`)
- CI for docs/link quality
- Repo governance for stable collaboration

## Repository layout

```text
.
├── apps/
│   ├── bridge/
│   │   └── src/
│   └── web/
│       └── src/
├── packages/
│   ├── schema/
│   │   └── src/
│   └── shared/
│       └── src/
├── tests/
│   ├── e2e/
│   └── unit/
├── infra/
│   └── docker/
├── docs/
│   ├── ARCHITECTURE_OPENCLAW_STATION.md
│   └── adr/
├── web/
│   └── index.html
└── .github/
    ├── ISSUE_TEMPLATE/
    └── workflows/
```

## Quick start

Install dependencies:

```bash
npm install
```

Run type checking across workspaces:

```bash
npm run typecheck
```

Open the static prototype locally:

```bash
xdg-open web/index.html
```

## Quality tooling and test harness

Install dev tooling:

```bash
npm ci
```

Run quality checks:

```bash
npm run lint
npm run test:unit
npm run test:e2e:smoke
```

CI compatibility notes:

- The scripts above are CI-safe and non-interactive.
- The current Playwright smoke test is a minimal placeholder (`@smoke`) to validate the harness.
- If browser-driven e2e coverage is added later, include `npx playwright install --with-deps` in CI before `npm run test:e2e:smoke`.

## Working model

1. Capture architecture changes in `docs/` first.
2. Record major decisions as ADRs in `docs/adr/`.
3. Implement in small PRs with tests and update docs in the same PR.

## Update cadence

- Weekly: review open issues, dependencies, and ADR backlog.
- Per change: update `CHANGELOG.md` and docs impacted.
- Per release: tag semver (`v0.x.y` while pre-production).

## License

MIT - see [LICENSE](LICENSE).
