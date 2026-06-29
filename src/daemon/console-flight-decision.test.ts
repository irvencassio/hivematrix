import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The console is a served HTML/JS string, so the browser logic is asserted by
// source inspection (mirrors the repo's other source-level UI guards). It checks
// that the Flight item blocker render distinguishes the two decision states.
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "console.ts"), "utf8");

test("console renders a distinct 'Needs Flight decision' state for parent-resolvable child blockers", () => {
  assert.match(SRC, /Needs Flight decision/);
  assert.match(SRC, /NEEDS_PARENT_DECISION:/);
});

test("console renders 'Needs your reply' for coordinator-escalated operator decisions", () => {
  assert.match(SRC, /Needs your reply/);
  assert.match(SRC, /NEEDS_OPERATOR_DECISION:/);
});

test("the flight item blocker render is routed through flightBlockerHtml (not a bare errbox)", () => {
  assert.match(SRC, /const blocker = flightBlockerHtml\(it\.blocker, it\.createdTaskId\);/);
  assert.match(SRC, /function flightBlockerHtml\(blocker, taskId\)/);
});

test("an escalated operator decision offers a one-click 'Accept recommended' button", () => {
  assert.match(SRC, /Accept recommended:/);
  assert.match(SRC, /onclick="wpAcceptDecision\(/);
});

test("wpAcceptDecision sends the chosen answer to the tested /tasks/:id/reply requeue path", () => {
  assert.match(SRC, /async function wpAcceptDecision\(taskId, enc\)/);
  assert.match(SRC, /"\/tasks\/"\+encodeURIComponent\(taskId\)\+"\/reply"/);
  // The answer is encoded for safe inlining in the onclick attribute.
  assert.match(SRC, /function attrEnc\(s\)/);
  assert.match(SRC, /decodeURIComponent\(enc\)/);
});
