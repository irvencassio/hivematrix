import test from "node:test";
import assert from "node:assert/strict";
import { governContext, estimateTokens, ContextBudgetExceededError } from "./context-governor";

function msg(role: string, content: string) {
  return { role, content };
}

test("estimateTokens: chars/3.5, rounded up", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abc"), 1); // 3/3.5 -> ceil -> 1
  assert.equal(estimateTokens("a".repeat(35)), 10);
});

test("governContext: under budget leaves messages untouched", () => {
  const messages = [msg("system", "sys"), msg("user", "hello")];
  const result = governContext(messages, { contextLimit: 10_000, maxOutputTokens: 1_000 });
  assert.equal(result.compacted, false);
  assert.equal(result.droppedCount, 0);
  assert.equal(messages.length, 2);
});

test("governContext: drops oldest non-system turns first until it fits", () => {
  const big = "x".repeat(3500); // ~1000 tokens each
  const messages = [
    msg("system", "sys"),
    msg("user", big),   // oldest droppable
    msg("assistant", big),
    msg("user", big),
    msg("assistant", big), // most recent — must survive
  ];
  // Budget: system (~1) + one big turn (~1004) fits; two or more doesn't.
  const result = governContext(messages, { contextLimit: 1200, maxOutputTokens: 0 });
  assert.equal(result.compacted, true);
  assert.ok(result.droppedCount >= 1);
  assert.equal(messages[0].role, "system"); // system always kept
  assert.equal(messages.at(-1), messages.at(-1)); // last turn still present
  assert.deepEqual(messages.at(-1), msg("assistant", big));
});

test("governContext: never drops a system message even under extreme pressure", () => {
  const big = "x".repeat(3500);
  const messages = [msg("system", "sys"), msg("user", big), msg("user", "small")];
  try {
    governContext(messages, { contextLimit: 5, maxOutputTokens: 0 });
  } catch {
    // expected to throw given how small the budget is — the assertion below
    // still holds on the (mutated in place) messages array either way.
  }
  assert.ok(messages.some((m) => m.role === "system"));
});

test("governContext: throws ContextBudgetExceededError when the last turn alone can't fit", () => {
  const huge = "x".repeat(700_000); // ~200k tokens
  const messages = [msg("system", "sys"), msg("user", huge)];
  assert.throws(
    () => governContext(messages, { contextLimit: 8192, maxOutputTokens: 1024 }),
    ContextBudgetExceededError,
  );
});

test("governContext: a misconfigured budget (contextLimit <= maxOutputTokens) throws rather than looping forever", () => {
  const messages = [msg("system", "sys"), msg("user", "hello")];
  assert.throws(
    () => governContext(messages, { contextLimit: 100, maxOutputTokens: 100 }),
    ContextBudgetExceededError,
  );
});

test("governContext: reports accurate before/after token estimates", () => {
  const big = "x".repeat(3500);
  const messages = [msg("system", "sys"), msg("user", big), msg("user", "small")];
  const result = governContext(messages, { contextLimit: 200, maxOutputTokens: 0 });
  assert.ok(result.estimatedTokensBefore > result.estimatedTokensAfter);
  assert.ok(result.estimatedTokensAfter <= 200);
});
