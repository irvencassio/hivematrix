import test from "node:test";
import assert from "node:assert/strict";

import { getLaneApp } from "./catalog";
import { getLaneAppState, installLaneApp } from "./index";

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
