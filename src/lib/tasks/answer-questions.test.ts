import test from "node:test";
import assert from "node:assert/strict";

import { markQuestionsAnswered, hasUnansweredQuestion } from "./answer-questions";
import { deriveOutput } from "@/lib/orchestrator/derive-output";
import type { Turn } from "@/lib/orchestrator/turn-types";

const askTurn = (id: string, prompt: string) => ({
  id,
  kind: "ask_user_question",
  content: { type: "question", prompt },
  signals: [],
});

const assistantQuestion = (id: string, text: string) => ({
  id,
  kind: "assistant_message",
  content: { type: "text", text },
  signals: [{ kind: "contains_question", confidence: 0.8 }],
});

const assistantFinal = (id: string, text: string) => ({
  id,
  kind: "assistant_message",
  content: { type: "text", text },
  signals: [{ kind: "final_answer", confidence: 1 }],
});

test("markQuestionsAnswered: stamps ask_user_question turns and leaves others alone", () => {
  const turns = [askTurn("t1", "Does this scope look right?"), assistantFinal("t2", "Done.")];
  const out = markQuestionsAnswered(turns, "operator") as Array<Record<string, unknown>>;
  assert.equal((out[0].content as Record<string, unknown>).answeredBy, "operator");
  assert.equal((out[1].content as Record<string, unknown>).answeredBy, undefined);
});

test("markQuestionsAnswered: stamps assistant messages carrying a high-confidence question signal", () => {
  const out = markQuestionsAnswered([assistantQuestion("t1", "Want me to adjust the thresholds?")], "operator");
  assert.equal(((out[0] as Record<string, unknown>).content as Record<string, unknown>).answeredBy, "operator");
});

test("markQuestionsAnswered: ignores a low-confidence question signal (matches derive-output's 0.7 floor)", () => {
  const turns = [{
    id: "t1",
    kind: "assistant_message",
    content: { type: "text", text: "Maybe?" },
    signals: [{ kind: "contains_question", confidence: 0.5 }],
  }];
  const out = markQuestionsAnswered(turns, "operator");
  assert.equal(((out[0] as Record<string, unknown>).content as Record<string, unknown>).answeredBy, undefined);
});

test("markQuestionsAnswered: does not rewrite an already-answered turn", () => {
  const turns = [{
    id: "t1",
    kind: "ask_user_question",
    content: { type: "question", prompt: "Scope ok?", answeredBy: "operator" },
    signals: [],
  }];
  const out = markQuestionsAnswered(turns, "someone-else");
  assert.equal(((out[0] as Record<string, unknown>).content as Record<string, unknown>).answeredBy, "operator");
});

test("markQuestionsAnswered: does not mutate the input array or its turns", () => {
  const turns = [askTurn("t1", "Scope ok?")];
  markQuestionsAnswered(turns, "operator");
  assert.equal((turns[0].content as Record<string, unknown>).answeredBy, undefined, "input must be untouched");
});

test("markQuestionsAnswered: a malformed turn log never throws — the reply path must not break", () => {
  assert.deepEqual(markQuestionsAnswered(null, "operator"), []);
  assert.deepEqual(markQuestionsAnswered(undefined, "operator"), []);
  const junk = [null, 42, "nope", {}, { kind: "ask_user_question" }];
  assert.equal((markQuestionsAnswered(junk, "operator") as unknown[]).length, junk.length);
});

test("hasUnansweredQuestion: true only while a question is outstanding", () => {
  assert.equal(hasUnansweredQuestion([askTurn("t1", "Scope ok?")]), true);
  assert.equal(hasUnansweredQuestion(markQuestionsAnswered([askTurn("t1", "Scope ok?")], "operator")), false);
  assert.equal(hasUnansweredQuestion([assistantFinal("t1", "Done.")]), false);
  assert.equal(hasUnansweredQuestion(null), false);
});

// --------------------------------------------------------------------------
// The regression this exists for: a multi-round task must stop re-deriving
// needs_input from a question the operator already answered in an earlier round.
// --------------------------------------------------------------------------

test("regression: an answered round-1 question no longer makes deriveOutput await the operator", () => {
  const round1 = [askTurn("t1", "Does this scope look right?")];

  // Before the reply: genuinely awaiting the operator.
  const before = deriveOutput(round1 as unknown as Turn[]);
  assert.equal(before.awaiting?.kind, "user_response");
  assert.match(before.headline?.text ?? "", /Does this scope look right/);

  // Operator replies; the reply path stamps the outstanding question, then
  // round 2 appends its own work to the SAME accumulated log.
  const afterReply = markQuestionsAnswered(round1, "operator");
  const round2 = [...(afterReply as unknown[]), assistantFinal("t2", "All four tasks implemented and committed.")];

  const after = deriveOutput(round2 as unknown as Turn[]);
  assert.ok(!after.awaiting, "the answered question must not re-open the awaiting banner");
  assert.doesNotMatch(
    after.headline?.text ?? "",
    /Does this scope look right/,
    "round 1's question must not outrank round 2's completion message",
  );
});
