import test from "node:test";
import assert from "node:assert/strict";
import { isBroadPrompt } from "./breadth";

// The Work Package / Flight decomposition subsystem was removed (2026-07-06).
// Broad prompts now dispatch as a single task with workflow:"work" and the
// frontier coding harness self-plans via Superpowers. All that remains of intake
// is the breadth signal that decides broad-vs-narrow routing.

test("a small, single-step prompt is not broad", () => {
  assert.equal(isBroadPrompt("Fix the typo in the README header."), false);
});

test("a 'fix all across the codebase' prompt is broad", () => {
  assert.equal(
    isBroadPrompt("Fix all the lint errors across the codebase, update every outdated dependency, and refactor the auth module."),
    true,
  );
});

test("an explicit multi-step enumerated prompt is broad", () => {
  assert.equal(isBroadPrompt("1. Run the test suite. 2. Build the daemon. 3. Deploy and publish the release."), true);
});

test("a comma-list of three or more steps is broad", () => {
  assert.equal(isBroadPrompt("do a, do b, and do c"), true);
});

test("a single broad-sounding step is broad on 'whole' wording but a lone step is not", () => {
  // "the whole" is a broad keyword; a lone unqualified step is not broad.
  assert.equal(isBroadPrompt("Refactor the whole auth module."), true);
  assert.equal(isBroadPrompt("Refactor the auth module."), false);
});

test("empty / whitespace input is not broad", () => {
  assert.equal(isBroadPrompt(""), false);
  assert.equal(isBroadPrompt("   "), false);
});
