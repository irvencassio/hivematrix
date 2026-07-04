import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveThinkingMode,
  claudeEffortMode,
  codexReasoningEffort,
  dwarfstarReasoningEffort,
  dwarfstarThinkingFields,
  autoTurnThinkingMode,
} from "./budget-policy";

test("resolveThinkingMode preserves the 'off' tier", () => {
  assert.equal(resolveThinkingMode("off"), "off");
  // Unknown / auto still fall back to the default (max).
  assert.equal(resolveThinkingMode("auto"), "max");
  assert.equal(resolveThinkingMode("nonsense"), "max");
});

test("dwarfstarReasoningEffort maps 'off' distinctly from the thinking tiers", () => {
  assert.equal(dwarfstarReasoningEffort("off"), "off");
  assert.equal(dwarfstarReasoningEffort("low"), "low");
  assert.equal(dwarfstarReasoningEffort("xhigh"), "high");
  assert.equal(dwarfstarReasoningEffort(undefined), "max");
});

test("dwarfstarThinkingFields sends reasoning_effort for tiers and the off-switch for 'off'", () => {
  assert.deepEqual(dwarfstarThinkingFields("low"), { reasoning_effort: "low" });
  assert.deepEqual(dwarfstarThinkingFields("max"), { reasoning_effort: "max" });

  const off = dwarfstarThinkingFields("off");
  assert.deepEqual(off, { thinking: { type: "disabled" }, think: false });
  // Never carries a reasoning_effort alongside the off-switch.
  assert.equal("reasoning_effort" in off, false);
});

test("CLI harnesses degrade 'off' to their lightest tier (they cannot disable thinking)", () => {
  assert.equal(claudeEffortMode("off"), "low");
  assert.equal(codexReasoningEffort("off"), "low");
});

test("autoTurnThinkingMode skips thinking on mechanical tool-continuation turns for default tasks", () => {
  // Unset/default task: think on the planning/synthesis boundary, off in the middle.
  assert.equal(autoTurnThinkingMode(undefined, { continuationAfterTool: false }), "max");
  assert.equal(autoTurnThinkingMode(undefined, { continuationAfterTool: true }), "off");
  assert.equal(autoTurnThinkingMode("auto", { continuationAfterTool: true }), "off");
  // Light explicit tiers still go off on continuation turns.
  assert.equal(autoTurnThinkingMode("low", { continuationAfterTool: false }), "low");
  assert.equal(autoTurnThinkingMode("low", { continuationAfterTool: true }), "off");
  assert.equal(autoTurnThinkingMode("off", { continuationAfterTool: false }), "off");
});

test("autoTurnThinkingMode honors an explicit heavy tier on every turn (operator override)", () => {
  for (const tier of ["medium", "high", "xhigh", "max", "ultrathink"]) {
    assert.equal(
      autoTurnThinkingMode(tier, { continuationAfterTool: true }),
      resolveThinkingMode(tier),
      `${tier} must keep thinking on continuation turns`,
    );
  }
});
