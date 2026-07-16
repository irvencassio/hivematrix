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
// Distinct from the sentinel above: this is the per-task default ceiling
// (the unattended-runaway backstop), wired into Task.create() in db/index.ts.
// An explicit 0 (or missing value) still normalizes to "uncapped" via the
// sentinel constant tested below — the two constants serve different roles.
import { DEFAULT_BUDGET_USD as DEFAULT_TASK_BUDGET_CEILING_USD } from "@/lib/config/constants";

test("budget policy treats missing, zero, and negative budgets as uncapped", () => {
  assert.equal(DEFAULT_BUDGET_USD, 0);
  assert.equal(normalizeBudgetUsd(undefined), 0);
  assert.equal(normalizeBudgetUsd(null), 0);
  assert.equal(normalizeBudgetUsd(0), 0);
  assert.equal(normalizeBudgetUsd(-3), 0);
  assert.equal(hasBudgetCeiling(0), false);
  assert.equal(hasBudgetCeiling(undefined), false);
});

test("the per-task default budget ceiling is $25 (unattended-runaway backstop), while 0 stays the explicit uncapped opt-out", () => {
  // Raised from $10 on 2026-07-16: the $10 ceiling killed three near-complete
  // tasks at $10.35–$10.68. Still a real ceiling — just one that clears the
  // largest observed genuine task.
  assert.equal(DEFAULT_TASK_BUDGET_CEILING_USD, 25);
  assert.equal(hasBudgetCeiling(DEFAULT_TASK_BUDGET_CEILING_USD), true);
  assert.equal(normalizeBudgetUsd(DEFAULT_TASK_BUDGET_CEILING_USD), 25);
  // 0 is still explicitly uncapped, independent of the new default.
  assert.equal(hasBudgetCeiling(0), false);
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
