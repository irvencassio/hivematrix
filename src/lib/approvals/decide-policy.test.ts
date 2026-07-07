import assert from "node:assert/strict";
import test from "node:test";

import { decidePolicy } from "./decide-policy";
import type { AutoApprovalPolicy } from "@/lib/voice/auto-approval-policy";
import type { TrustLedger } from "@/lib/approvals/trust-ledger";

const OFF: AutoApprovalPolicy = { enabled: false, allowCheckpoints: false, allowLowRiskTools: false };
const CHECKPOINTS_ON: AutoApprovalPolicy = { enabled: true, allowCheckpoints: true, allowLowRiskTools: false };
const TRUSTED: TrustLedger = { checkpoint: { approvals: 3, denials: 0 } };

test("explicit operator policy auto-approves a checkpoint (any autonomy level)", () => {
  const v = decidePolicy({ category: "checkpoint", policy: CHECKPOINTS_ON, autonomyLevel: "standard", ledger: {} });
  assert.equal(v.autoApprove, true);
  assert.equal(v.via, "explicit-policy");
  assert.equal(v.recordTrustKey, null);
});

test("earned trust auto-approves a checkpoint only under autonomous mode", () => {
  const auto = decidePolicy({ category: "checkpoint", policy: OFF, autonomyLevel: "autonomous", ledger: TRUSTED });
  assert.equal(auto.autoApprove, true);
  assert.equal(auto.via, "earned-trust");
  assert.equal(auto.recordTrustKey, "checkpoint");

  // Same trusted ledger, but not autonomous → operator still decides.
  const standard = decidePolicy({ category: "checkpoint", policy: OFF, autonomyLevel: "standard", ledger: TRUSTED });
  assert.equal(standard.autoApprove, false);
  assert.equal(standard.via, "operator-required");
});

test("hard floor: content/external/tool/stuck never auto-approve, even with policy on + autonomous + trusted", () => {
  for (const category of ["content", "external", "tool", "stuck", "unknown"] as const) {
    const v = decidePolicy({
      category,
      policy: { enabled: true, allowCheckpoints: true, allowLowRiskTools: true },
      autonomyLevel: "autonomous",
      // A (nonsensical) trusted entry under the category key must not matter — the
      // floor lives in trustKey()/NEVER_AUTO_APPROVE, not in the ledger contents.
      ledger: { [category]: { approvals: 99, denials: 0 }, checkpoint: { approvals: 99, denials: 0 } },
    });
    assert.equal(v.autoApprove, false, `${category} must never auto-approve`);
    assert.equal(v.via, "operator-required");
    assert.equal(v.recordTrustKey, null);
  }
});

test("a prior denial revokes earned trust for the class", () => {
  const v = decidePolicy({
    category: "checkpoint",
    policy: OFF,
    autonomyLevel: "autonomous",
    ledger: { checkpoint: { approvals: 9, denials: 1 } },
  });
  assert.equal(v.autoApprove, false);
  assert.equal(v.via, "operator-required");
});

test("default: nothing grants it → operator required", () => {
  const v = decidePolicy({ category: "checkpoint", policy: OFF, autonomyLevel: "manual", ledger: {} });
  assert.equal(v.autoApprove, false);
  assert.equal(v.via, "operator-required");
  assert.ok(v.reason.length > 0);
});
