# Release Pipeline Audit

- Tag audited: v0.1.0
- Commit: c9325b2902bd43e4794de998042fe3286e889672
- Timestamp (UTC): 2026-03-02T03:49:08Z

## Checks

- Release workflow trigger is semver tag based.
- Pipeline includes typecheck, tests, smoke, docker, and observability gates.
- Pipeline includes runbook DR gate for incident readiness.
- Workflow publishes both build evidence and observability artifacts.
- Notes rendering from changelog is wired and preview is non-empty.
- Runbooks for release automation and checklist are present.

## Evidence files

- artifacts/release/release-notes-v0.1.0.md
