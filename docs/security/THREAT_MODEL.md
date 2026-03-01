# Threat model: OpenClaw Grand Central bridge and dashboard

## Status
Draft baseline

## Scope
This model covers telemetry ingestion, bridge processing, WebSocket fan-out,
and control-action entry points described in
`docs/ARCHITECTURE_OPENCLAW_STATION.md`.

Out of scope for this baseline:

- Host hardening and OS-level controls
- Third-party identity provider specifics
- Browser extension or plugin ecosystems

## Assumptions
- The bridge is the security chokepoint between OpenClaw telemetry and clients.
- Upstream telemetry can contain sensitive data (prompt fragments, tool args,
  file paths, and approval context).
- Network position does not imply trust.

## Assets to protect
- Control-plane integrity for mutating actions (approvals, command execution).
- Confidentiality of secrets and sensitive operator context.
- Availability of critical telemetry and approval signals.
- Integrity of event ordering and source attribution.

## Trust boundaries

1. OpenClaw runtime boundary
- Components: lanes, diagnostics emitter, terminal execution.
- Risk: raw event material may contain sensitive content.

2. Bridge boundary
- Components: parser/normalizer, authn/authz guardrails, redaction hooks,
  WebSocket server.
- Risk: unauthorized access, data leakage, and action abuse.

3. Client boundary
- Components: browser dashboard and operator interactions.
- Risk: token theft, over-privileged sessions, unsafe action requests.

## Threat scenarios and baseline mitigations

| Threat | Impact | Baseline mitigation |
|---|---|---|
| Unauthorized WebSocket subscription | Confidential telemetry exposure | Bearer token authn, scope checks (`telemetry:read`) |
| Replay or spoofed control action | Integrity loss on runtime actions | Action-gate default deny, audit decision logging |
| Secret leakage in event payload | Credential compromise | Bridge-side redaction before broadcast/persist |
| Event flood starves critical signals | Missed approvals/security events | QoS classes with critical-priority handling |
| Schema drift breaks parser silently | Lost or misinterpreted telemetry | Versioned event envelope (`schema_version`) |
| Excessive failed auth attempts | Service degradation, brute force | Rate limiting and failed-auth monitoring (operational) |

## Control mapping
- ADR-0003 defines schema and QoS contracts used for integrity and availability.
- ADR-0004 defines authn/authz, redaction, and action-gate baseline controls.

## Residual risks
- Token lifecycle (rotation and revocation) is not fully automated yet.
- Incident response runbook and forensic retention are still TODO items.
- End-to-end cryptographic event signing is not yet defined.

## Validation plan
- Unit tests for token parsing, auth deny paths, and redaction behavior.
- Contract tests for schema-version compatibility.
- Load tests with mixed QoS to verify critical-event survivability.
- Security review before enabling any mutating action endpoint by default.
