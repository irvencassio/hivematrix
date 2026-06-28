import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const body = readFileSync("scripts/build-daemon.mjs", "utf8");

test("build-daemon replaces absolute symlinks in the staged Python runtime", () => {
  assert.match(body, /function replaceAbsoluteSymlinks\(root\)/);
  assert.match(body, /lstatSync\(entry\)/);
  assert.match(body, /readlinkSync\(entry\)/);
  assert.match(body, /target\.startsWith\("\/"\)/);
  assert.match(body, /unlinkSync\(entry\)/);
  assert.match(body, /cpSync\(target, entry, \{ recursive: true, preserveTimestamps: true \}\)/);
  assert.match(body, /replaceAbsoluteSymlinks\(join\(OUT, "python"\)\)/);
});

test("build-daemon dereferences Python symlinks before interpreter signing setup", () => {
  const replaceIndex = body.indexOf('replaceAbsoluteSymlinks(join(OUT, "python"))');
  const pyBinIndex = body.indexOf("const pyBinDir = join(OUT, \"python\", \"bin\")");

  assert.notEqual(replaceIndex, -1);
  assert.notEqual(pyBinIndex, -1);
  assert.ok(replaceIndex < pyBinIndex);
});
