import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Point the brain root at a temp dir via a temp HOME + config.json (same
// pattern as skills/store.test.ts) so listSkills() — which always resolves
// its root through configuredBrainRootDir() — sees our seeded skill library.
const TMP = mkdtempSync(join(tmpdir(), "hm-flash-context-"));
const HOME = join(TMP, "home");
const BRAIN = join(TMP, "brain");
mkdirSync(join(HOME, ".hivematrix"), { recursive: true });
writeFileSync(join(HOME, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: BRAIN } }));
const origHome = process.env.HOME;
process.env.HOME = HOME;

const { assembleSystemPrompt } = await import("./context");
const { upsertSkill } = await import("@/lib/skills/store");

test.after(() => {
  process.env.HOME = origHome;
  rmSync(TMP, { recursive: true, force: true });
});

test("assembleSystemPrompt injects the skill index with params and skill_run guidance", async () => {
  await upsertSkill({
    name: "Triage Inbox",
    description: "Sort incoming email by urgency",
    body: "1. Read the {{sender}} field\n2. Classify by {{priority}}\n3. Draft a reply",
    source: "manual",
    kind: "instruction",
  });
  await upsertSkill({
    name: "Ping Health Check",
    description: "Run the service health check script",
    body: "#!/bin/bash\ncurl -sf http://localhost:3747/health",
    source: "manual",
    kind: "script",
  });

  const prompt = await assembleSystemPrompt("hi", "", BRAIN);

  assert.match(prompt, /Skill Library/);
  assert.match(prompt, /Triage Inbox/);
  assert.match(prompt, /Ping Health Check/);
  // Per-skill params must be surfaced so Haiku can fill {{placeholders}}.
  assert.match(prompt, /sender/);
  assert.match(prompt, /priority/);
  // skill_run guidance paragraph.
  assert.match(prompt, /skill_run/);
});

test("assembleSystemPrompt always includes the capability-doctrine escalation ladder, even with no brain root", async () => {
  const prompt = await assembleSystemPrompt("hi", "", null);

  // The ladder, in order: answer -> tool -> skill_run -> learn_skill -> escalate_to_task -> self-improvement.
  assert.match(prompt, /never dead-end/);
  assert.match(prompt, /skill_run/);
  assert.match(prompt, /learn_skill/);
  assert.match(prompt, /can't do that/);
  assert.match(prompt, /escalate_to_task/);
  assert.match(prompt, /self-improvement/);
  // Honest-failure clause.
  assert.match(prompt, /Never claim something worked unless a tool result shows it did/);
  // learn_skill must fire on TRIED-AND-FAILED tools too, not only "no tool fits"
  // (live regression 2026-07-12: Haiku tried desktop_action, hit a block, then
  // told the operator to count files in Finder by hand instead of learning).
  assert.match(prompt, /tool(s)? you tried failed/i);
  assert.match(prompt, /never tell the operator to do by hand/i);
  // PERMISSION_NEEDED results are the exception: speak the fix, don't re-learn.
  assert.match(prompt, /PERMISSION_NEEDED/);
  // Anti-fabrication clause (pairs with loop.ts's guardFabricatedToolCalls).
  assert.match(prompt, /NEVER write tool-call syntax/);
  // Cheapest-sufficient-tool rule (live regression 2026-07-12: Haiku reached
  // for Finder + screenshots to count files instead of learning a script).
  assert.match(prompt, /desktop_action .*last resort/i);
  assert.match(prompt, /counting files|computed by a script/i);
  // Never end a reply mid-plan.
  assert.match(prompt, /never end your reply mid-plan/i);
});

test("assembleSystemPrompt omits the skill-library section when the library is empty", async () => {
  const emptyTmp = mkdtempSync(join(tmpdir(), "hm-flash-context-empty-"));
  const emptyHome = join(emptyTmp, "home");
  const emptyBrain = join(emptyTmp, "brain");
  mkdirSync(join(emptyHome, ".hivematrix"), { recursive: true });
  writeFileSync(join(emptyHome, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: emptyBrain } }));
  const prevHome = process.env.HOME;
  process.env.HOME = emptyHome;
  try {
    const prompt = await assembleSystemPrompt("hi", "", emptyBrain);
    assert.doesNotMatch(prompt, /Skill Library/);
  } finally {
    process.env.HOME = prevHome;
    rmSync(emptyTmp, { recursive: true, force: true });
  }
});
