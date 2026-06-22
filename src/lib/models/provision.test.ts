import test from "node:test";
import assert from "node:assert/strict";
import { planLocalEngine, getProvisionStatus, pythonVersionOk } from "./provision";

test("pythonVersionOk: 3.13+ required (rapid-mlx has no 3.9 wheel)", () => {
  assert.equal(pythonVersionOk("3.9"), false);   // the target Mac's system python
  assert.equal(pythonVersionOk("3.12"), false);
  assert.equal(pythonVersionOk("3.13"), true);
  assert.equal(pythonVersionOk("3.14"), true);    // the bundled interpreter
  assert.equal(pythonVersionOk("4.0"), true);
  assert.equal(pythonVersionOk(""), false);       // unknown
});

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
