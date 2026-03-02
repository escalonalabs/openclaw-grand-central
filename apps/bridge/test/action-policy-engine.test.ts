import assert from "node:assert/strict";
import test from "node:test";

import {
  createActionPolicyEngine,
  createActionPolicyPackManager,
  normalizeActionName,
  parseActionAllowlist,
} from "../src/actionPolicyEngine.ts";

test("parseActionAllowlist handles csv values and empty input", () => {
  assert.deepEqual(parseActionAllowlist(undefined), []);
  assert.deepEqual(parseActionAllowlist(""), []);
  assert.deepEqual(
    parseActionAllowlist(" restart-lane ,resume-lane, , stop-lane "),
    ["restart-lane", "resume-lane", "stop-lane"],
  );
});

test("normalizeActionName enforces deterministic action format", () => {
  assert.equal(normalizeActionName("RESTART-LANE"), "restart-lane");
  assert.equal(normalizeActionName(" lane.start "), "lane.start");
  assert.equal(normalizeActionName("restart/lane"), "");
  assert.equal(normalizeActionName(""), "");
});

test("action policy engine returns allowlist reason codes", () => {
  const engine = createActionPolicyEngine({
    allowlist: ["restart-lane", "resume-lane"],
  });

  assert.deepEqual(engine.allowlist, ["restart-lane", "resume-lane"]);
  assert.deepEqual(engine.decide("RESTART-LANE"), {
    allowed: true,
    reason: "action_allowed",
    statusCode: 202,
  });
  assert.deepEqual(engine.decide("stop-lane"), {
    allowed: false,
    reason: "action_not_allowlisted",
    statusCode: 403,
  });
  assert.deepEqual(engine.decide("stop/lane"), {
    allowed: false,
    reason: "action_invalid",
    statusCode: 400,
  });
});

test("action policy engine denies when allowlist is empty", () => {
  const engine = createActionPolicyEngine({ allowlist: [] });
  assert.deepEqual(engine.decide("restart-lane"), {
    allowed: false,
    reason: "action_allowlist_empty",
    statusCode: 403,
  });
});

test("policy pack manager validates, applies, and rolls back policy packs", () => {
  const manager = createActionPolicyPackManager({
    allowlist: ["restart-lane", "resume-lane"],
    initialPackId: "baseline",
    now: (() => {
      let ordinal = 0;
      return () => `2026-03-02T00:00:0${ordinal += 1}.000Z`;
    })(),
  });

  const invalidValidation = manager.validate({
    packId: "invalid/id",
    allowlist: ["restart/lane"],
  });
  assert.equal(invalidValidation.valid, false);
  assert.equal(
    invalidValidation.issues.some((issue) => issue.code === "policy_pack_id_invalid"),
    true,
  );
  assert.equal(
    invalidValidation.issues.some(
      (issue) => issue.code === "policy_pack_action_invalid",
    ),
    true,
  );

  const applied = manager.apply({
    packId: "ops-v2",
    description: "introduce pause lane",
    allowlist: ["pause-lane", "resume-lane"],
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.reason, "policy_pack_applied");
  assert.equal(applied.activePack.packId, "ops-v2");
  assert.equal(applied.activePack.version, 2);
  assert.equal(applied.historyDepth, 1);
  assert.equal(applied.previousPack?.packId, "baseline");

  assert.deepEqual(manager.decide("pause-lane"), {
    allowed: true,
    reason: "action_allowed",
    statusCode: 202,
  });
  assert.deepEqual(manager.decide("restart-lane"), {
    allowed: false,
    reason: "action_not_allowlisted",
    statusCode: 403,
  });

  const rollback = manager.rollback();
  assert.equal(rollback.rolledBack, true);
  assert.equal(rollback.reason, "policy_pack_rollback_applied");
  assert.equal(rollback.rolledBackFromPackId, "ops-v2");
  assert.equal(rollback.rolledBackToPackId, "baseline");
  assert.equal(rollback.activePack.version, 1);
  assert.equal(rollback.historyDepth, 0);

  assert.deepEqual(manager.decide("restart-lane"), {
    allowed: true,
    reason: "action_allowed",
    statusCode: 202,
  });
});

test("policy pack manager supports rollback to explicit target pack id", () => {
  const manager = createActionPolicyPackManager({
    allowlist: ["restart-lane"],
    initialPackId: "baseline",
    now: (() => {
      let ordinal = 0;
      return () => `2026-03-02T00:10:0${ordinal += 1}.000Z`;
    })(),
  });

  assert.equal(
    manager.apply({
      packId: "ops-v2",
      allowlist: ["pause-lane"],
    }).applied,
    true,
  );
  assert.equal(
    manager.apply({
      packId: "ops-v3",
      allowlist: ["shutdown-lane"],
    }).applied,
    true,
  );

  const rollbackToBaseline = manager.rollback("baseline");
  assert.equal(rollbackToBaseline.rolledBack, true);
  assert.equal(rollbackToBaseline.activePack.packId, "baseline");
  assert.equal(rollbackToBaseline.historyDepth, 0);

  const rollbackUnavailable = manager.rollback("ops-v2");
  assert.equal(rollbackUnavailable.rolledBack, false);
  assert.equal(rollbackUnavailable.reason, "policy_pack_rollback_unavailable");
});
