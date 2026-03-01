# ADR-0004: Security model for bridge and control surfaces

## Status
Accepted

## Context
The architecture targets real-time telemetry and interactive controls for
OpenClaw lanes and approvals. Security-relevant data can include prompts, tool
arguments, and operator intents.

A baseline security model is required before wiring control actions, so authn,
authz, redaction, and action gating semantics stay consistent across transport
and UI layers.

## Assumptions
- Initial deployments may run on local or private networks, but network
  location is not a trust boundary.
- Identity provider integration is not yet standardized in this repository.
- The bridge may expose both read-only telemetry and mutating control actions.

## Decision
Apply the following baseline security model:

1. Authentication (authn)
- Require bearer-token authentication for bridge HTTP endpoints and WebSocket
  upgrades.
- Token source is deployment configuration (environment or resolver callback).
- If token configuration is missing, the bridge fails closed.

2. Authorization (authz)
- Enforce least privilege with explicit scopes:
  - `telemetry:read`
  - `action:execute`
  - `policy:admin`
- Read paths require `telemetry:read`; mutating paths require `action:execute`.
- Policy or guardrail changes require `policy:admin`.

3. Redaction
- Redact sensitive fields before event persistence or broadcast.
- Use deterministic field/path redaction first, with optional content-pattern
  redaction as defense in depth.
- On redaction-hook error, fail closed for sensitive events.

4. Action gates
- Mutating actions require an explicit gate decision (`allow` or `deny`) before
  execution.
- Default behavior is deny when gate context is incomplete.
- Gate decisions must include a machine-readable reason code.

5. Auditability
- Record authn/authz decisions, redaction outcomes, and gate decisions as
  structured audit events.
- Never log raw secret material in audit events.

## Consequences

### Positive
- Security boundaries are explicit before feature expansion.
- Sensitive payload handling is centralized and testable.
- Mutating controls become reviewable via structured gate decisions.

### Negative
- Added policy and middleware complexity for early-stage prototype code.
- Token/scope management becomes an operational requirement.

### Neutral
- Future identity-provider integration can map into the same scope model.

## Alternatives considered
- Trust local network only: weaker posture and easy lateral-movement abuse.
- Redact only in the UI: too late, as secrets may already be persisted/forwarded.
- Hard-code allow rules for actions: faster prototype, poor governance.
