import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
function read(p) { return readFileSync(join(root, p), "utf8"); }

test("Terminal Lane bundle version is bumped past the stale 0.1.1 (2)", () => {
  const plist = read("terminal-lane-app/Resources/Info.plist");
  const short = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1]?.trim();
  const build = plist.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1]?.trim();
  assert.equal(short, "0.1.2", "short version bumped");
  assert.equal(build, "3", "build number bumped");
});

test("both lane app Info.plists carry an HMBuildId build-identity key", () => {
  for (const p of ["terminal-lane-app/Resources/Info.plist", "browser-lane-app/Resources/Info.plist"]) {
    assert.match(read(p), /<key>HMBuildId<\/key>/, `${p} has HMBuildId`);
  }
});

test("both packagers inject the source commit into the bundled HMBuildId", () => {
  for (const p of ["scripts/package-terminal-lane-app.mjs", "scripts/package-browser-lane-app.mjs"]) {
    const src = read(p);
    assert.match(src, /HMBuildId/, `${p} touches HMBuildId`);
    assert.match(src, /rev-parse/, `${p} injects the git commit`);
  }
});

test("the pinned expected Terminal Lane version is newer than 0.1.1 (2)", async () => {
  const { compareVersions } = await import("../src/lib/lane-apps/status.ts");
  const { expectedVersionFor } = await import("../src/lib/lane-apps/index.ts");
  const { getLaneApp } = await import("../src/lib/lane-apps/catalog.ts");
  const expected = expectedVersionFor(getLaneApp("terminal-lane"));
  assert.ok(compareVersions(expected, { short: "0.1.1", build: "2" }) > 0,
    `expected ${expected.short} (${expected.build}) must be newer than 0.1.1 (2)`);
});

test("the bundled Terminal Lane is the profile-management build (edit/delete present)", () => {
  const profiles = read("terminal-lane-app/Sources/TerminalLaneApp/ProfilesViewController.swift");
  assert.match(profiles, /deleteProfile/);
  assert.match(profiles, /editProfile/);
  assert.match(profiles, /duplicateProfile|Duplicate/);
});
