# Disaster Recovery Automation Runbook (Cycle 3)

## Scope

Automated backup and restore of critical project artifacts to support
repeatable disaster recovery drills in local environments.

## Critical backup scope

- `apps/`
- `packages/`
- `docs/`
- `scripts/`
- `infra/docker/`
- `.github/workflows/`
- Root control files:
  - `package.json`
  - `package-lock.json`
  - `tsconfig.json`
  - `tsconfig.base.json`
  - `README.md`
  - `CHANGELOG.md`
  - `.gitignore`

## Commands

Create backup bundle + manifest + report:

```bash
npm run backup:dr
```

Restore and verify hashes from backup:

```bash
npm run restore:dr -- artifacts/dr/dr-backup-latest.tar.gz artifacts/dr/dr-backup-latest.manifest.json artifacts/dr/restore-manual
```

Run integrity verification (`backup -> restore -> manifest/hash check`):

```bash
npm run verify:dr-integrity
```

Run full DR drill (`verify:dr-integrity + bridge tests + docker smoke`):

```bash
npm run verify:dr-drill
```

## Expected artifacts

- `artifacts/dr/dr-backup-<run-id>.tar.gz`
- `artifacts/dr/dr-backup-<run-id>.manifest.json`
- `artifacts/dr/dr-backup-<run-id>.files.txt`
- `artifacts/dr/dr-backup-<run-id>.md`
- `artifacts/dr/dr-restore-<run-id>.md`
- `artifacts/dr/dr-integrity-report-<run-id>.md`
- `artifacts/dr/dr-drill-report-<run-id>.md`

Latest pointers are also maintained:

- `artifacts/dr/dr-backup-latest.tar.gz`
- `artifacts/dr/dr-backup-latest.manifest.json`
- `artifacts/dr/dr-backup-latest.files.txt`
- `artifacts/dr/dr-backup-latest.md`
- `artifacts/dr/dr-restore-latest.md`
- `artifacts/dr/dr-integrity-report-latest.md`
- `artifacts/dr/dr-drill-report-latest.md`
