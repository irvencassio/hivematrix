import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-trust-test-"));
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = TMP;

const {
  DEFAULT_TRUST_THRESHOLD,
  SPOT_CHECK_EVERY,
  trustKey,
  isTrusted,
  trustAllowsAutoApproval,
  applyOutcome,
  recordApprovalOutcome,
  recordTrustAutoApproval,
  readTrustLedger,
  resetTrust,
} = await import("./trust-ledger");

test.after(() => {
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

test("trustKey: ONLY checkpoint is eligible; every other category is null (safety floor)", () => {
  assert.equal(trustKey("checkpoint", "Directive checkpoint"), "checkpoint");
  assert.equal(trustKey("checkpoint"), "checkpoint");
  for (const c of ["content", "external", "tool", "stuck", "unknown", "lowRiskTool"] as const) {
    assert.equal(trustKey(c, "anything"), null, `${c} must never earn trust`);
  }
});

test("isTrusted: needs >= threshold approvals AND zero denials", () => {
  assert.equal(isTrusted(undefined), false);
  assert.equal(isTrusted({ approvals: 2, denials: 0 }), false);
  assert.equal(isTrusted({ approvals: 3, denials: 0 }), true);
  assert.equal(isTrusted({ approvals: 10, denials: 1 }), false); // a single denial blocks
  assert.equal(isTrusted({ approvals: 5, denials: 0 }, 5), true);
});

test("applyOutcome folds approvals (advancing the grant counter) and denials", () => {
  let e = applyOutcome(undefined, true, "t1");
  assert.deepEqual({ a: e.approvals, d: e.denials, g: e.autoApprovals }, { a: 1, d: 0, g: 1 });
  e = applyOutcome(e, false, "t2");
  assert.deepEqual({ a: e.approvals, d: e.denials, ld: e.lastDenialAt }, { a: 1, d: 1, ld: "t2" });
});

test("trustAllowsAutoApproval: gated to autonomous + eligible + earned; denial revokes", () => {
  const ledger = { checkpoint: { approvals: 3, denials: 0 } };
  assert.equal(trustAllowsAutoApproval({ category: "checkpoint" }, "standard", ledger).allowed, false);
  assert.equal(trustAllowsAutoApproval({ category: "checkpoint" }, "manual", ledger).allowed, false);
  assert.equal(trustAllowsAutoApproval({ category: "checkpoint" }, "autonomous", ledger).allowed, true);
  assert.equal(trustAllowsAutoApproval({ category: "tool", tool: "Bash" }, "autonomous", ledger).allowed, false);
  const revoked = trustAllowsAutoApproval({ category: "checkpoint" }, "autonomous", { checkpoint: { approvals: 9, denials: 1 } });
  assert.equal(revoked.allowed, false);
  assert.match(revoked.reason, /revoked/);
});

test("spot-check: every Nth grant re-prompts the operator; their approval moves past the boundary", () => {
  // 8 prior grants -> 9th would be fine; SPOT_CHECK_EVERY-1 prior grants -> next is the spot check.
  const nearBoundary = { checkpoint: { approvals: 5, denials: 0, autoApprovals: SPOT_CHECK_EVERY - 1 } };
  const check = trustAllowsAutoApproval({ category: "checkpoint" }, "autonomous", nearBoundary);
  assert.equal(check.allowed, false);
  assert.match(check.reason, /spot-check/);
  // Operator approves the spot-checked request -> applyOutcome advances autoApprovals -> auto again.
  const after = { checkpoint: applyOutcome(nearBoundary.checkpoint, true, "t") };
  assert.equal(trustAllowsAutoApproval({ category: "checkpoint" }, "autonomous", after).allowed, true);
});

test("recordApprovalOutcome + recordTrustAutoApproval persist; ineligible categories no-op", () => {
  resetTrust();
  assert.equal(recordApprovalOutcome({ category: "tool", tool: "Bash" }, true), null);
  for (let i = 0; i < 3; i++) recordApprovalOutcome({ category: "checkpoint" }, true);
  assert.equal(readTrustLedger().checkpoint.approvals, 3);
  recordTrustAutoApproval("checkpoint");
  assert.equal(readTrustLedger().checkpoint.autoApprovals, 4); // 3 operator approvals + 1 grant
  assert.equal(trustAllowsAutoApproval({ category: "checkpoint" }, "autonomous", readTrustLedger()).allowed, true);
});

test("resetTrust(key) clears a single class; resetTrust() clears all", () => {
  resetTrust("checkpoint");
  assert.equal(readTrustLedger().checkpoint, undefined);
  recordApprovalOutcome({ category: "checkpoint" }, true);
  resetTrust();
  assert.deepEqual(readTrustLedger(), {});
});

test("thresholds are small and sane", () => {
  assert.ok(DEFAULT_TRUST_THRESHOLD >= 2 && DEFAULT_TRUST_THRESHOLD <= 5);
  assert.ok(SPOT_CHECK_EVERY >= 5 && SPOT_CHECK_EVERY <= 25);
});
