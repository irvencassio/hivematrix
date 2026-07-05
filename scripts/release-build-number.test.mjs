import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// BUILD_NUMBER/BUILD_DATE bumping moved out of the deleted scripts/release.mjs
// into the tested helper scripts/release-version.mjs, driven by the canonical
// scripts/developer-id-release.sh. These guards keep that wiring intact.
const versionHelper = readFileSync(new URL("./release-version.mjs", import.meta.url), "utf8");
const releaseScript = readFileSync(new URL("./developer-id-release.sh", import.meta.url), "utf8");

test("release-version.mjs increments BUILD_NUMBER to previous + 1", () => {
  assert.match(versionHelper, /BUILD_NUMBER/);
  assert.match(versionHelper, /const next = n \+ 1/, "nextBuildNumber must be previous + 1");
  assert.match(versionHelper, /BUILD_NUMBER\s*=\s*\$\{buildNumber\}/, "applyVersionTs rewrites BUILD_NUMBER");
});

test("release-version.mjs refreshes BUILD_DATE to the release date", () => {
  assert.match(versionHelper, /BUILD_DATE\s*=\s*"\$\{date\}"/, "applyVersionTs rewrites BUILD_DATE");
});

test("developer-id-release.sh delegates version/build bumping to release-version.mjs", () => {
  assert.match(releaseScript, /node scripts\/release-version\.mjs/);
});
