import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDaemonPlist,
  buildHelperPlist,
  mergeConfig,
  probeOpenAiEndpoint,
  installDaemonLaunchAgent,
  installDesktopBeeHelper,
  openSystemSettingsPane,
  TCC_DEEP_LINKS,
} from "./actions";

const INSTALLED = "/Applications/HiveMatrix.app/Contents/Resources/daemon/bin/node";
const TRANSLOCATED =
  "/private/var/folders/x/AppTranslocation/UUID/d/HiveMatrix.app/Contents/Resources/daemon/bin/node";
const DEV = "/Users/irv/.nvm/versions/node/v22.22.3/bin/node";

test("buildDaemonPlist points at the bundled node + cjs, no tsx", () => {
  const plist = buildDaemonPlist({
    nodeBin: "/Applications/HiveMatrix.app/Contents/Resources/daemon/bin/node",
    daemonCjs: "/Applications/HiveMatrix.app/Contents/Resources/daemon/daemon.cjs",
    logDir: "/Users/irv/Library/Logs/HiveMatrix",
  });
  assert.match(plist, /com\.hivematrix\.daemon/);
  assert.match(plist, /Resources\/daemon\/bin\/node/);
  assert.match(plist, /daemon\.cjs/);
  assert.match(plist, /HIVEMATRIX_NODE_BIN/);
  assert.match(plist, /<key>PATH<\/key><string>[^<]*\/opt\/homebrew\/bin/);
  assert.doesNotMatch(plist, /tsx/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<key>WorkingDirectory<\/key><string>[^<]+<\/string>/);
  assert.doesNotMatch(plist, /<key>WorkingDirectory<\/key><string>\/?<\/string>/);
});

test("buildHelperPlist points at the nested helper executable", () => {
  const plist = buildHelperPlist({
    helperApp: "/Applications/HiveMatrix.app/Contents/Resources/DesktopBeeHelper.app",
    logDir: "/Users/irv/Library/Logs/HiveMatrix",
  });
  assert.match(plist, /com\.hivematrix\.desktopbee\.helper/);
  assert.match(plist, /DesktopBeeHelper\.app\/Contents\/MacOS\/DesktopBeeHelper/);
  assert.match(plist, /DESKTOPBEE_PORT/);
});

test("mergeConfig deep-merges objects and replaces scalars/arrays", () => {
  const base = { memory: { enabled: true, brainRootDir: "~/old" }, x: 1, arr: [1, 2] };
  const merged = mergeConfig(base, { memory: { brainRootDir: "~/new" }, x: 2, arr: [3] });
  assert.deepEqual(merged, { memory: { enabled: true, brainRootDir: "~/new" }, x: 2, arr: [3] });
});

test("probeOpenAiEndpoint normalizes the /v1/models URL and reports reachability", async () => {
  const calls: string[] = [];
  const okFetch = (async (url: string) => { calls.push(String(url)); return { ok: true, status: 200 } as Response; }) as unknown as typeof fetch;
  assert.equal((await probeOpenAiEndpoint("http://127.0.0.1:1234", okFetch)).ok, true);
  assert.equal(calls[0], "http://127.0.0.1:1234/v1/models");
  assert.equal((await probeOpenAiEndpoint("http://127.0.0.1:1234/v1/", okFetch)).ok, true);
  assert.equal(calls[1], "http://127.0.0.1:1234/v1/models");

  const failFetch = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const r = await probeOpenAiEndpoint("http://127.0.0.1:9", failFetch);
  assert.equal(r.ok, false);
  assert.match(r.detail, /ECONNREFUSED/);
});

test("installDaemonLaunchAgent refuses outside /Applications (no side effects)", () => {
  // exec throws if ever called — proves the guard returns before any launchctl/write.
  const exec = () => { throw new Error("should not run"); };
  const dev = installDaemonLaunchAgent({ execPath: DEV, exec });
  assert.equal(dev.ok, false);
  assert.equal((dev.data as { state?: string }).state, "dev");

  const trans = installDaemonLaunchAgent({ execPath: TRANSLOCATED, exec });
  assert.equal(trans.ok, false);
  assert.equal((trans.data as { state?: string }).state, "translocated");
});

test("installDesktopBeeHelper refuses for a non-bundle run", () => {
  const exec = () => { throw new Error("should not run"); };
  const r = installDesktopBeeHelper({ execPath: DEV, exec });
  assert.equal(r.ok, false);
});

test("TCC deep-links target the right panes", () => {
  assert.match(TCC_DEEP_LINKS.accessibility, /Privacy_Accessibility/);
  assert.match(TCC_DEEP_LINKS.screenRecording, /Privacy_ScreenCapture/);
});

void INSTALLED;

test("openSystemSettingsPane shells `open` at the right TCC URL", () => {
  const calls: Array<[string, string[]]> = [];
  const r = openSystemSettingsPane("fullDiskAccess", (cmd, args) => { calls.push([cmd, args]); });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, [["open", [TCC_DEEP_LINKS.fullDiskAccess]]]);
});

test("openSystemSettingsPane reports a failed `open` instead of throwing", () => {
  const r = openSystemSettingsPane("accessibility", () => { throw new Error("no open"); });
  assert.equal(r.ok, false);
  assert.match(r.detail, /no open/);
});
