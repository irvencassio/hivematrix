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

test("claudeEffortMode: 'auto'/unset stays adaptive so the --effort flag is omitted", () => {
  // "auto" is NOT a level the CLI accepts — subprocess.ts omits the flag for it,
  // letting Claude Code choose per turn like a direct session. Previously this
  // collapsed to "max", so every trivial task paid maximum reasoning latency.
  assert.equal(claudeEffortMode("auto"), "auto");
  assert.equal(claudeEffortMode(""), "auto");
  assert.equal(claudeEffortMode(undefined), "auto");
  assert.equal(claudeEffortMode(null), "auto");
});

test("claudeEffortMode: an explicit tier is always honored, junk stays conservative", () => {
  for (const tier of ["low", "medium", "high", "xhigh", "max"]) {
    assert.equal(claudeEffortMode(tier), tier, `${tier} passes through`);
  }
  // ultrathink has no --effort equivalent; it is an in-prompt keyword.
  assert.equal(claudeEffortMode("ultrathink"), "max");
  // An unrecognized value must NOT silently become adaptive.
  assert.equal(claudeEffortMode("nonsense"), "max");
});
