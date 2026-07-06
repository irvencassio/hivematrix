import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveThinkingMode,
  claudeEffortMode,
  codexReasoningEffort,
} from "./budget-policy";

test("resolveThinkingMode preserves the 'off' tier", () => {
  assert.equal(resolveThinkingMode("off"), "off");
  // Unknown / auto still fall back to the default (max).
  assert.equal(resolveThinkingMode("auto"), "max");
  assert.equal(resolveThinkingMode("nonsense"), "max");
});

test("CLI harnesses degrade 'off' to their lightest tier (they cannot disable thinking)", () => {
  assert.equal(claudeEffortMode("off"), "low");
  assert.equal(codexReasoningEffort("off"), "low");
});
