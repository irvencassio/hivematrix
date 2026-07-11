import test from "node:test";
import assert from "node:assert/strict";

import { getLaneApp } from "./catalog";
import { artifactPathCandidatesFor, artifactPathFor, getLaneAppState, installLaneApp, repairApplicationsCopyWith, updateAllStaleLaneApps } from "./index";

const HOME = "/Users/tester";
const browser = getLaneApp("browser-lane");
const APPS_PATH = "/Applications/Browser Lane.app";
const USER_PATH = "/Users/tester/Applications/HiveMatrix Lanes/Browser Lane.app";

test("getLaneAppState reports installed when the active copy is up to date", () => {
  const state = getLaneAppState(browser, {
    home: HOME,
    exists: (p) => p === APPS_PATH,
    expected: { short: "0.1.86", build: "2" },
    readInstalled: () => ({ short: "0.1.86", build: "2" }),
  });
  assert.equal(state.id, "browser-lane");
  assert.equal(state.status, "installed");
  assert.equal(state.installPath, APPS_PATH);
  assert.deepEqual(state.installed, { short: "0.1.86", build: "2" });
  assert.deepEqual(state.expected, { short: "0.1.86", build: "2" });
});

test("getLaneAppState reports update_available when the bundled version is newer", () => {
  const state = getLaneAppState(browser, {
    home: HOME,
    exists: (p) => p === APPS_PATH,
    expected: { short: "0.1.87", build: "1" },
    readInstalled: () => ({ short: "0.1.86", build: "2" }),
  });
  assert.equal(state.status, "update_available");
});

test("getLaneAppState reports missing when no copy exists", () => {
  const state = getLaneAppState(browser, {
    home: HOME,
    exists: () => false,
    expected: { short: "0.1.86", build: "2" },
    readInstalled: () => null,
  });
  assert.equal(state.status, "missing");
  assert.equal(state.installed, null);
  assert.equal(state.activePath, null);
});

test("getLaneAppState flags duplication when both copies exist", () => {
  const state = getLaneAppState(browser, {
    home: HOME,
    exists: () => true,
    expected: { short: "0.1.86", build: "2" },
    readInstalled: () => ({ short: "0.1.86", build: "2" }),
  });
  assert.equal(state.duplicated, true);
  assert.equal(state.activePath, APPS_PATH);
});

test("a stale /Applications copy shadowing a current user copy is stale_copy + shadowed, not current", () => {
  const state = getLaneAppState(browser, {
    home: HOME,
    exists: () => true, // both copies present
    expected: { short: "0.1.87", build: "1" },
    expectedBuildId: "new",
    readInstalled: () => ({ short: "0.1.86", build: "2" }), // active (/Applications) is the OLD version
    readVersionAt: (p) => p === APPS_PATH ? { short: "0.1.86", build: "2" } : { short: "0.1.87", build: "1" },
    readBuildId: (p) => p === APPS_PATH ? "old" : "new",
  });
  assert.equal(state.activePath, APPS_PATH, "/Applications wins active");
  assert.equal(state.status, "stale_copy");
  assert.equal(state.shadowed, true);
  assert.equal(state.activeIsStale, true);
  // both copies are listed, with the user copy marked current and the active one stale.
  assert.equal(state.installedCopies.length, 2);
  const apps = state.installedCopies.find((c) => c.location === "applications");
  const user = state.installedCopies.find((c) => c.location === "user");
  assert.equal(apps?.active, true);
  assert.equal(apps?.current, false);
  assert.equal(user?.current, true);
});

test("a same-version /Applications copy with a stale build id is stale_copy", () => {
  const state = getLaneAppState(browser, {
    home: HOME,
    exists: (p) => p === APPS_PATH,
    expected: { short: "0.1.86", build: "2" },
    expectedBuildId: "new",
    readInstalled: () => ({ short: "0.1.86", build: "2" }),
    readVersionAt: () => ({ short: "0.1.86", build: "2" }),
    readBuildId: () => "old",
  });
  assert.equal(state.status, "stale_copy");
  assert.equal(state.activeIsStale, true);
  assert.equal(state.shadowed, false, "not shadowed — there is no current user copy");
});

test("updateAllStaleLaneApps installs + replaces a writable stale shadowing /Applications copy", async () => {
  const installed: string[] = [];
  const repaired: string[] = [];
  const states = [
    { id: "browser-lane", displayName: "Browser Lane", status: "installed", shadowed: false, activePath: "/Applications/Browser Lane.app" },
    { id: "demo-lane", displayName: "Demo Lane", status: "stale_copy", shadowed: true, activePath: "/Applications/Demo Lane.app" },
  ];
  const r = await updateAllStaleLaneApps({
    getStates: async () => states,
    install: async (id) => { installed.push(id); return { installedPath: `/Users/me/Applications/HiveMatrix Lanes/${id}.app`, activePath: `/Applications/${id}.app`, shadowed: true }; },
    repair: async (id) => { repaired.push(id); return { ok: true, replacedPath: `/Applications/${id}.app` }; },
  });
  // Only the stale lane is acted on.
  assert.deepEqual(installed, ["demo-lane"]);
  assert.deepEqual(repaired, ["demo-lane"]);
  const t = r.results.find((x) => x.id === "demo-lane");
  assert.ok(t);
  assert.equal(t.updated, true);
  assert.equal(t.replacedApplications, "/Applications/demo-lane.app");
  assert.equal(r.results.find((x) => x.id === "browser-lane"), undefined, "current lane skipped");
  assert.equal(r.ok, true);
});

