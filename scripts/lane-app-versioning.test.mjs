import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
function read(p) { return readFileSync(join(root, p), "utf8"); }

test("the Browser Lane app Info.plist carries an HMBuildId build-identity key", () => {
  assert.match(read("browser-lane-app/Resources/Info.plist"), /<key>HMBuildId<\/key>/, "has HMBuildId");
});

test("the Browser Lane packager injects the source commit into the bundled HMBuildId", () => {
  const src = read("scripts/package-browser-lane-app.mjs");
  assert.match(src, /HMBuildId/, "touches HMBuildId");
  assert.match(src, /rev-parse/, "injects the git commit");
});

test("the pinned expected Browser Lane version is newer than 0.1.1 (2)", async () => {
  const { compareVersions } = await import("../src/lib/lane-apps/status.ts");
  const { expectedVersionFor } = await import("../src/lib/lane-apps/index.ts");
  const { getLaneApp } = await import("../src/lib/lane-apps/catalog.ts");
  const expected = expectedVersionFor(getLaneApp("browser-lane"));
  assert.ok(compareVersions(expected, { short: "0.1.1", build: "2" }) > 0,
    `expected ${expected.short} (${expected.build}) must be newer than 0.1.1 (2)`);
});
