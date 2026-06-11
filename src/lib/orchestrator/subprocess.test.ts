import test from "node:test";
import assert from "node:assert/strict";

import { buildClaudeSpawnArgs } from "./subprocess";

test("Claude spawn args omit max-budget flag when budget is uncapped", () => {
  const args = buildClaudeSpawnArgs({
    prompt: "Do the task",
    tools: ["Read", "Bash"],
    maxBudgetUsd: 0,
    thinkingMode: "auto",
  });

  assert.equal(args.includes("--max-budget-usd"), false);
  assert.equal(args.includes("0"), false);
  const effortIndex = args.indexOf("--effort");
  assert.notEqual(effortIndex, -1);
  assert.equal(args[effortIndex + 1], "max");
});

test("Claude spawn args preserve positive explicit budget ceilings", () => {
  const args = buildClaudeSpawnArgs({
    prompt: "Do the task",
    tools: ["Read"],
    maxBudgetUsd: 7.5,
    thinkingMode: "high",
  });

  const budgetIndex = args.indexOf("--max-budget-usd");
  assert.notEqual(budgetIndex, -1);
  assert.equal(args[budgetIndex + 1], "7.5");
  const effortIndex = args.indexOf("--effort");
  assert.notEqual(effortIndex, -1);
  assert.equal(args[effortIndex + 1], "high");
});

test("Claude spawn args add a session fast-mode override when enabled", () => {
  const args = buildClaudeSpawnArgs({
    prompt: "Do the task",
    tools: ["Read"],
    fastMode: true,
  });

  const settingsIndex = args.indexOf("--settings");
  assert.notEqual(settingsIndex, -1);
  assert.equal(args[settingsIndex + 1], '{"fastMode":true}');
});

test("Claude spawn args omit fast-mode override when disabled", () => {
  const args = buildClaudeSpawnArgs({
    prompt: "Do the task",
    tools: ["Read"],
    fastMode: false,
  });

  assert.equal(args.includes("--settings"), false);
});
