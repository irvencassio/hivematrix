import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Point the brain root at a temp dir via a temp HOME + config.json, same pattern as store.test.ts.
const TMP = mkdtempSync(join(tmpdir(), "hm-acquire-"));
const HOME = join(TMP, "home");
const BRAIN = join(TMP, "brain");
mkdirSync(join(HOME, ".hivematrix"), { recursive: true });
writeFileSync(join(HOME, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: BRAIN } }));
const origHome = process.env.HOME;
process.env.HOME = HOME;

const { acquireSkill, defaultMint, defaultCritic, recentlyAcquiredSkillNames } = await import("./acquire");
const { readSkill } = await import("./store");
const { renderSkillFile, parseSkillFile } = await import("./contracts");
const { _setExecFileForTests } = await import("@/lib/models/chat-client");
import type { Skill } from "./contracts";
import type { AuditEntry } from "@/lib/audit/audit";
import type { MintFn, CriticFn, MintContext } from "./acquire";

test.after(() => {
  process.env.HOME = origHome;
  rmSync(TMP, { recursive: true, force: true });
});

function ledgerPath(): string {
  return join(BRAIN, "skills", "ACQUISITIONS.md");
}

function ledgerLines(): string[] {
  try {
    return readFileSync(ledgerPath(), "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function draftFiles(): string[] {
  const dir = join(BRAIN, "skills", "drafts");
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function baseSkill(over: Partial<Skill> = {}): Skill {
  return {
    name: "Test Skill", description: "does a thing", tags: [], body: "do the thing",
    source: "acquired", createdAt: "", updatedAt: "", revisions: 1, useCount: 0, failures: 0,
    lastUsedAt: "", compat: ["all"], trusted: true, probation: false, kind: "instruction",
    interpreter: "bash", roles: [], ...over,
  };
}

function passingCritic(): CriticFn {
  return async () => ({ pass: true, reason: "looks good" });
}

let counter = 0;
function uniqueGoal(label: string): string {
  counter += 1;
  return `${label} ${counter}`;
}

test("happy path (instruction): registers trusted, fans out, ledger + audit recorded", async () => {
  const goal = uniqueGoal("count files in downloads");
  const skill = baseSkill({ name: "Downloads Counter", description: "counts files in Downloads", kind: "instruction" });
  const mintCalls: string[] = [];
  const mint: MintFn = async (ctx) => {
    mintCalls.push(ctx.goal);
    return { file: renderSkillFile(skill), evals: [] };
  };
  const fanoutCalls: Skill[][] = [];
  const auditEvents: AuditEntry[] = [];

  const result = await acquireSkill({
    goal, whyNeeded: "voice turn needs it",
    mint, critic: passingCritic(),
    audit: (e) => auditEvents.push(e),
    fanout: async (skills) => { fanoutCalls.push(skills); return []; },
  });

  assert.equal(result.outcome, "registered");
  assert.equal(result.skillName, "Downloads Counter");
  assert.equal(mintCalls.length, 1);

  const onDisk = await readSkill("Downloads Counter");
  assert.ok(onDisk);
  assert.equal(onDisk?.trusted, true);
  assert.equal(onDisk?.source, "acquired");
  assert.equal(onDisk?.probation, false);

  assert.equal(fanoutCalls.length, 1);
  assert.equal(fanoutCalls[0][0].name, "Downloads Counter");

  const lines = ledgerLines();
  assert.ok(lines.some((l) => l.includes("outcome=registered") && l.includes("name=Downloads Counter")));

  const events = auditEvents.map((e) => e.event);
  assert.ok(events.includes("skill:acquire:start"));
  assert.ok(events.includes("skill:acquire:minted"));
  assert.ok(events.includes("skill:acquire:verified"));
  assert.ok(events.includes("skill:acquire:registered"));
  assert.ok(!events.includes("skill:acquire:failed"));
});

test("happy path (script): registers on PROBATION, NOT fanned out, eval runs for real via sandbox", async () => {
  const goal = uniqueGoal("echo ok script");
  const skill = baseSkill({ name: "Echo Ok Script", description: "echoes ok", kind: "script", interpreter: "bash", body: "echo ok" });
  const mint: MintFn = async () => ({
    file: renderSkillFile(skill),
    evals: [{ name: "basic", expectContains: "ok" }],
  });
  const fanoutCalls: Skill[][] = [];

  const result = await acquireSkill({
    goal, whyNeeded: "need a script",
    mint, critic: passingCritic(),
    fanout: async (skills) => { fanoutCalls.push(skills); return []; },
  });

  assert.equal(result.outcome, "probation");
  assert.equal(result.skillName, "Echo Ok Script");
  assert.match(result.reason, /probation/i);

  const onDisk = await readSkill("Echo Ok Script");
  assert.equal(onDisk?.trusted, false);
  assert.equal(onDisk?.probation, true);
  assert.equal(onDisk?.source, "acquired");

  assert.equal(fanoutCalls.length, 0, "probationary scripts are never fanned out");

  const lines = ledgerLines();
  assert.ok(lines.some((l) => l.includes("outcome=probation") && l.includes("name=Echo Ok Script")));
});

test("parse failure: garbage mint output archives a draft, files a proposal, never registers", async () => {
  const goal = uniqueGoal("garbage mint output");
  const mint: MintFn = async () => ({ file: "this is not a skill file at all, no frontmatter", evals: [] });

  const before = draftFiles().length;
  const result = await acquireSkill({ goal, whyNeeded: "x", mint, critic: passingCritic() });

  assert.equal(result.outcome, "draft-failed");
  assert.equal(result.stage, "parse");
  assert.match(result.reason, /didn't parse/);

  const after = draftFiles();
  assert.equal(after.length, before + 1);

  const lines = ledgerLines();
  assert.ok(lines.some((l) => l.includes("outcome=draft-failed")));
});

test("scan block: a skill body that trips a fatal scan rule is archived, never registered", async () => {
  const goal = uniqueGoal("destructive script");
  const skill = baseSkill({ name: "Nuke Everything", kind: "script", interpreter: "bash", body: "rm -rf /" });
  const mint: MintFn = async () => ({ file: renderSkillFile(skill), evals: [] });

  const before = draftFiles().length;
  const result = await acquireSkill({ goal, whyNeeded: "x", mint, critic: passingCritic() });

  assert.equal(result.outcome, "draft-failed");
  assert.equal(result.stage, "scan");
  assert.match(result.reason, /blocked for safety/);

  assert.equal(draftFiles().length, before + 1);
  assert.equal(await readSkill("Nuke Everything"), null, "never registered");
});

test("eval failure: expectContains doesn't match stdout → draft-failed at evals stage", async () => {
  const goal = uniqueGoal("mismatched eval");
  const skill = baseSkill({ name: "Wrong Output Script", kind: "script", interpreter: "bash", body: "echo something-else" });
  const mint: MintFn = async () => ({
    file: renderSkillFile(skill),
    evals: [{ name: "basic", expectContains: "ok" }],
  });

  const result = await acquireSkill({ goal, whyNeeded: "x", mint, critic: passingCritic() });

  assert.equal(result.outcome, "draft-failed");
  assert.equal(result.stage, "evals");
  assert.equal(await readSkill("Wrong Output Script"), null, "never registered");
});

test("critic failure: valid skill + passing evals, but critic rejects → draft-failed at critic stage", async () => {
  const goal = uniqueGoal("critic rejects");
  const skill = baseSkill({ name: "Critic Rejected Skill", kind: "instruction" });
  const mint: MintFn = async () => ({ file: renderSkillFile(skill), evals: [] });
  const critic: CriticFn = async () => ({ pass: false, reason: "doesn't actually solve the goal" });

  const result = await acquireSkill({ goal, whyNeeded: "x", mint, critic });

  assert.equal(result.outcome, "draft-failed");
  assert.equal(result.stage, "critic");
  assert.match(result.reason, /doesn't actually solve the goal/);
  assert.equal(await readSkill("Critic Rejected Skill"), null, "never registered");
});

test("already-have: a second identical goal reuses the registered skill without minting", async () => {
  const goal = uniqueGoal("recurring goal");
  const skill = baseSkill({ name: "Recurring Skill", description: "handles the recurring goal", kind: "instruction" });
  let mintCallCount = 0;
  const mint: MintFn = async () => { mintCallCount += 1; return { file: renderSkillFile(skill), evals: [] }; };

  const first = await acquireSkill({ goal, whyNeeded: "x", mint, critic: passingCritic() });
  assert.equal(first.outcome, "registered");
  assert.equal(mintCallCount, 1);

  const second = await acquireSkill({ goal, whyNeeded: "x", mint, critic: passingCritic() });
  assert.equal(second.outcome, "already-have");
  assert.equal(second.skillName, "Recurring Skill");
  assert.equal(mintCallCount, 1, "mint must not be called again once we already have the skill");
});

test("mint throws: treated as a mint failure, no draft archived, ledger + proposal filed", async () => {
  const goal = uniqueGoal("mint throws");
  const mint: MintFn = async () => { throw new Error("mint blew up"); };
  const beforeDrafts = draftFiles().length;

  const result = await acquireSkill({ goal, whyNeeded: "x", mint, critic: passingCritic() });

  assert.equal(result.outcome, "draft-failed");
  assert.equal(result.stage, "mint");
  assert.equal(draftFiles().length, beforeDrafts, "mint failure produces no draft to archive");

  const lines = ledgerLines();
  assert.ok(lines.some((l) => l.includes("outcome=mint-failed")));
});

// ---------------------------------------------------------------------------
// defaultMint (P2.2) — the real Sonnet mint via `haikuChatComplete`, tested
// against a fake `claude` binary through the `_setExecFileForTests` DI seam
// (same convention as chat-client.test.ts; loop.test.ts's fake-spawn is the
// streaming-process equivalent, not needed here since this is one-shot).
// ---------------------------------------------------------------------------

test.afterEach(() => { _setExecFileForTests(null); });

function baseMintCtx(over: Partial<MintContext> = {}): MintContext {
  return { goal: "count widgets", whyNeeded: "a user asked for a widget count", attempt: 1, ...over };
}

function twoBlockResponse(skillFile: string, evalsJson: string): string {
  return `\`\`\`skill\n${skillFile}\n\`\`\`\n\`\`\`evals\n${evalsJson}\n\`\`\`\n`;
}

test("defaultMint: parses a well-formed two-block response into {file, evals}", async () => {
  const skillFile = renderSkillFile(baseSkill({ name: "Widget Counter", description: "counts widgets", kind: "instruction" }));
  const evalsJson = JSON.stringify([{ name: "basic", input: "abc", expectContains: "3" }]);
  _setExecFileForTests((async () => ({ stdout: twoBlockResponse(skillFile, evalsJson), stderr: "" })) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  const minted = await defaultMint(baseMintCtx());

  const parsed = parseSkillFile(minted.file);
  assert.ok(parsed, "minted.file must round-trip through parseSkillFile");
  assert.equal(parsed?.name, "Widget Counter");
  assert.equal(parsed?.kind, "instruction");
  assert.equal(minted.evals.length, 1);
  assert.equal(minted.evals[0].name, "basic");
  assert.equal(minted.evals[0].expectContains, "3");
});

test("defaultMint: a response missing the ```skill block throws", async () => {
  _setExecFileForTests((async () => ({ stdout: "```evals\n[]\n```\n", stderr: "" })) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  await assert.rejects(() => defaultMint(baseMintCtx()));
});

test("defaultMint: an absent evals block yields evals: [] (no throw)", async () => {
  const skillFile = renderSkillFile(baseSkill({ name: "No Evals Skill", kind: "instruction" }));
  _setExecFileForTests((async () => ({ stdout: `\`\`\`skill\n${skillFile}\n\`\`\`\n`, stderr: "" })) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  const minted = await defaultMint(baseMintCtx());
  assert.deepEqual(minted.evals, []);
});

test("defaultMint: a blank evals block yields evals: [] (no throw)", async () => {
  const skillFile = renderSkillFile(baseSkill({ name: "Blank Evals Skill", kind: "instruction" }));
  _setExecFileForTests((async () => ({ stdout: twoBlockResponse(skillFile, "   "), stderr: "" })) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  const minted = await defaultMint(baseMintCtx());
  assert.deepEqual(minted.evals, []);
});

test("defaultMint integration: acquireSkill with NO mint (default wired in) + fake claude + stub critic → registered", async () => {
  const goal = uniqueGoal("integration default mint goal");
  const skillFile = renderSkillFile(baseSkill({ name: "Integration Mint Skill", description: "handles the integration goal", kind: "instruction" }));
  _setExecFileForTests((async () => ({ stdout: twoBlockResponse(skillFile, "[]"), stderr: "" })) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  const result = await acquireSkill({ goal, whyNeeded: "integration test", critic: passingCritic() });

  assert.equal(result.outcome, "registered");
  assert.equal(result.skillName, "Integration Mint Skill");
  const onDisk = await readSkill("Integration Mint Skill");
  assert.ok(onDisk);
});

test("defaultMint reflexion: on retry, the prompt sent to the model includes the prior failure reason", async () => {
  const skillFile = renderSkillFile(baseSkill({ name: "Retry Skill", kind: "instruction" }));
  let capturedPrompt = "";
  _setExecFileForTests((async (_file: string, args: string[]) => {
    capturedPrompt = args.join("\n");
    return { stdout: twoBlockResponse(skillFile, "[]"), stderr: "" };
  }) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  await defaultMint(baseMintCtx({
    attempt: 2,
    priorDraft: "--- (some earlier draft frontmatter) ---",
    priorFailure: "it didn't pass its own tests: THE SPECIFIC PRIOR FAILURE TEXT",
  }));

  assert.match(capturedPrompt, /THE SPECIFIC PRIOR FAILURE TEXT/);
});

// ---------------------------------------------------------------------------
// defaultCritic (P2.3) — the real Haiku critic via `haikuChatComplete`, tested
// against a fake `claude` binary through the same `_setExecFileForTests` DI
// seam used above for defaultMint.
// ---------------------------------------------------------------------------

test("defaultCritic: a PASS verdict with a reason line parses to {pass:true, reason}", async () => {
  _setExecFileForTests((async () => ({ stdout: "PASS\nThe skill correctly counts files.", stderr: "" })) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  const verdict = await defaultCritic({ goal: "count files", skillFile: "---\nname: x\n---\nbody", evalTranscripts: "" });

  assert.equal(verdict.pass, true);
  assert.equal(verdict.reason, "The skill correctly counts files.");
});

test("defaultCritic: a FAIL verdict with a reason line parses to {pass:false, reason}", async () => {
  _setExecFileForTests((async () => ({ stdout: "FAIL\nIt never reads $SKILL_INPUT.", stderr: "" })) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  const verdict = await defaultCritic({ goal: "count files", skillFile: "---\nname: x\n---\nbody", evalTranscripts: "" });

  assert.equal(verdict.pass, false);
  assert.equal(verdict.reason, "It never reads $SKILL_INPUT.");
});

test("defaultCritic: ambiguous/unparseable output fails closed", async () => {
  _setExecFileForTests((async () => ({ stdout: "I'm not entirely sure about this one.", stderr: "" })) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  const verdict = await defaultCritic({ goal: "count files", skillFile: "---\nname: x\n---\nbody", evalTranscripts: "" });

  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /unclear/i);
});

test("defaultCritic: sends model=haiku in the CLI args", async () => {
  let capturedArgs: string[] = [];
  _setExecFileForTests((async (_file: string, args: string[]) => {
    capturedArgs = args;
    return { stdout: "PASS\nfine", stderr: "" };
  }) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  await defaultCritic({ goal: "count files", skillFile: "---\nname: x\n---\nbody", evalTranscripts: "some transcript" });

  const modelIdx = capturedArgs.indexOf("--model");
  assert.ok(modelIdx >= 0);
  assert.equal(capturedArgs[modelIdx + 1], "haiku");
});

test("integration: acquireSkill with NEITHER mint NOR critic supplied (both defaults wired) → registered", async () => {
  const goal = uniqueGoal("integration both defaults goal");
  const skillFile = renderSkillFile(baseSkill({ name: "Both Defaults Skill", description: "handles it", kind: "instruction" }));
  _setExecFileForTests((async (_file: string, args: string[]) => {
    if (args.includes("sonnet")) {
      return { stdout: twoBlockResponse(skillFile, "[]"), stderr: "" };
    }
    if (args.includes("haiku")) {
      return { stdout: "PASS\nThe skill genuinely and safely accomplishes the goal.", stderr: "" };
    }
    throw new Error(`unexpected model in args: ${args.join(" ")}`);
  }) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  const result = await acquireSkill({ goal, whyNeeded: "integration test, zero injected functions", dailyCap: 1000 });

  assert.equal(result.outcome, "registered");
  assert.equal(result.skillName, "Both Defaults Skill");
  const onDisk = await readSkill("Both Defaults Skill");
  assert.ok(onDisk);
});

test("integration: acquireSkill with NEITHER mint NOR critic, critic FAILs → draft-failed at critic stage, not registered", async () => {
  const goal = uniqueGoal("integration both defaults critic-fail goal");
  const skillFile = renderSkillFile(baseSkill({ name: "Both Defaults Rejected Skill", description: "handles it", kind: "instruction" }));
  _setExecFileForTests((async (_file: string, args: string[]) => {
    if (args.includes("sonnet")) {
      return { stdout: twoBlockResponse(skillFile, "[]"), stderr: "" };
    }
    if (args.includes("haiku")) {
      return { stdout: "FAIL\nIt does not actually solve the stated goal.", stderr: "" };
    }
    throw new Error(`unexpected model in args: ${args.join(" ")}`);
  }) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  const before = draftFiles().length;
  const result = await acquireSkill({ goal, whyNeeded: "integration test, zero injected functions", dailyCap: 1000 });

  assert.equal(result.outcome, "draft-failed");
  assert.equal(result.stage, "critic");
  assert.match(result.reason, /does not actually solve the stated goal/);
  assert.equal(draftFiles().length, before + 1);
  assert.equal(await readSkill("Both Defaults Rejected Skill"), null, "never registered");
});

test("recentlyAcquiredSkillNames: only recent registered/probation names within the window, not old ones or failures", async () => {
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const nowIso = now.toISOString();
  const oldIso = threeDaysAgo.toISOString();
  const realLedger = ledgerPath();
  const existing = existsSync(realLedger) ? readFileSync(realLedger, "utf-8") : "";
  const seedLines = [
    `${nowIso}\toutcome=registered\tname=Fresh Skill\tgoal=fresh goal\n`,
    `${oldIso}\toutcome=registered\tname=Old Skill\tgoal=old goal\n`,
    `${nowIso}\toutcome=draft-failed\tname=\tgoal=failed goal\n`,
  ].join("");
  mkdirSync(join(BRAIN, "skills"), { recursive: true });
  writeFileSync(realLedger, existing + seedLines);

  const names = await recentlyAcquiredSkillNames();

  assert.ok(names.includes("Fresh Skill"), "recent registered skill must be included");
  assert.ok(!names.includes("Old Skill"), "a 3-day-old skill must be outside the 24h window");
  assert.ok(!names.includes(""), "a draft-failed line (no name / wrong outcome) must never contribute");
});

// Run last: this test drives the shared ledger's today-count up to (or past) an
// artificially low cap, so it must not run before tests that rely on the
// default cap (10) still having headroom.
test("daily cap: pre-seeded ledger at/over cap refuses without minting", async () => {
  const today = new Date().toISOString();
  const capLines = Array.from({ length: 3 }, (_, i) => `${today}\toutcome=draft-failed\tname=\tgoal=filler ${i}\n`).join("");
  const realLedger = ledgerPath();
  const existing = existsSync(realLedger) ? readFileSync(realLedger, "utf-8") : "";
  mkdirSync(join(BRAIN, "skills"), { recursive: true });
  writeFileSync(realLedger, existing + capLines);
  const countBefore = ledgerLines().filter((l) => l.startsWith(today.slice(0, 10))).length;

  let mintCalled = false;
  const mint: MintFn = async () => { mintCalled = true; return { file: "", evals: [] }; };

  const result = await acquireSkill({
    goal: uniqueGoal("anything"), whyNeeded: "x", mint, critic: passingCritic(),
    dailyCap: countBefore,
  });

  assert.equal(result.outcome, "capped");
  assert.equal(mintCalled, false, "mint must not be called once the daily cap is hit");
  assert.match(result.reason, /daily learning limit/);
});
