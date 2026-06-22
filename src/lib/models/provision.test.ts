import test from "node:test";
import assert from "node:assert/strict";
import { planLocalEngine, getProvisionStatus } from "./provision";

test("planLocalEngine: 48 GB → one resident tier (fast) resolved to a serve target", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 48 });
  assert.equal(plan.localCapable, true);
  assert.deepEqual(plan.recommendedTiers, ["fast"]);
  assert.equal(plan.tiers.length, 1);
  assert.equal(plan.tiers[0].alias, "qwen3.6-35b-4bit");
  assert.equal(plan.tiers[0].reasoning, false); // reasoning off by default
});

test("planLocalEngine: 64 GB → both tiers resident", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 64 });
  assert.deepEqual(plan.recommendedTiers, ["fast", "coding"]);
  assert.equal(plan.tiers.length, 2);
});

test("planLocalEngine: 16 GB → cloud-only, no tiers, with a reason", () => {
  const plan = planLocalEngine({ arch: "arm64", ramGB: 16 });
  assert.equal(plan.localCapable, false);
  assert.deepEqual(plan.tiers, []);
  assert.match(plan.reason ?? "", /local model/);
});

test("getProvisionStatus starts idle with an empty log", () => {
  const s = getProvisionStatus();
  assert.equal(s.phase, "idle");
  assert.deepEqual(s.log, []);
  assert.equal(s.error, null);
});
