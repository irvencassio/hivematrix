import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage, ChatOpts } from "./chat-client";
import {
  REFLECT_THRESHOLD,
  STABLE_THRESHOLD,
  answerSimilarity,
  buildReflectionPrompt,
  buildSynthesisPrompt,
  deepThink,
  meanAgreement,
  stripThinkBlocks,
} from "./deep-think";

test("stripThinkBlocks removes DeepSeek thinking traces", () => {
  assert.equal(stripThinkBlocks("<think>long chain\nof thought</think>The answer is 42."), "The answer is 42.");
  assert.equal(stripThinkBlocks("no thinking here"), "no thinking here");
});

test("answerSimilarity: identical ≈ 1, disjoint = 0, ignores think blocks", () => {
  assert.equal(answerSimilarity("Ship the annuity license by August", "ship the annuity license by august"), 1);
  assert.equal(answerSimilarity("completely different words entirely", "unrelated response text altogether"), 0);
  assert.ok(answerSimilarity("<think>x</think>alpha beta gamma delta", "alpha beta gamma delta") === 1);
});

test("meanAgreement: single candidate = 1; mixed candidates average pairwise", () => {
  assert.equal(meanAgreement(["only one"]), 1);
  const high = meanAgreement([
    "increase prices this quarter for the annuity product",
    "increase prices this quarter for the annuity product line",
  ]);
  assert.ok(high > STABLE_THRESHOLD, `expected stable, got ${high}`);
  const low = meanAgreement([
    "increase prices dramatically next quarter",
    "decrease spending and delay everything",
    "hire another engineer instead",
  ]);
  assert.ok(low < REFLECT_THRESHOLD, `expected disagreement, got ${low}`);
});

test("prompt builders embed the question and candidates/draft", () => {
  const synth = buildSynthesisPrompt("What price?", ["$10 because X", "$12 because Y"]);
  assert.match(synth, /Candidate 1[\s\S]*\$10/);
  assert.match(synth, /Candidate 2[\s\S]*\$12/);
  assert.match(synth, /list-wise/);
  const refl = buildReflectionPrompt("What price?", "$10");
  assert.match(refl, /DISAGREED/);
  assert.match(refl, /skeptical reviewer/);
});

function fakeComplete(fn: (messages: ChatMessage[], opts?: ChatOpts) => string) {
  const calls: Array<{ messages: ChatMessage[]; opts?: ChatOpts }> = [];
  const complete = async (messages: ChatMessage[], opts?: ChatOpts) => {
    calls.push({ messages, opts });
    return fn(messages, opts);
  };
  return { complete, calls };
}

test("deepThink: agreeing candidates → synthesis, high confidence, NO reflection", async () => {
  const { complete, calls } = fakeComplete((messages) => {
    const text = messages[messages.length - 1].content;
    if (text.includes("list-wise")) return "Synthesized: raise the price to $12.";
    return "raise the price to twelve dollars for the annuity product";
  });
  const result = await deepThink("What should we charge?", { samples: 3, complete });
  assert.equal(result.candidates, 3);
  assert.ok(result.agreement >= STABLE_THRESHOLD);
  assert.equal(result.confidence, "high");
  assert.equal(result.reflected, false);
  assert.match(result.answer, /Synthesized/);
  // 3 rollouts + 1 synthesis, no reflection call
  assert.equal(calls.length, 4);
  // Rollouts are temperature-diverse with thinking on; synthesis is temp 0.
  const temps = calls.slice(0, 3).map((c) => c.opts?.temperature);
  assert.deepEqual(temps, [0.3, 0.7, 1.0]);
  assert.ok(calls.slice(0, 3).every((c) => c.opts?.reasoningEffort === "high"));
  assert.equal(calls[3].opts?.temperature, 0);
});

test("deepThink: disagreeing candidates → reflection pass, low confidence", async () => {
  let rollout = 0;
  const divergent = [
    "raise prices aggressively across every product",
    "cut spending entirely and pause hiring now",
    "pivot the roadmap toward enterprise contracts",
  ];
  const { complete, calls } = fakeComplete((messages) => {
    const text = messages[messages.length - 1].content;
    if (text.includes("list-wise")) return "Draft synthesis.";
    if (text.includes("DISAGREED")) return "Reflected final answer.";
    return divergent[rollout++ % divergent.length];
  });
  const result = await deepThink("Strategy?", { samples: 3, complete });
  assert.ok(result.agreement < REFLECT_THRESHOLD);
  assert.equal(result.reflected, true);
  assert.equal(result.confidence, "low");
  assert.equal(result.answer, "Reflected final answer.");
  assert.equal(calls.length, 5); // 3 rollouts + synthesis + reflection
});

test("deepThink: partial rollout failure still succeeds; single survivor = low confidence, no synthesis", async () => {
  let n = 0;
  const complete = async (messages: ChatMessage[]) => {
    const text = messages[messages.length - 1].content;
    if (!text.includes("list-wise") && !text.includes("DISAGREED")) {
      if (n++ > 0) throw new Error("model busy");
      return "the only survivor answer";
    }
    throw new Error("should not synthesize a single candidate");
  };
  const result = await deepThink("Q?", { samples: 3, complete });
  assert.equal(result.candidates, 1);
  assert.equal(result.confidence, "low");
  assert.equal(result.answer, "the only survivor answer");
});

test("deepThink: total failure rejects with a useful message", async () => {
  const complete = async () => { throw new Error("connection refused"); };
  await assert.rejects(() => deepThink("Q?", { samples: 2, complete }), /all rollouts failed.*connection refused/);
});

test("deepThink: system context is prepended to every call", async () => {
  const { complete, calls } = fakeComplete(() => "same stable answer tokens here");
  await deepThink("Q?", { samples: 2, complete, systemContext: "You are Vale." });
  assert.ok(calls.every((c) => c.messages[0].role === "system" && c.messages[0].content === "You are Vale."));
});

test("deepThink: synthesis failure falls back to the first candidate", async () => {
  const { complete } = fakeComplete((messages) => {
    const text = messages[messages.length - 1].content;
    if (text.includes("list-wise")) throw new Error("timeout");
    return "stable agreeing answer tokens always";
  });
  const result = await deepThink("Q?", { samples: 2, complete });
  assert.equal(result.answer, "stable agreeing answer tokens always");
  assert.equal(result.confidence, "high");
});
