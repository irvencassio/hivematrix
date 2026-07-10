import test from "node:test";
import assert from "node:assert/strict";

import { buildChildrenResultsBlock, extractChildResultText, type ChildResultInput } from "./children-results";

function child(over: Partial<ChildResultInput> = {}): ChildResultInput {
  return {
    taskId: over.taskId ?? "task-1",
    agentType: over.agentType ?? "qa",
    title: over.title ?? "Verify checkout flow",
    status: over.status ?? "archived",
    resultText: "resultText" in over ? over.resultText! : "All checks passed.",
  };
}

test("buildChildrenResultsBlock: renders a header and one section per child, tagged by role and status", () => {
  const block = buildChildrenResultsBlock([
    child({ agentType: "qa", title: "Verify checkout flow", status: "archived", resultText: "All checks passed." }),
    child({ agentType: "designer", title: "Landing page mock", status: "failed", resultText: "Could not access Figma." }),
  ]);
  assert.match(block, /^## Results from delegated subtasks/);
  assert.match(block, /### \[qa\] Verify checkout flow — archived\nAll checks passed\./);
  assert.match(block, /### \[designer\] Landing page mock — failed\nCould not access Figma\./);
});

test("buildChildrenResultsBlock: a child with no captured output says so honestly, never fabricates content", () => {
  const block = buildChildrenResultsBlock([child({ resultText: null })]);
  assert.match(block, /\(no output captured\)/);
});

test("buildChildrenResultsBlock: caps each child at 2000 chars and names the task id to look further", () => {
  const long = "x".repeat(3000);
  const block = buildChildrenResultsBlock([child({ taskId: "task-abc", resultText: long })]);
  assert.equal(block.match(/x/g)?.length, 2000);
  assert.match(block, /truncated — see task task-abc for the full output/);
});

test("buildChildrenResultsBlock: caps at 10 children and names the omitted task ids", () => {
  const children = Array.from({ length: 13 }, (_, i) => child({ taskId: `task-${i}`, title: `Sub ${i}` }));
  const block = buildChildrenResultsBlock(children);
  assert.equal((block.match(/^### /gm) ?? []).length, 10);
  assert.match(block, /3 additional subtask\(s\) omitted/);
  assert.match(block, /task-10/);
  assert.match(block, /task-11/);
  assert.match(block, /task-12/);
});

test("buildChildrenResultsBlock: no omission note when 10 or fewer children", () => {
  const block = buildChildrenResultsBlock([child()]);
  assert.doesNotMatch(block, /omitted/);
});

test("extractChildResultText: prefers output.summary", () => {
  assert.equal(extractChildResultText({ output: { summary: "Done." } }), "Done.");
});

test("extractChildResultText: falls back to turns headline when output has no text fields", () => {
  const turns = [{ id: "t1", kind: "assistant_message", content: { type: "text", text: "Finished the migration." } }];
  const text = extractChildResultText({ output: {}, turns });
  assert.ok(text === null || typeof text === "string");
});

test("extractChildResultText: falls back to trailing log text when turns are empty", () => {
  const logs = [
    { type: "text", content: "Step 1 done." },
    { type: "text", content: "Step 2 done." },
  ];
  assert.equal(extractChildResultText({ output: {}, turns: [], logs }), "Step 1 done.Step 2 done.");
});

test("extractChildResultText: nothing captured anywhere ⇒ null, never fabricated", () => {
  assert.equal(extractChildResultText({}), null);
  assert.equal(extractChildResultText({ output: {}, turns: [], logs: [] }), null);
});
