import assert from "node:assert/strict";
import test from "node:test";

import { makeMarker, buildCommandPayload, extractResult } from "./contracts";

test("buildCommandPayload wraps the command in a brace group (state persists) with combined output", () => {
  const p = buildCommandPayload("echo hi", "__M__");
  assert.match(p, /\{\necho hi\n\} 2>&1/);
  assert.match(p, /echo "__M__:\$\?"/);
});

test("extractResult returns null until the marker, then output + exit code", () => {
  const marker = makeMarker("abc");
  assert.equal(extractResult("partial output...", marker), null);
  const buf = `line1\nline2\n${marker}:0\n`;
  assert.deepEqual(extractResult(buf, marker), { output: "line1\nline2\n", exitCode: 0 });
});

test("extractResult captures non-zero exit codes", () => {
  const marker = makeMarker("z");
  assert.deepEqual(extractResult(`boom\n${marker}:127\n`, marker), { output: "boom\n", exitCode: 127 });
});
