import test from "node:test";
import assert from "node:assert/strict";
import { deriveOutput } from "./derive-output";
import type { QuestionContent, Turn } from "./turn-types";

// `Turn["content"]` (TurnContent) is a discriminated union of 8 content
// shapes whose only common key is `type` — so `Partial<Turn["content"]>`
// collapses to just `{ type?: ... }`, not "partial fields of whichever
// variant". These fixtures are always the `question` variant, so the
// override type is pinned to `Partial<Omit<QuestionContent, "type">>`
// (and `content` is excluded from the `Partial<Turn>` base to avoid it
// being intersected back into the full-union type).
function questionTurn(
  overrides: Omit<Partial<Turn>, "content"> & { content: Partial<Omit<QuestionContent, "type">> }
): Turn {
  return {
    id: overrides.id ?? "t1",
    taskId: "task1",
    sequence: 0,
    role: "assistant",
    kind: "ask_user_question",
    label: "question",
    startedAt: new Date().toISOString(),
    signals: [],
    signalsVersion: 1,
    ...overrides,
    content: { type: "question", prompt: "Which do you want?", ...overrides.content },
  } as Turn;
}

test("deriveOutput copies multi-choice options onto the headline, not just the prompt text", () => {
  const turns = [questionTurn({ content: { options: ["Implement", "Defer", "Skip"] } })];
  const view = deriveOutput(turns);
  assert.equal(view.headline?.text, "Which do you want?");
  assert.deepEqual(view.headline?.options, ["Implement", "Defer", "Skip"]);
});

test("deriveOutput leaves headline.options undefined for a plain (no-option) question", () => {
  const turns = [questionTurn({ content: {} })];
  const view = deriveOutput(turns);
  assert.equal(view.headline?.text, "Which do you want?");
  assert.equal(view.headline?.options, undefined);
});

test("deriveOutput does not surface options from an already-answered question", () => {
  const turns = [questionTurn({ content: { options: ["Implement", "Defer"], answeredBy: "operator" } })];
  const view = deriveOutput(turns);
  assert.equal(view.awaiting, null);
});
