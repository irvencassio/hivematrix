import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { chooseEscalationRung, alternateLocalModel, escalationTaskDescription, ESCALATION_SOURCE } from "./escalation";

// Isolate the DB under a temp HOME before anything calls getDb().
const home = mkdtempSync(join(tmpdir(), "escal-"));
mkdirSync(join(home, ".hivematrix"), { recursive: true });
process.env.HOME = home;

test("alternateLocalModel: hop the fast tier to the coding tier, nothing else", () => {
  // Fast tier (or the configured local) → the 27b coding specialist.
  assert.equal(alternateLocalModel("qwen3.6-35b-4bit"), "qwen3.6-27b-4bit");
  // Already the coding tier → no better local option.
  assert.equal(alternateLocalModel("qwen3.6-27b-4bit"), null);
  // A frontier/unknown model isn't a local tier → nothing to hop to.
  assert.equal(alternateLocalModel("mixed"), null);
  assert.equal(alternateLocalModel(null), null);
});

test("chooseEscalationRung: local hop first (once), then frontier, then stop", () => {
  // First failure on the fast tier → local hop (works even offline).
  assert.deepEqual(
    chooseEscalationRung({ priorHop: null, currentModel: "qwen3.6-35b-4bit", cloudOk: false }),
    { model: "qwen3.6-27b-4bit", hop: "local", titlePrefix: "Local fix" },
  );
  // The local hop failed → frontier, but only if the cloud is reachable.
  assert.deepEqual(
    chooseEscalationRung({ priorHop: "local", currentModel: "qwen3.6-27b-4bit", cloudOk: true }),
    { model: "mixed", hop: "frontier", titlePrefix: "Frontier fix" },
  );
  // Local hop failed but offline → ladder exhausted (task stays failed).
  assert.equal(chooseEscalationRung({ priorHop: "local", currentModel: "qwen3.6-27b-4bit", cloudOk: false }), null);
  // A coding-tier first failure skips the (nonexistent) local hop → frontier.
  assert.deepEqual(
    chooseEscalationRung({ priorHop: null, currentModel: "qwen3.6-27b-4bit", cloudOk: true }),
    { model: "mixed", hop: "frontier", titlePrefix: "Frontier fix" },
  );
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
