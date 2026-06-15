import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { stripNullBytes } from "./subprocess";

const NUL = String.fromCharCode(0);

test("stripNullBytes removes NUL bytes; clean strings pass through", () => {
  assert.equal(stripNullBytes("no nulls here"), "no nulls here");
  assert.equal(stripNullBytes("a" + NUL + "b" + NUL + "c"), "abc");
  assert.equal(stripNullBytes(NUL), "");
  // An AGENTS.md-style block with a stray embedded NUL (the real-world case).
  const dirty = "--- Project conventions (AGENTS.md) ---\n# CLAUDE.md" + NUL + "\nrules";
  assert.ok(!stripNullBytes(dirty).includes(NUL));
});

test("sanitized arg is accepted by child_process spawn (NUL would throw)", () => {
  // Reproduce the actual failure mode: spawnSync throws on a NUL-bearing argv.
  assert.throws(() => spawnSync("true", ["x" + NUL + "y"]), /null bytes/);
  // After sanitizing, the same arg spawns without error.
  const r = spawnSync("true", [stripNullBytes("x" + NUL + "y")]);
  assert.equal(r.error, undefined);
});
