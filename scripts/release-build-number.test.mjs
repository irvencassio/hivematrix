import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const releaseScript = readFileSync(new URL("./release.mjs", import.meta.url), "utf8");

test("release script increments BUILD_NUMBER when cutting a release", () => {
  assert.match(releaseScript, /BUILD_NUMBER/);
  assert.match(
    releaseScript,
    /BUILD_NUMBER\s*=\s*\$\{Number\([^)]*build[^)]*\)\s*\+\s*1\}/s,
    "release.mjs should rewrite BUILD_NUMBER to previous build + 1",
  );
});

test("release script refreshes BUILD_DATE when cutting a release", () => {
  assert.match(releaseScript, /BUILD_DATE/);
  assert.match(
    releaseScript,
    /BUILD_DATE\s*=\s*\$\{JSON\.stringify\([^)]*today[^)]*\)\}/s,
    "release.mjs should rewrite BUILD_DATE to the release date",
  );
});
