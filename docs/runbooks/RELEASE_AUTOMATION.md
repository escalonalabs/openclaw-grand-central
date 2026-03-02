# Release Automation Runbook

## Goal

Automate release candidate generation from semver tags with reproducible
evidence and release notes.

## Workflow

GitHub Actions workflow:

- `.github/workflows/release.yml`

Trigger:

- Push tag matching `v*.*.*` (example: `v0.2.0`)

Pipeline stages:

1. Typecheck and workspace tests.
2. Smoke e2e.
3. Docker smoke verification.
4. Observability export and alert verification.
5. Render release notes from `CHANGELOG.md`.
6. Publish GitHub release with evidence artifacts.

## Local preflight

Professional one-command rehearsal (recommended):

```bash
npm run release:candidate -- <tag>
```

Equivalent granular flow (for troubleshooting):

```bash
npm run verify:release-pipeline -- <tag>
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
npm run verify:plugin-failover-recovery
```

Optional release notes preview:

```bash
npm run render:release-notes -- v0.1.1 artifacts/release/release-notes.md
```

End-to-end local candidate rehearsal (same gates, notes integrity, and evidence):

```bash
npm run verify:release-candidate -- <tag>
```

Traceability-only audit for existing artifacts:

```bash
npm run verify:release-traceability -- <tag>
```

Cycle-close regression pack:

```bash
npm run verify:cycle2-regression
```

## Tagging

```bash
git checkout main
git pull --rebase origin main
git tag -a <tag> -m "Release <tag>"
git push origin <tag>
```

## Expected outputs

Published GitHub release includes:

- `artifacts/release/release-evidence.md`
- `artifacts/observability/metrics-snapshot.json`
- `artifacts/observability/metrics-snapshot-prometheus-parity.json`
- `artifacts/observability/metrics-prometheus.txt`
- `artifacts/observability/metrics-alert-test-snapshot.json`
- `artifacts/observability/alert-report.json`
- `artifacts/observability/prometheus-parity-report.md`
- `artifacts/runbooks/runbook-dr-audit.md`
- `artifacts/dr/dr-integrity-report-latest.md`
- `artifacts/dr/dr-drill-report-latest.md`
- `artifacts/release/cycle3-readiness-audit.md`
- `artifacts/regression/cycle3-regression-report.md`

Local verification evidence includes:

- `artifacts/release/release-candidate-bundle-<tag>.md`
- `artifacts/release/release-candidate-manifest-<tag>.json`
- `artifacts/release/release-pipeline-audit-<tag>.md`
- `artifacts/release/release-candidate-evidence-<tag>.md`
- `artifacts/release/release-traceability-audit-<tag>.md`
- `artifacts/runbooks/runbook-dr-audit.md`
- `artifacts/regression/cycle2-regression-report.md`
- `docs/runbooks/RELEASE_CHECKLIST_<tag>.md` (or fallback default checklist)

## Failure handling

- If the pipeline fails, fix the failing gate and create a new patch tag.
- If notes are missing for a tag, update `CHANGELOG.md` and re-run with a new
  release tag.
