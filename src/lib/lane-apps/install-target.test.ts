import test from "node:test";
import assert from "node:assert/strict";

import { getLaneApp } from "./catalog";
import { resolveInstallTarget } from "./install-target";

const HOME = "/Users/tester";
const browser = getLaneApp("browser-lane");
const USER_PATH = "/Users/tester/Applications/HiveMatrix Lanes/Browser Lane.app";
const APPS_PATH = "/Applications/Browser Lane.app";

function targetWith(present: string[]) {
  return resolveInstallTarget(browser, { home: HOME, exists: (p) => present.includes(p) });
}

test("preferred install target is always the user-writable HiveMatrix Lanes path", () => {
  const t = targetWith([]);
  assert.equal(t.preferredPath, USER_PATH);
  assert.equal(t.userPath, USER_PATH);
  assert.equal(t.applicationsPath, APPS_PATH);
});

test("neither present → no active path, not duplicated", () => {
  const t = targetWith([]);
  assert.equal(t.activePath, null);
  assert.deepEqual(t.installedPaths, []);
  assert.equal(t.duplicated, false);
});

test("only user copy present → that is active", () => {
  const t = targetWith([USER_PATH]);
  assert.equal(t.activePath, USER_PATH);
  assert.deepEqual(t.installedPaths, [USER_PATH]);
  assert.equal(t.duplicated, false);
});

test("only /Applications copy present → that is active", () => {
  const t = targetWith([APPS_PATH]);
  assert.equal(t.activePath, APPS_PATH);
  assert.deepEqual(t.installedPaths, [APPS_PATH]);
  assert.equal(t.duplicated, false);
});

test("both present → /Applications is active and duplication is flagged", () => {
  const t = targetWith([APPS_PATH, USER_PATH]);
  assert.equal(t.activePath, APPS_PATH);
  assert.equal(t.duplicated, true);
  assert.equal(t.installedPaths.length, 2);
});