test("updateAllStaleLaneApps never leaves a silent shadow when /Applications is not writable", async () => {
  const r = await updateAllStaleLaneApps({
    getStates: async () => [{ id: "demo-lane", displayName: "Demo Lane", status: "stale_copy", shadowed: true, activePath: "/Applications/Demo Lane.app" }],
    install: async () => ({ installedPath: "/Users/me/Applications/HiveMatrix Lanes/Demo Lane.app", activePath: "/Applications/Demo Lane.app", shadowed: true }),
    repair: async () => ({ ok: false, instructions: "/Applications/Demo Lane.app is not writable — drag it to the Trash, then retry." }),
  });
  const t = r.results.find((x) => x.id === "demo-lane");
  assert.ok(t);
  assert.equal(t.shadowed, true, "still shadowed — surfaced, not hidden");
  assert.match(t.warning ?? "", /not writable|Trash/i);
  assert.equal(r.ok, false, "overall not-ok when a stale copy remains active");
});

test("repairApplicationsCopyWith replaces a writable stale /Applications copy", () => {
  const replaced: Array<{ from: string; to: string }> = [];
  const r = repairApplicationsCopyWith(browser, {
    home: HOME,
    artifactPath: "/repo/build/browser-lane/Browser Lane.app",
    exists: () => true,
    writable: () => true,
    replace: (from, to) => replaced.push({ from, to }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.replacedPath, APPS_PATH);
  assert.deepEqual(replaced, [{ from: "/repo/build/browser-lane/Browser Lane.app", to: APPS_PATH }]);
});

test("repairApplicationsCopyWith gives exact instructions when /Applications is not writable", () => {
  const r = repairApplicationsCopyWith(browser, {
    home: HOME,
    artifactPath: "/repo/build/browser-lane/Browser Lane.app",
    exists: () => true,
    writable: () => false,
    replace: () => { throw new Error("must not replace a non-writable copy"); },
  });
  assert.equal(r.ok, false);
  assert.match(r.instructions ?? "", /not writable|admin|Trash/i);
  assert.match(r.instructions ?? "", /Browser Lane\.app/);
});

test("installLaneApp copies the artifact into the user-writable target", async () => {
  const copied: Array<{ from: string; to: string }> = [];
  const made: string[] = [];
  const result = await installLaneApp(browser, {
    artifactPath: "/repo/build/browser-lane/Browser Lane.app",
    home: HOME,
    exists: (p) => p === "/repo/build/browser-lane/Browser Lane.app",
    mkdirp: (p) => { made.push(p); },
    copyTree: (from, to) => { copied.push({ from, to }); },
    rename: () => {},
  });
  assert.equal(result.installedPath, USER_PATH);
  assert.equal(copied.length, 1);
  assert.ok(made.some((p) => p.includes("HiveMatrix Lanes")));
});

test("installLaneApp refuses when the artifact is missing", async () => {
  await assert.rejects(
    () => installLaneApp(browser, {
      artifactPath: "/repo/build/browser-lane/Browser Lane.app",
      home: HOME,
      exists: () => false,
      mkdirp: () => {},
      copyTree: () => {},
      rename: () => {},
    }),
    /artifact/i,
  );
});

test("artifactPathFor prefers packaged HiveMatrix resources over dev build outputs", () => {
  const packaged = "/Applications/HiveMatrix.app/Contents/Resources/lane-apps/Browser Lane.app";
  const dev = "/repo/build/browser-lane/Browser Lane.app";
  const candidates = artifactPathCandidatesFor(browser, {
    cwd: "/repo",
    execPath: "/Applications/HiveMatrix.app/Contents/Resources/daemon/bin/node",
  });

  assert.deepEqual(candidates, [packaged, dev]);
  assert.equal(artifactPathFor(browser, { exists: (p) => p === packaged, candidates }), packaged);
});

test("artifactPathFor falls back to the dev checkout artifact when packaged resources are absent", () => {
  const dev = "/repo/build/browser-lane/Browser Lane.app";
  const candidates = artifactPathCandidatesFor(browser, {
    cwd: "/repo",
    execPath: "/usr/local/bin/node",
  });

  assert.deepEqual(candidates, [dev]);
  assert.equal(artifactPathFor(browser, { exists: (p) => p === dev, candidates }), dev);
});
