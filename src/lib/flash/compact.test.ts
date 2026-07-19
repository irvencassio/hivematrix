import test from "node:test";
import assert from "node:assert/strict";
import { buildFallbackSummary, mergeSummaries } from "./compact";
import { trimMessagesForRetry } from "./loop";
import type { FlashMessage } from "./types";

test("buildFallbackSummary keeps who said what, one line each", () => {
  const out = buildFallbackSummary([
    { role: "user", content: "what is carolin cassio's phone number" },
    { role: "assistant", content: "No contact found.\nTry a variation?" },
  ]);
  assert.match(out, /summarizer unavailable/);
  assert.match(out, /- user: what is carolin cassio's phone number/);
  // Only the first non-empty line of a multi-line turn survives.
  assert.match(out, /- assistant: No contact found\./);
  assert.doesNotMatch(out, /Try a variation/);
});

test("buildFallbackSummary skips non-conversational roles", () => {
  const out = buildFallbackSummary([
    { role: "system", content: "you are a helpful assistant" },
    { role: "user", content: "hello" },
  ]);
  assert.doesNotMatch(out, /helpful assistant/);
  assert.match(out, /- user: hello/);
});

test("mergeSummaries appends newest last and drops from the front when capped", () => {
  assert.equal(mergeSummaries("", "first"), "first");
  assert.equal(mergeSummaries("older", "newer"), "older\nnewer");

  // Over the cap, the OLDEST content is what gets dropped — the most recent
  // context must always survive, otherwise compaction forgets the present.
  const huge = "x".repeat(2_500);
  const merged = mergeSummaries(huge, "THE-NEWEST-LINE");
  assert.ok(merged.length <= 2_000);
  assert.match(merged, /THE-NEWEST-LINE$/);
});

test("trimMessagesForRetry keeps all system messages and only the newest turns", () => {
  const messages: FlashMessage[] = [
    { role: "system", content: "sys-a" },
    { role: "system", content: "sys-b" },
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "a2" },
    { role: "user", content: "u3" },
  ];
  const out = trimMessagesForRetry(messages, 3);
  assert.deepEqual(
    out.map((m) => m.content),
    ["sys-a", "sys-b", "u2", "a2", "u3"],
  );
});

test("trimMessagesForRetry is a no-op when already short enough", () => {
  const messages: FlashMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "only" },
  ];
  assert.deepEqual(trimMessagesForRetry(messages, 6).map((m) => m.content), ["sys", "only"]);
});
