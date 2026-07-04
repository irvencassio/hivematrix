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
