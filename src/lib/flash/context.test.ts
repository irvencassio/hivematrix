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

test("assembleSystemPrompt surfaces goals due today so chat/voice are goal-aware without a tool call", async () => {
  const { upsertGoal } = await import("@/lib/goals/store");
  upsertGoal({
    title: "Pass the annuities exam",
    category: "income",
    cadence: "daily",
    target: "70% on a practice exam",
    description: "Ohio combined Life + A&H license",
  });
  const prompt = await assembleSystemPrompt("what should I focus on", "", BRAIN);
  assert.match(prompt, /Goals due today/);
  assert.match(prompt, /Pass the annuities exam/);
  assert.match(prompt, /Ohio combined Life/, "the description gives the model next-step context");
  // Awareness only — it must not instruct the model to take action on its own.
  assert.match(prompt, /never nagging/);
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
  // PIM routing (live regression 2026-07-12: streaming voice "remind me to X in 5
  // minutes" escalated to a do-nothing task instead of calling reminder_create).
  // The doctrine must route reminders/calendar directly and forbid escalating them.
  assert.match(prompt, /reminder_create/);
  // Namespace-tolerant: the doctrine now spells tools the way the model is
  // actually offered them (mcp__flash__escalate_to_task). Assert the RULE —
  // reminders must never be escalated — not the spelling, so this test keeps
  // testing behaviour if the namespace ever changes again.
  assert.match(prompt, /NEVER (?:mcp__flash__)?escalate_to_task and NEVER queue a task for a reminder/);
  // Honest-failure clause.
  assert.match(prompt, /Never claim something worked unless a tool result shows it did/);
  // learn_skill must fire on TRIED-AND-FAILED tools too, not only "no tool fits"
  // (live regression 2026-07-12: Haiku tried desktop_action, hit a block, then
  // told the operator to count files in Finder by hand instead of learning).
  assert.match(prompt, /tool(s)? you tried failed/i);
  assert.match(prompt, /never tell the operator to do by hand/i);
  // brain_read step: goals/plans/notes questions must use brain_search -> brain_read
  // instead of answering off a snippet or claiming no file access (the confirmed gap).
  assert.match(prompt, /brain_search/);
  assert.match(prompt, /brain_read/);
  assert.match(prompt, /don't have file access/i);
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

// ---------------------------------------------------------------------------
// Per-request channel style selection (unified-session follow-on) —
// store.ts's getOrCreateSession now unifies console+voice into ONE session
// row for peer "operator" (they share summary/turns), but spoken-vs-text
// STYLE must still be chosen per REQUEST, not per session: assembleSystemPrompt
// takes `channel` as an explicit argument, never reads it off a session row,
// so the exact same prior conversation summary must still get the spoken
// style for a voice turn and plain style for a console turn.
// ---------------------------------------------------------------------------

test("assembleSystemPrompt: the SAME session summary still gets spoken style only for a voice-channel request", async () => {
  const sharedSummary = "The operator asked about e-bikes yesterday.";

  const voicePrompt = await assembleSystemPrompt("what's the weather", sharedSummary, null, "voice");
  const consolePrompt = await assembleSystemPrompt("what's the weather", sharedSummary, null, "console");

  assert.match(voicePrompt, /reply will be read by text-to-speech/);
  assert.doesNotMatch(consolePrompt, /reply will be read by text-to-speech/);
  // Both still carry the shared session summary — proving it's the SAME
  // unified thread, just rendered with a different per-request style.
  assert.match(voicePrompt, /The operator asked about e-bikes yesterday\./);
  assert.match(consolePrompt, /The operator asked about e-bikes yesterday\./);
});

test("assembleSystemPrompt: watch and glasses are also spoken channels; imessage/mail/android are not", async () => {
  const watchPrompt = await assembleSystemPrompt("hi", "", null, "watch");
  const glassesPrompt = await assembleSystemPrompt("hi", "", null, "glasses");
  const imessagePrompt = await assembleSystemPrompt("hi", "", null, "imessage");
  const mailPrompt = await assembleSystemPrompt("hi", "", null, "mail");
  const androidPrompt = await assembleSystemPrompt("hi", "", null, "android");

  assert.match(watchPrompt, /reply will be read by text-to-speech/);
  assert.match(glassesPrompt, /reply will be read by text-to-speech/);
  assert.doesNotMatch(imessagePrompt, /reply will be read by text-to-speech/);
  assert.doesNotMatch(mailPrompt, /reply will be read by text-to-speech/);
  assert.doesNotMatch(androidPrompt, /reply will be read by text-to-speech/);
});

test("assembleSystemPrompt: an always-on voice doctrine sets a warm, non-robotic tone on every surface", async () => {
  // Tone guidance must be present even with no brain root / no persona files —
  // that is exactly when a blank SOUL.md would otherwise leave a generic voice.
  for (const channel of ["console", "voice", "imessage", "mail"] as const) {
    const prompt = await assembleSystemPrompt("hi", "", null, channel);
    assert.match(prompt, /How to sound/, `${channel} must carry the voice doctrine`);
    assert.match(prompt, /not a generic chatbot/, `${channel} voice doctrine body`);
    assert.match(prompt, /Address the operator by name/);
    // It must explicitly defer to a defined persona so a rich SOUL.md wins.
    assert.match(prompt, /let it refine this voice/);
  }
});

test("assembleSystemPrompt: iMessage gets plain-text texting style, mail gets email style, console gets neither", async () => {
  const imessagePrompt = await assembleSystemPrompt("hi", "", null, "imessage");
  const mailPrompt = await assembleSystemPrompt("hi", "", null, "mail");
  const consolePrompt = await assembleSystemPrompt("hi", "", null, "console");

  // iMessage: short, plain-text, markdown explicitly banned (it leaks as literal
  // # / * / - characters into a text bubble).
  assert.match(imessagePrompt, /replying in a text message/i);
  assert.match(imessagePrompt, /literal #, \*, and - characters/);
  assert.doesNotMatch(imessagePrompt, /drafting an email/);

  // Mail: plain prose, no markdown, but distinct from the terse texting register.
  assert.match(mailPrompt, /drafting an email/);
  assert.doesNotMatch(mailPrompt, /replying in a text message/i);

  // Console renders markdown fine, so it gets no surface-format override.
  assert.doesNotMatch(consolePrompt, /replying in a text message/i);
  assert.doesNotMatch(consolePrompt, /drafting an email/);
});
