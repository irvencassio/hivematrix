import assert from "node:assert/strict";
import test from "node:test";

import {
  getAppBundleRoot,
  getBundledDaemonPaths,
  isTranslocated,
  getBundleInstallReadiness,
} from "./app-bundle";

const INSTALLED = "/Applications/HiveMatrix.app/Contents/Resources/daemon/bin/node";
const TRANSLOCATED =
  "/private/var/folders/ab/xyz/AppTranslocation/UUID/d/HiveMatrix.app/Contents/Resources/daemon/bin/node";
const DOWNLOADS = "/Users/irv/Downloads/HiveMatrix.app/Contents/Resources/daemon/bin/node";
const DEV = "/Users/irv/.nvm/versions/node/v22.22.3/bin/node";

test("getAppBundleRoot extracts the .app root when bundled", () => {
  assert.equal(getAppBundleRoot(INSTALLED), "/Applications/HiveMatrix.app");
  assert.equal(getAppBundleRoot(DOWNLOADS), "/Users/irv/Downloads/HiveMatrix.app");
});

test("getAppBundleRoot returns null for a dev run", () => {
  assert.equal(getAppBundleRoot(DEV), null);
});

test("getBundledDaemonPaths returns node + cjs paths inside the bundle", () => {
  const p = getBundledDaemonPaths(INSTALLED);
  assert.equal(p?.appRoot, "/Applications/HiveMatrix.app");
  assert.equal(p?.nodeBin, "/Applications/HiveMatrix.app/Contents/Resources/daemon/bin/node");
  assert.equal(p?.daemonCjs, "/Applications/HiveMatrix.app/Contents/Resources/daemon/daemon.cjs");
  assert.equal(getBundledDaemonPaths(DEV), null);
});

test("isTranslocated detects the AppTranslocation mount", () => {
  assert.equal(isTranslocated(TRANSLOCATED), true);
  assert.equal(isTranslocated(INSTALLED), false);
});

test("getBundleInstallReadiness only OKs an /Applications install", () => {
  assert.deepEqual(
    { ok: getBundleInstallReadiness(INSTALLED).ok, state: getBundleInstallReadiness(INSTALLED).state },
    { ok: true, state: "ok" },
  );
  assert.equal(getBundleInstallReadiness(TRANSLOCATED).state, "translocated");
  assert.equal(getBundleInstallReadiness(TRANSLOCATED).ok, false);
  assert.equal(getBundleInstallReadiness(DOWNLOADS).state, "outside_applications");
  assert.equal(getBundleInstallReadiness(DOWNLOADS).ok, false);
  assert.equal(getBundleInstallReadiness(DEV).state, "dev");
});
