import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFlashFailure,
  computeContextTokens,
  contextFill,
  contextLevel,
  contextWindowFor,
  usableContextFor,
} from "./context-budget";

test("classifyFlashFailure: the API's real overflow phrasings", () => {
  assert.equal(classifyFlashFailure("prompt is too long: 205123 tokens > 200000 maximum", ""), "context-overflow");
  assert.equal(classifyFlashFailure("input length and `max_tokens` exceed context limit", ""), "context-overflow");
  assert.equal(classifyFlashFailure("context_length_exceeded", ""), "context-overflow");
  assert.equal(classifyFlashFailure("", "maximum context length is 200000 tokens"), "context-overflow");
});

test("classifyFlashFailure: a genuine stale resume still classifies", () => {
  assert.equal(classifyFlashFailure("No conversation found with session ID abc123", ""), "stale-resume");
  assert.equal(classifyFlashFailure("failed to resume", ""), "stale-resume");
});

// The regression this module exists to prevent: an overflow that happens to
// name the session it was resuming must NOT be read as staleness, because the
// stale path silently drops the cliSessionId and retries — a "recovery" that
// hides the real cause behind a wrong log line.
test("classifyFlashFailure: overflow wins when the message mentions both", () => {
  assert.equal(
    classifyFlashFailure("Error resuming session abc123: prompt is too long: 210000 tokens > 200000 maximum", ""),
    "context-overflow",
  );
  assert.equal(
    classifyFlashFailure("session abc123 failed", "input length and `max_tokens` exceed context limit"),
    "context-overflow",
  );
});

test("classifyFlashFailure: unrelated failures fall through", () => {
  assert.equal(classifyFlashFailure("ENOENT: spawn claude", ""), "other");
  assert.equal(classifyFlashFailure("", ""), "other");
});

// Regression: stream-parser.ts already computes
//   inputTok = baseInput + cacheCreate + cacheRead
// so adding the cache fields again double-counts every cached token. The
// earlier version of this test asserted the DOUBLED value (180_520) and so
// locked the bug in: a fresh session read ~50% full after one turn, and one
// real session recorded 203,648 tokens against a 200,000-token window — a
// figure that cannot describe real occupancy, since such a request would have
// been rejected outright.
test("computeContextTokens uses inputTokens, which already includes cache tokens", () => {
  // A resumed turn: 180k replayed from cache, 120 fresh — the parser reports
  // 180_520 as inputTokens, and that IS the occupancy.
  assert.equal(computeContextTokens({ inputTokens: 180_520 }), 180_520);
});

test("computeContextTokens ignores cache fields if a caller still passes them", () => {
  const usage = { inputTokens: 90_000, cacheReadTokens: 89_000, cacheCreationTokens: 900 } as { inputTokens: number };
  assert.equal(computeContextTokens(usage), 90_000);
});

test("computeContextTokens treats missing fields and null usage as zero", () => {
  assert.equal(computeContextTokens({ inputTokens: 50 }), 50);
  assert.equal(computeContextTokens(null), 0);
  assert.equal(computeContextTokens(undefined), 0);
});

// A reading can never legitimately exceed the raw window — if it does, the
// arithmetic is wrong rather than the session being impossibly large.
test("a plausible full-session reading stays within the raw window", () => {
  const tokens = computeContextTokens({ inputTokens: 195_000 });
  assert.ok(tokens <= contextWindowFor("claude-haiku-4-5"), "occupancy must fit the window");
});

test("context window resolves known models and falls back", () => {
  assert.equal(contextWindowFor("claude-haiku-4-5"), 200_000);
  assert.equal(contextWindowFor("claude-sonnet-5"), 200_000);
  assert.equal(contextWindowFor("some-unreleased-model"), 200_000);
  assert.equal(contextWindowFor(null), 200_000);
});

test("usable budget reserves reply headroom", () => {
  assert.equal(usableContextFor("claude-haiku-4-5"), 180_000);
  assert.ok(usableContextFor("claude-haiku-4-5") < contextWindowFor("claude-haiku-4-5"));
});

test("contextFill measures against the usable budget and clamps", () => {
  assert.equal(contextFill(90_000, "claude-haiku-4-5"), 0.5);
  assert.equal(contextFill(999_999, "claude-haiku-4-5"), 1);
  assert.equal(contextFill(-5, "claude-haiku-4-5"), 0);
});

test("contextLevel stays silent while there is room", () => {
  assert.equal(contextLevel(0.1), "ok");
  assert.equal(contextLevel(0.49), "ok");
  assert.equal(contextLevel(0.5), "notice");
  assert.equal(contextLevel(0.75), "warn");
  assert.equal(contextLevel(0.95), "critical");
});
