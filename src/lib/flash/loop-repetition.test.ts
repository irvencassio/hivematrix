import assert from "node:assert/strict";
import test from "node:test";

import { isRepeatingTail, collapseRepetition, REPEAT_LIMIT } from "./loop";

const S = "Let me check the latest financial news and market data for yesterday.";

test("isRepeatingTail: flags a sentence repeated REPEAT_LIMIT+ times at the tail", () => {
  assert.equal(isRepeatingTail(Array(REPEAT_LIMIT).fill(S).join(" ")), true);
  assert.equal(isRepeatingTail(Array(REPEAT_LIMIT + 6).fill(S).join(" ")), true);
  // Below the limit → not yet a loop.
  assert.equal(isRepeatingTail(Array(REPEAT_LIMIT - 1).fill(S).join(" ")), false);
});

test("isRepeatingTail: does not flag varied text or short interjections", () => {
  assert.equal(isRepeatingTail("First point. Second point. Third point. Fourth point."), false);
  // Short repeated units (e.g. "ok.") are ignored — only substantive lines count.
  assert.equal(isRepeatingTail("ok. ok. ok. ok. ok. ok."), false);
  // A repeated line NOT at the tail (recovered afterward) is fine.
  assert.equal(isRepeatingTail(`${S} ${S} ${S} ${S} Actually, here is the recap for you.`), false);
});

test("collapseRepetition: keeps exactly one copy of a degenerate tail", () => {
  const collapsed = collapseRepetition(Array(10).fill(S).join(" "));
  assert.equal(collapsed, S);
  // Preserves the lead-in, collapses only the repeated tail.
  const withLead = collapseRepetition(`Sure — one moment. ${Array(8).fill(S).join(" ")}`);
  assert.equal(withLead, `Sure — one moment. ${S}`);
  // Non-degenerate text is returned unchanged.
  const varied = "One. Two. Three.";
  assert.equal(collapseRepetition(varied), varied);
});
