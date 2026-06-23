import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyAutoApprovalRequest,
  evaluateAutoApprovalPolicy,
  getAutoApprovalPolicy,
  parseAutoApprovalPolicy,
  setAutoApprovalPolicy,
} from "./auto-approval-policy";

const TMP = mkdtempSync(join(tmpdir(), "hm-auto-approval-test-"));
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = TMP;

test.after(() => {
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

test("auto-approval allows checkpoints only when explicitly enabled", () => {
  assert.equal(evaluateAutoApprovalPolicy({}, { category: "checkpoint" }).allowed, false);
  assert.equal(evaluateAutoApprovalPolicy({ enabled: true }, { category: "checkpoint" }).allowed, false);
  assert.equal(
    evaluateAutoApprovalPolicy({ enabled: true, allowCheckpoints: true }, { category: "checkpoint" }).allowed,
    true,
  );
});

test("auto-approval rejects content, external, and unknown categories", () => {
  const policy = { enabled: true, allowCheckpoints: true, allowLowRiskTools: true };

  assert.equal(evaluateAutoApprovalPolicy(policy, { category: "content" }).allowed, false);
  assert.equal(evaluateAutoApprovalPolicy(policy, { category: "external" }).allowed, false);
  assert.equal(evaluateAutoApprovalPolicy(policy, { category: "unknown" }).allowed, false);
});

test("auto-approval policy parsing fails closed", () => {
  assert.deepEqual(parseAutoApprovalPolicy("{not json"), { enabled: false, allowCheckpoints: false, allowLowRiskTools: false });
  assert.deepEqual(parseAutoApprovalPolicy({ enabled: true, allowCheckpoints: true }), {
    enabled: true,
    allowCheckpoints: true,
    allowLowRiskTools: false,
  });
});

test("auto-approval policy persists through HiveMatrix config", () => {
  assert.deepEqual(getAutoApprovalPolicy(), { enabled: false, allowCheckpoints: false, allowLowRiskTools: false });
  assert.deepEqual(setAutoApprovalPolicy({ enabled: true, allowCheckpoints: true }), {
    enabled: true,
    allowCheckpoints: true,
    allowLowRiskTools: false,
  });
  assert.deepEqual(getAutoApprovalPolicy(), {
    enabled: true,
    allowCheckpoints: true,
    allowLowRiskTools: false,
  });
});

test("auto-approval classification keeps content approvals explicit", () => {
  assert.equal(classifyAutoApprovalRequest({ timestamp: "checkpoint-plan", tool: "Directive checkpoint" }), "checkpoint");
  assert.equal(classifyAutoApprovalRequest({ timestamp: "checkpoint-content", tool: "Directive checkpoint" }), "content");
  assert.equal(classifyAutoApprovalRequest({ timestamp: "123", tool: "Bash" }), "tool");
});
