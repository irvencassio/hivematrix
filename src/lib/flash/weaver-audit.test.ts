import test from "node:test";
import assert from "node:assert/strict";

import {
  hasWeaverSignal,
  buildWeaverCommitmentsText,
  buildWeaverActivityText,
  buildWeaverPrompt,
  clampWeaverLines,
  composeWeaverAudit,
  WEAVER_BRAIN_QUERY,
  type WeaverAuditDeps,
  type WeaverBrainHit,
  type WeaverCompletedTask,
} from "./weaver-audit";

const NOW = new Date("2026-07-10T17:00:00");

function fakeDeps(over: Partial<WeaverAuditDeps> = {}): WeaverAuditDeps {
  return {
    readGoalsPersona: () => null,
    searchBrainDocs: async () => [],
    listCompletedTasks: async () => [],
    chatComplete: async () => "",
    now: () => NOW,
    ...over,
  };
}

const hit = (path: string, snippet: string): WeaverBrainHit => ({ path, snippet });
const done = (title: string): WeaverCompletedTask => ({ title });

// ---------------------------------------------------------------------------
// Pure decision + text-building pieces
// ---------------------------------------------------------------------------

test("hasWeaverSignal: false only when goals, brain hits, and activity are all empty", () => {
  assert.equal(hasWeaverSignal(null, [], []), false);
  assert.equal(hasWeaverSignal("Ship the release", [], []), true);
  assert.equal(hasWeaverSignal(null, [hit("a.md", "x")], []), true);
  assert.equal(hasWeaverSignal(null, [], [done("Shipped X")]), true);
});

test("buildWeaverCommitmentsText: empty vs goals-only vs hits-only vs both", () => {
  assert.equal(buildWeaverCommitmentsText(null, []), "(no stated commitments found)");
  assert.match(buildWeaverCommitmentsText("Ship by August", []), /GOALS\.md:\nShip by August/);
  assert.match(buildWeaverCommitmentsText(null, [hit("plan.md", "launch by Friday")]), /plan\.md: launch by Friday/);
  const both = buildWeaverCommitmentsText("Ship by August", [hit("plan.md", "launch by Friday")]);
  assert.match(both, /GOALS\.md/);
  assert.match(both, /plan\.md/);
});

test("buildWeaverActivityText: empty vs listed titles", () => {
  assert.equal(buildWeaverActivityText([]), "(nothing completed in the last 7 days)");
  assert.equal(buildWeaverActivityText([done("Shipped the release"), done("Fixed the bug")]), "- Shipped the release\n- Fixed the bug");
});

test("buildWeaverPrompt: names the Weaver persona and caps the reply at 4 lines with one uncomfortable question", () => {
  const { system, user } = buildWeaverPrompt("GOALS.md:\nShip by August", "- Shipped the release");
  assert.match(system, /Weaver 🌀/);
  assert.match(system, /AT MOST 4/);
  assert.match(system, /ONE direct uncomfortable question/);
  assert.match(user, /Ship by August/);
  assert.match(user, /Shipped the release/);
});

test("clampWeaverLines: drops blank lines and truncates to the max", () => {
  assert.equal(clampWeaverLines("a\n\nb\nc\nd\ne", 4), "a\nb\nc\nd");
  assert.equal(clampWeaverLines("only one line"), "only one line");
  assert.equal(clampWeaverLines(""), "");
});

// ---------------------------------------------------------------------------
// composeWeaverAudit — the one non-pure entry point
// ---------------------------------------------------------------------------

test("composeWeaverAudit: no signal at all -> null, no model call", async () => {
  let chatCalled = false;
  const result = await composeWeaverAudit(fakeDeps({
    chatComplete: async () => { chatCalled = true; return "some audit text"; },
  }));
  assert.equal(result, null);
  assert.equal(chatCalled, false);
});

test("composeWeaverAudit: signal present -> queries brain_search with the spec's query and returns the clamped model reply", async () => {
  let seenQuery = "";
  const result = await composeWeaverAudit(fakeDeps({
    readGoalsPersona: () => "Ship by August",
    searchBrainDocs: async (q) => { seenQuery = q; return [hit("plan.md", "launch by Friday")]; },
    listCompletedTasks: async () => [done("Shipped the release")],
    chatComplete: async () => "<think>x</think>What moved: shipped the release.\nSlipping: the August deadline.\nWhy haven't you touched the launch plan in a week?",
  }));
  assert.equal(seenQuery, WEAVER_BRAIN_QUERY);
  assert.match(result ?? "", /shipped the release/);
  assert.match(result ?? "", /Why haven't you touched/);
});

test("composeWeaverAudit: model failure sends NOTHING — no deterministic fallback", async () => {
  const result = await composeWeaverAudit(fakeDeps({
    readGoalsPersona: () => "Ship by August",
    chatComplete: async () => { throw new Error("model down"); },
  }));
  assert.equal(result, null);
});

test("composeWeaverAudit: empty model reply also sends nothing", async () => {
  const result = await composeWeaverAudit(fakeDeps({
    listCompletedTasks: async () => [done("Shipped the release")],
    chatComplete: async () => "<think>nothing to say</think>",
  }));
  assert.equal(result, null);
});

test("composeWeaverAudit: a failing brain_search/task-list fetch degrades gracefully rather than throwing", async () => {
  const result = await composeWeaverAudit(fakeDeps({
    readGoalsPersona: () => "Ship by August",
    searchBrainDocs: async () => { throw new Error("brain root unavailable"); },
    listCompletedTasks: async () => { throw new Error("db down"); },
    chatComplete: async () => "What moved: nothing much.\nSlipping: the plan.\nWhen will you actually start?",
  }));
  assert.match(result ?? "", /When will you actually start/);
});
