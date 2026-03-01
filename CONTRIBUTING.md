# Contributing

## Branch naming

Use short, scoped branch names:

- `feat/<short-topic>`
- `fix/<short-topic>`
- `docs/<short-topic>`

## Commit format

Use Conventional Commits:

- `feat:`
- `fix:`
- `docs:`
- `chore:`

## Pull request checklist

- [ ] Scope is clear and small
- [ ] Docs updated (`README`, `docs/`, ADRs as needed)
- [ ] No secrets or local paths committed
- [ ] CI checks pass

## Architecture changes

If a change affects telemetry schema, security, or deployment model:

- Add or update an ADR in `docs/adr/`
- Reference the ADR in the PR description
