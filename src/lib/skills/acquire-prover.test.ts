/**
 * P2.5 — Integration prover for live capability acquisition.
 *
 * Unlike acquire.test.ts (which injects a `fanout` STUB and never touches the
 * real filesystem outside the brain root), THIS suite exercises the REAL
 * `fanOutSkills`/`harnessTargets` (no `fanout` option is passed to
 * `acquireSkill`) and the REAL on-disk ledger across sequential `acquireSkill`
 * calls. Only `mint` (fake, deterministic) and `critic` (a real-shape stub
 * that always passes) are injected — no live `claude` CLI call is made.
 *
 * Setup mirrors acquire.test.ts/store.test.ts exactly: a temp HOME with
 * `<home>/.hivematrix/config.json` pointing `memory.brainRootDir` at a temp
 * brain dir. Because `fanout.ts`'s `harnessTargets()` defaults to `homedir()`,
 * the SAME temp-HOME redirect that seeds the brain root also redirects the
 * fanout output (`<home>/.claude/skills`, `<home>/.agents/skills`,
 * `<home>/.qwen/skills`) into the temp tree — one setup covers both.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-acquire-prover-"));
const HOME = join(TMP, "home");
const BRAIN = join(TMP, "brain");
mkdirSync(join(HOME, ".hivematrix"), { recursive: true });
writeFileSync(join(HOME, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: BRAIN } }));
const origHome = process.env.HOME;
process.env.HOME = HOME;

const { acquireSkill } = await import("./acquire");
const { readSkill } = await import("./store");
const { renderSkillFile, skillSlug } = await import("./contracts");
const { harnessTargets } = await import("./fanout");
import type { Skill } from "./contracts";
import type { MintFn, CriticFn } from "./acquire";

test.after(() => {
  process.env.HOME = origHome;
  rmSync(TMP, { recursive: true, force: true });
});

function baseSkill(over: Partial<Skill> = {}): Skill {
  return {
    name: "Test Skill", description: "does a thing", tags: [], body: "do the thing",
    source: "acquired", createdAt: "", updatedAt: "", revisions: 1, useCount: 0, failures: 0,
    lastUsedAt: "", compat: ["all"], trusted: true, probation: false, kind: "instruction",
    interpreter: "bash", roles: [], ...over,
  };
}

function passingCritic(): CriticFn {
  return async () => ({ pass: true, reason: "an independent reviewer approved it" });
}

// NOTE on ordering/shared state: node:test runs tests within one file
// sequentially in declaration order (no concurrency is opted into here), and
// this suite deliberately shares ONE temp HOME/brain root across all three
// tests so a real on-disk ledger accumulates across them. The third test
// ("already-have") depends on the SECOND test's real "Deploy Runbook
// Explainer" registration already being on disk and in the ledger under the
// EXACT goal string `INSTRUCTION_GOAL` — do not reorder these tests, and do
// not run this file with test concurrency enabled.
const SCRIPT_GOAL = "count files in Downloads";
const INSTRUCTION_GOAL = "explain the deploy runbook";

test("script skill: full ladder passes -> probation, source acquired, NOT fanned out", async () => {
  const skill = baseSkill({
    name: "Downloads File Counter",
    description: "counts files in the Downloads folder",
    kind: "script",
    interpreter: "bash",
    body: 'echo "downloads: 3"',
  });
  const mint: MintFn = async () => ({
    file: renderSkillFile(skill),
    evals: [{ name: "basic", expectContains: "downloads" }],
  });

  const result = await acquireSkill({
    goal: SCRIPT_GOAL,
    whyNeeded: "user asked",
    mint,
    critic: passingCritic(),
    dailyCap: 1000,
  });

  assert.equal(result.outcome, "probation");
  assert.equal(result.skillName, "Downloads File Counter");

  const onDisk = await readSkill("Downloads File Counter");
  assert.ok(onDisk, "skill must be registered on disk");
  assert.equal(onDisk?.source, "acquired");
  assert.equal(onDisk?.trusted, false);
  assert.equal(onDisk?.probation, true);
  assert.equal(onDisk?.kind, "script");

  // Probationary scripts are NEVER fanned out. fanOutSkills writes each
  // trusted skill to `<targetDir>/<slug>/SKILL.md` — assert that directory is
  // absent from every real harness target for this skill's slug.
  const slug = skillSlug("Downloads File Counter");
  for (const target of harnessTargets(process.env.HOME)) {
    assert.ok(
      !existsSync(join(target.dir, slug)),
      `fanout target "${target.id}" (${target.dir}) must NOT contain a "${slug}" dir for a probationary script`,
    );
  }
});

test("instruction skill: registered trusted AND fanned out (real SKILL.md on disk)", async () => {
  const skill = baseSkill({
    name: "Deploy Runbook Explainer",
    description: "explains the deploy runbook steps",
    kind: "instruction",
    body: "1. Bump the version.\n2. Build and sign.\n3. Notarize.\n4. Publish the update feed.",
  });
  const mint: MintFn = async () => ({ file: renderSkillFile(skill), evals: [] });

  const result = await acquireSkill({
    goal: INSTRUCTION_GOAL,
    whyNeeded: "user asked for the runbook",
    mint,
    critic: passingCritic(),
    dailyCap: 1000,
  });

  assert.equal(result.outcome, "registered");
  assert.equal(result.skillName, "Deploy Runbook Explainer");

  const onDisk = await readSkill("Deploy Runbook Explainer");
  assert.ok(onDisk, "skill must be registered on disk");
  assert.equal(onDisk?.trusted, true);
  assert.equal(onDisk?.source, "acquired");

  // REAL fanout proof — no `fanout` option was passed to acquireSkill above,
  // so this exercises the real `fanOutSkills`/`harnessTargets`. Find the
  // claude target's real SKILL.md written to the temp-HOME-redirected dir.
  const slug = skillSlug("Deploy Runbook Explainer");
  const claudeTarget = harnessTargets(process.env.HOME).find((t) => t.id === "claude");
  assert.ok(claudeTarget, "harnessTargets must include a claude target");
  const skillMdPath = join(claudeTarget!.dir, slug, "SKILL.md");
  assert.ok(existsSync(skillMdPath), `expected a real fanned-out SKILL.md at ${skillMdPath}`);

  const contents = readFileSync(skillMdPath, "utf-8");
  assert.match(contents, new RegExp(`name:\\s*${slug}`), "fanned-out SKILL.md frontmatter name must match the slug");
  assert.match(contents, /Bump the version/, "fanned-out SKILL.md body must carry the real instructions");
});

test("second acquireSkill for the same goal short-circuits (already-have)", async () => {
  let mintCalled = false;
  const throwingMint: MintFn = async () => {
    mintCalled = true;
    throw new Error("mint should not run");
  };

  const result = await acquireSkill({
    goal: INSTRUCTION_GOAL, // same goal as the previous test's real registration
    whyNeeded: "asking again",
    mint: throwingMint,
    dailyCap: 1000,
  });

  assert.equal(result.outcome, "already-have");
  assert.equal(result.skillName, "Deploy Runbook Explainer");
  assert.equal(mintCalled, false, "the throwing mint must never be invoked — the ledger short-circuit must fire first");
});
