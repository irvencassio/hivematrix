import test from "node:test";
import assert from "node:assert/strict";

import {
  PARENT_CONTEXT_NO_VAGUE_QUESTIONS,
  extractParentExamples,
  buildParentContextPack,
  buildChildTaskPrompt,
  type ParentContextSource,
  type SiblingSummary,
} from "./parent-context";

const PARENT_DESC =
  "For the Usage information in the right panel, for the 7-day window you need to " +
  "display green/yellow/red based on the % to the number of days in. If we are on " +
  "day 1 of the 7-day and usage is at 15% of the weekly, show red (14.3% is the " +
  "per-day budget). If we are on day 7 and usage is 82%, show green (less than the " +
  "6-day max of 85.7%).";

const parent: ParentContextSource = {
  title: "Usage panel traffic-light thresholds",
  description: PARENT_DESC,
  intake: null,
};

const siblings: SiblingSummary[] = [
  { title: "Compute daily threshold", status: "done", done: true, summary: "abc1234" },
  { title: "Color the 7-day bar", status: "running", done: false },
  { title: "Color the 5-hour bar", status: "draft", done: false },
];

test("extractParentExamples pulls the concrete numbers/percentages out of the parent", () => {
  const ex = extractParentExamples(PARENT_DESC);
  const joined = ex.join(" | ");
  assert.match(joined, /14\.3%/);
  assert.match(joined, /85\.7%/);
  assert.match(joined, /7-day/);
});

test("extractParentExamples returns [] for prose with no anchors", () => {
  assert.deepEqual(extractParentExamples("Please make the dashboard look nicer overall."), []);
});

test("buildParentContextPack includes the full parent description and title", () => {
  const pack = buildParentContextPack(parent, { title: "Color the 7-day bar", prompt: "color it" }, siblings);
  assert.ok(pack.includes(PARENT_DESC), "full parent description is embedded");
  assert.ok(pack.includes("Usage panel traffic-light thresholds"), "parent title present");
});

test("buildParentContextPack lists siblings with done + this-item markers", () => {
  const pack = buildParentContextPack(parent, { title: "Color the 7-day bar", prompt: "color it" }, siblings);
  assert.match(pack, /\[done\][^\n]*Compute daily threshold/);
  assert.match(pack, /→ this item[^\n]*Color the 7-day bar/);
});

test("buildParentContextPack carries the extracted examples", () => {
  const pack = buildParentContextPack(parent, { title: "x", prompt: "y" }, siblings);
  assert.match(pack, /14\.3%/);
  assert.match(pack, /85\.7%/);
});

test("buildParentContextPack instructs the worker not to ask vague operator questions", () => {
  const pack = buildParentContextPack(parent, { title: "x", prompt: "y" }, siblings);
  assert.ok(pack.includes(PARENT_CONTEXT_NO_VAGUE_QUESTIONS));
  assert.match(
    PARENT_CONTEXT_NO_VAGUE_QUESTIONS,
    /Do not ask the operator for clarification if the parent context gives a reasonable default\. Use the parent context and proceed\./,
  );
});

test("buildParentContextPack explains the structured parent-decision fallback", () => {
  const pack = buildParentContextPack(parent, { title: "x", prompt: "y" }, siblings);
  assert.match(pack, /needs_parent_decision/);
  assert.match(pack, /NEEDS_PARENT_DECISION/);
});

test("buildChildTaskPrompt ends with the item's own prompt under a task header", () => {
  const full = buildChildTaskPrompt(parent, { title: "Color the 7-day bar", prompt: "Apply the color rules to the 7-day bar." }, siblings);
  assert.ok(full.includes(PARENT_DESC), "parent context retained");
  assert.match(full, /=== Your task ===[\s\S]*Apply the color rules to the 7-day bar\.\s*$/);
});

test("buildChildTaskPrompt folds goalFlight success criteria into the examples", () => {
  const goalParent: ParentContextSource = {
    title: "Build usage dashboard",
    description: "Build a usage dashboard.",
    intake: { goalFlight: { goal: "usage dashboard", successCriteria: ["traffic-light per lane", "weekly + 5-hour windows"] } },
  };
  const full = buildChildTaskPrompt(goalParent, { title: "x", prompt: "y" }, []);
  assert.match(full, /traffic-light per lane/);
  assert.match(full, /weekly \+ 5-hour windows/);
});
