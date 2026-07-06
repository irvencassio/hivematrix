import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { shouldEscalate, escalationTaskDescription, ESCALATION_SOURCE } from "./escalation";

// Isolate the DB under a temp HOME before anything calls getDb().
const home = mkdtempSync(join(tmpdir(), "escal-"));
mkdirSync(join(home, ".hivematrix"), { recursive: true });
process.env.HOME = home;

test("shouldEscalate: only when cloud-ok, has a report, and source isn't an escalation", () => {
  assert.equal(shouldEscalate({ cloudOk: true, hasReport: true, sourceIsEscalation: false }), true);
  // No cloud → don't escalate (fix couldn't run now); task stays failed on the board.
  assert.equal(shouldEscalate({ cloudOk: false, hasReport: true, sourceIsEscalation: false }), false);
  // No diagnostics → nothing to hand the frontier.
  assert.equal(shouldEscalate({ cloudOk: true, hasReport: false, sourceIsEscalation: false }), false);
  // Never escalate an escalation (loop guard).
  assert.equal(shouldEscalate({ cloudOk: true, hasReport: true, sourceIsEscalation: true }), false);
});

test("escalationTaskDescription packages spec + diagnostics and demands a minimal diff", () => {
  const d = escalationTaskDescription("Build a snake game in Python.", "F821 Undefined name `os` at line 706");
  assert.match(d, /minimal\s+diff/i);
  assert.match(d, /do not rewrite from scratch/i);
  assert.match(d, /F821 Undefined name/);
  assert.match(d, /Build a snake game in Python\./);
  // Spec and diagnostics are both present, diagnostics before the original task.
  assert.ok(d.indexOf("F821") < d.indexOf("Original task:"));
});

test("ESCALATION_SOURCE is stable (used for dedup + loop-guard)", () => {
  assert.equal(ESCALATION_SOURCE, "escalation");
});
