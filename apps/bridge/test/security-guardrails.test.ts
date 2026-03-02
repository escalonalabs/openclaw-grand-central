import assert from "node:assert/strict";
import test from "node:test";

import {
  createBridgeSecurityGuardrails,
  defaultRedactHook,
  extractBearerToken,
} from "../src/securityGuardrails.ts";

test("extractBearerToken parses bearer headers", () => {
  assert.equal(extractBearerToken("Bearer abc-123"), "abc-123");
  assert.equal(extractBearerToken("bearer xyz"), "xyz");
  assert.equal(extractBearerToken("Token nope"), "");
  assert.equal(extractBearerToken(undefined), "");
});

test("authorize denies when token is missing, invalid, or scope is absent", () => {
  const noTokenGuardrails = createBridgeSecurityGuardrails({
    tokenResolver: () => "",
  });
  assert.equal(
    noTokenGuardrails.authorize("Bearer demo", "metrics:read").allowed,
    false,
  );
  assert.equal(
    noTokenGuardrails.authorize("Bearer demo", "metrics:read").statusCode,
    503,
  );

  const invalidTokenGuardrails = createBridgeSecurityGuardrails({
    tokenResolver: () => "expected",
    scopesResolver: () => ["metrics:read"],
  });
  assert.equal(
    invalidTokenGuardrails.authorize("Bearer wrong", "metrics:read").statusCode,
    401,
  );

  const missingScopeGuardrails = createBridgeSecurityGuardrails({
    tokenResolver: () => "expected",
    scopesResolver: () => ["telemetry:read"],
  });
  const missingScopeResult = missingScopeGuardrails.authorize(
    "Bearer expected",
    "metrics:read",
  );
  assert.equal(missingScopeResult.statusCode, 403);
  assert.equal(missingScopeResult.reason, "missing_scope");
});

test("authorize accepts previous token during rotation grace window", () => {
  const guardrails = createBridgeSecurityGuardrails({
    tokenResolver: () => ["token-new", "token-old"],
    scopesResolver: (token) =>
      token === "token-old"
        ? ["telemetry:read", "metrics:read"]
        : ["telemetry:read", "metrics:read", "control:write"],
  });

  const oldTokenResult = guardrails.authorize("Bearer token-old", "metrics:read");
  assert.equal(oldTokenResult.allowed, true);
  assert.equal(oldTokenResult.statusCode, 200);

  const newTokenResult = guardrails.authorize("Bearer token-new", "control:write");
  assert.equal(newTokenResult.allowed, true);
  assert.equal(newTokenResult.statusCode, 200);
});

test("redaction masks sensitive keys recursively", () => {
  const event = {
    version: "1.0" as const,
    eventId: "evt-1",
    occurredAt: "2026-03-01T19:00:00.000Z",
    eventType: "approval.requested",
    severity: "info" as const,
    source: {
      agentId: "agent-1",
      workspaceId: "workspace-omnia",
      laneId: "lane-main",
      sessionId: "session-1",
    },
    payload: {
      command: "deploy",
      apiKey: "ABC123",
      nested: {
        token: "SECRET",
      },
    },
  };

  const redacted = defaultRedactHook(event);
  assert.equal(redacted.payload.apiKey, "[REDACTED]");
  assert.deepEqual(redacted.payload.nested, { token: "[REDACTED]" });
});

test("action gate denies when allowlist is empty", () => {
  const guardrails = createBridgeSecurityGuardrails({
    tokenResolver: () => "expected",
    scopesResolver: () => ["control:write", "metrics:read", "telemetry:read"],
    actionAllowlist: [],
  });

  const decision = guardrails.decideAction(
    "open-terminal",
    "Bearer expected",
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.statusCode, 403);
  assert.equal(decision.reason, "action_allowlist_empty");
});

test("action gate uses deterministic reason codes for allow and deny", () => {
  const guardrails = createBridgeSecurityGuardrails({
    tokenResolver: () => "expected",
    scopesResolver: () => ["control:write", "metrics:read", "telemetry:read"],
    actionAllowlist: ["restart-lane", "resume-lane"],
  });

  const allowed = guardrails.decideAction(
    "RESTART-LANE",
    "Bearer expected",
  );
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.statusCode, 202);
  assert.equal(allowed.reason, "action_allowed");

  const denied = guardrails.decideAction(
    "shutdown-all",
    "Bearer expected",
  );
  assert.equal(denied.allowed, false);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.reason, "action_not_allowlisted");

  const invalid = guardrails.decideAction(
    "restart/lane",
    "Bearer expected",
  );
  assert.equal(invalid.allowed, false);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.reason, "action_invalid");
});
