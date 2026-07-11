import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { chooseEscalationRung, escalationTaskDescription, ESCALATION_SOURCE } from "./escalation";

// Isolate the DB under a temp HOME before anything calls getDb().
const home = mkdtempSync(join(tmpdir(), "escal-"));
mkdirSync(join(home, ".hivematrix"), { recursive: true });
process.env.HOME = home;

test("chooseEscalationRung: one frontier rung, only if cloud-ok and not already tried", () => {
  // First failure, cloud reachable → frontier fix.
  assert.deepEqual(
    chooseEscalationRung({ priorHop: null, currentModel: "sonnet", cloudOk: true }),
    { model: "mixed", hop: "frontier", titlePrefix: "Frontier fix" },
  );
  // Offline → ladder exhausted (task stays failed).
  assert.equal(chooseEscalationRung({ priorHop: null, currentModel: "sonnet", cloudOk: false }), null);
  // A frontier rung already tried → stop (never loop).
  assert.equal(chooseEscalationRung({ priorHop: "frontier", currentModel: "mixed", cloudOk: true }), null);
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
