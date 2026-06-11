import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_BUDGET_USD,
  DEFAULT_THINKING_MODE,
  codexReasoningEffort,
  hasBudgetCeiling,
  normalizeBudgetUsd,
  resolveThinkingMode,
} from "./budget-policy";

test("budget policy treats missing, zero, and negative budgets as uncapped", () => {
  assert.equal(DEFAULT_BUDGET_USD, 0);
  assert.equal(normalizeBudgetUsd(undefined), 0);
  assert.equal(normalizeBudgetUsd(null), 0);
  assert.equal(normalizeBudgetUsd(0), 0);
  assert.equal(normalizeBudgetUsd(-3), 0);
  assert.equal(hasBudgetCeiling(0), false);
  assert.equal(hasBudgetCeiling(undefined), false);
});

test("budget policy preserves positive explicit budgets", () => {
  assert.equal(normalizeBudgetUsd(12.5), 12.5);
  assert.equal(hasBudgetCeiling(12.5), true);
});

test("thinking policy defaults auto and missing values to max", () => {
  assert.equal(DEFAULT_THINKING_MODE, "max");
  assert.equal(resolveThinkingMode(undefined), "max");
  assert.equal(resolveThinkingMode(null), "max");
  assert.equal(resolveThinkingMode(""), "max");
  assert.equal(resolveThinkingMode("auto"), "max");
});

test("thinking policy maps unsupported Codex max to highest documented Codex effort", () => {
  assert.equal(codexReasoningEffort("max"), "xhigh");
  assert.equal(codexReasoningEffort("auto"), "xhigh");
  assert.equal(codexReasoningEffort("ultrathink"), "xhigh");
  assert.equal(codexReasoningEffort("medium"), "medium");
});
