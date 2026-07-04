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
  trustKey,
  isTrusted,
  trustAllowsAutoApproval,
  applyOutcome,
  recordApprovalOutcome,
  readTrustLedger,
  resetTrust,
} = await import("./trust-ledger");

test.after(() => {
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

test("trustKey: only checkpoint/lowRiskTool are eligible; everything else is null (safety floor)", () => {
  // Checkpoints are one class regardless of gate/tool (matches classifyAutoApprovalRequest).
  assert.equal(trustKey("checkpoint", "Directive checkpoint"), "checkpoint");
  assert.equal(trustKey("checkpoint"), "checkpoint");
  // lowRiskTool is keyed per tool.
  assert.equal(trustKey("lowRiskTool", "brain_search"), "lowRiskTool:brain_search");
  assert.equal(trustKey("lowRiskTool"), "lowRiskTool");
  for (const c of ["content", "external", "tool", "stuck", "unknown"] as const) {
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

test("applyOutcome folds approvals and denials with timestamps", () => {
  let e = applyOutcome(undefined, true, "t1");
  assert.deepEqual({ a: e.approvals, d: e.denials, la: e.lastApprovalAt }, { a: 1, d: 0, la: "t1" });
  e = applyOutcome(e, true, "t2");
  e = applyOutcome(e, false, "t3");
  assert.deepEqual({ a: e.approvals, d: e.denials, ld: e.lastDenialAt }, { a: 2, d: 1, ld: "t3" });
});

test("trustAllowsAutoApproval: gated to autonomous + eligible + earned", () => {
  const ledger = { "checkpoint": { approvals: 3, denials: 0 } };
  // Not autonomous → never
  assert.equal(trustAllowsAutoApproval({ category: "checkpoint", tool: "Directive checkpoint" }, "standard", ledger).allowed, false);
  assert.equal(trustAllowsAutoApproval({ category: "checkpoint", tool: "Directive checkpoint" }, "manual", ledger).allowed, false);
  // Autonomous + earned → allowed
  const ok = trustAllowsAutoApproval({ category: "checkpoint", tool: "Directive checkpoint" }, "autonomous", ledger);
  assert.equal(ok.allowed, true);
  assert.match(ok.reason, /earned trust/);
  // Autonomous but a protected category → never (floor holds even in autonomous)
  assert.equal(trustAllowsAutoApproval({ category: "tool", tool: "Bash" }, "autonomous", ledger).allowed, false);
  assert.equal(trustAllowsAutoApproval({ category: "external", tool: "mail" }, "autonomous", ledger).allowed, false);
  // Autonomous, eligible, but not yet earned → asked
  const notYet = trustAllowsAutoApproval({ category: "checkpoint", tool: "Directive checkpoint" }, "autonomous", {});
  assert.equal(notYet.allowed, false);
  assert.match(notYet.reason, /0\/3 approvals/);
});

test("a denial revokes an otherwise-trusted class under autonomous", () => {
  const ledger = { "checkpoint": { approvals: 9, denials: 1 } };
  const d = trustAllowsAutoApproval({ category: "checkpoint", tool: "Directive checkpoint" }, "autonomous", ledger);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /revoked/);
});

test("recordApprovalOutcome persists eligible classes and no-ops ineligible ones", () => {
  resetTrust();
  const clock = (() => { let n = 0; return () => `2026-07-04T00:00:0${n++}Z`; })();
  assert.equal(recordApprovalOutcome({ category: "tool", tool: "Bash" }, true, clock), null); // ineligible → no key
  for (let i = 0; i < 3; i++) recordApprovalOutcome({ category: "checkpoint", tool: "Directive checkpoint" }, true, clock);
  const ledger = readTrustLedger();
  assert.equal(ledger["checkpoint"].approvals, 3);
  assert.equal(ledger["tool:bash"], undefined);
  // Now it should be trusted under autonomous
  assert.equal(trustAllowsAutoApproval({ category: "checkpoint", tool: "Directive checkpoint" }, "autonomous", ledger).allowed, true);
});

test("resetTrust(key) clears a single class; resetTrust() clears all", () => {
  recordApprovalOutcome({ category: "lowRiskTool", tool: "brain_search" }, true);
  resetTrust("checkpoint");
  assert.equal(readTrustLedger()["checkpoint"], undefined);
  assert.ok(readTrustLedger()["lowRiskTool:brain_search"]);
  resetTrust();
  assert.deepEqual(readTrustLedger(), {});
});

test("DEFAULT_TRUST_THRESHOLD is a small, fast ramp", () => {
  assert.ok(DEFAULT_TRUST_THRESHOLD >= 2 && DEFAULT_TRUST_THRESHOLD <= 5);
});
