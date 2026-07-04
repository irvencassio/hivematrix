import test from "node:test";
import assert from "node:assert/strict";

import { verificationGatePrompt } from "./verification-gate";

test("verification gate covers execute, static-check, deps, and re-verify", () => {
  const p = verificationGatePrompt();
  assert.match(p, /--- Code Verification Gate ---/);
  // execute step names concrete runners
  assert.match(p, /pytest|npm test/);
  // mypy is the tool that catches hallucinated stdlib attrs (curses.nap class)
  assert.match(p, /mypy/);
  assert.match(p, /attr-defined/);
  // agents must install missing deps, not switch approach
  assert.match(p, /pip install/);
  assert.match(p, /rather than failing/);
  // completion is gated on a clean pass
  assert.match(p, /Only report completion after a clean pass/);
});

test("verification gate closes the compile/import loophole and points at the smoke-runner", () => {
  const p = verificationGatePrompt();
  // Compiling/importing must be explicitly called out as insufficient.
  assert.match(p, /Compiling or importing is NOT enough/);
  // Names the exact curses runtime-crash class that static checks miss.
  assert.match(p, /addwstr\(\) returned ERR/);
  // Points at the bundled deterministic smoke-runner and says it also runs automatically.
  assert.match(p, /hive-verify-smoke\.py/);
  assert.match(p, /run automatically after you finish/);
});
