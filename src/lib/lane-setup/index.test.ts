import test from "node:test";
import assert from "node:assert/strict";

import { getLaneSetup } from "./index";

// A stub LaneAppState; only the fields getLaneSetup reads need to be realistic.
// Typed `any` so partial status strings don't fight the strict LaneAppState type.
function appState(over: Record<string, unknown> = {}): any {
  return {
    id: "browser-lane",
    displayName: "Browser Lane",
    installed: { short: "0.1.86", build: "2" },
    expected: { short: "0.1.86", build: "2" },
    installPath: "/Users/x/Applications/HiveMatrix Lanes/Browser Lane.app",
    activePath: "/Users/x/Applications/HiveMatrix Lanes/Browser Lane.app",
    preferredPath: "/Users/x/Applications/HiveMatrix Lanes/Browser Lane.app",
    installedPaths: [],
    duplicated: false,
    status: "installed",
    ...over,
  };
}

const browserTotals = (over = {}) => ({
  lane: "browser",
  totals: { sites: 3, byColor: { green: 2, yellow: 0, orange: 1, red: 0, gray: 0 }, needsAttention: 1, stale: 1 },
  sites: [],
  ...over,
});
const terminalTotals = (over = {}) => ({
  lane: "terminal",
  totals: { profiles: 2, byColor: { green: 1, yellow: 0, orange: 1, red: 0, gray: 0 }, needsAttention: 1 },
  profiles: [],
  ...over,
});

// Default deps: both apps installed & current, running, verified valid, daemon up.
function deps(over = {}) {
  return {
    appStates: () => [
      appState({ id: "browser-lane", displayName: "Browser Lane", status: "installed" }),
      appState({ id: "terminal-lane", displayName: "Terminal Lane", status: "installed" }),
    ],
    browserDashboard: () => browserTotals(),
    terminalDashboard: () => terminalTotals(),
    isRunning: () => true,
    verification: () => ({ signatureOk: true, launchOk: true }),
    ...over,
  };
}

async function browser(d: any): Promise<any> {
  const e = (await getLaneSetup(d)).lanes.find(l => l.id === "browser-lane");
  assert.ok(e, "browser-lane entry present");
  return e;
}
async function terminal(d: any): Promise<any> {
  const e = (await getLaneSetup(d)).lanes.find(l => l.id === "terminal-lane");
  assert.ok(e, "terminal-lane entry present");
  return e;
}

test("returns one entry per lane in catalog order", async () => {
  const { lanes } = await getLaneSetup(deps());
  assert.deepEqual(lanes.map(l => l.id), ["browser-lane", "terminal-lane"]);
});

test("installState maps from the lane-app status", async () => {
  const cases = [
    ["missing", "not_installed"],
    ["installed", "current"],
    ["update_available", "outdated"],
    ["stale_copy", "stale"],
    ["launch_failed", "broken"],
    ["invalid_signature", "broken"],
  ];
  for (const [status, expected] of cases) {
    const d = deps({ appStates: () => [appState({ id: "browser-lane", status }), appState({ id: "terminal-lane", status })] });
    assert.equal((await browser(d)).installState, expected, status);
  }
});

test("a stale_copy never reads as current and carries the shadow detail", async () => {
  const APPS = "/Applications/Browser Lane.app";
  const USER = "/Users/x/Applications/HiveMatrix Lanes/Browser Lane.app";
  const d = deps({ appStates: () => [
    appState({
      id: "browser-lane",
      status: "stale_copy",
      activePath: APPS,
      shadowed: true,
      activeIsStale: true,
      installedCopies: [
        { path: APPS, location: "applications", active: true, current: false, version: { short: "0.1.86", build: "2" }, buildId: "old" },
        { path: USER, location: "user", active: false, current: true, version: { short: "0.1.87", build: "1" }, buildId: "new" },
      ],
    }),
    appState({ id: "terminal-lane" }),
  ] });
  const b = await browser(d);
  assert.equal(b.installState, "stale");
  assert.notEqual(b.installState, "current");
  assert.equal(b.shadowed, true);
  assert.equal(b.installedCopies.length, 2);
  // The fix points at the /Applications copy, not a shadowed user install.
  assert.equal(b.nextAction.action, "repair");
  assert.match(b.nextAction.label, /\/Applications/);
});

test("versions and path are carried through honestly", async () => {
  const b = await browser(deps());
  assert.deepEqual(b.bundledVersion, { short: "0.1.86", build: "2" });
  assert.deepEqual(b.installedVersion, { short: "0.1.86", build: "2" });
  assert.match(b.installedPath, /Browser Lane\.app$/);
});

test("launchState reflects pgrep and recorded verification", async () => {
  assert.equal((await browser(deps({ isRunning: () => true }))).launchState, "running");
  assert.equal((await browser(deps({ isRunning: () => false, verification: () => null }))).launchState, "not_running");
  assert.equal((await browser(deps({ isRunning: () => null, verification: () => null }))).launchState, "unknown");
  // A recorded failed launch probe wins over a bare pgrep miss.
  assert.equal((await browser(deps({ isRunning: () => false, verification: () => ({ launchOk: false }) }))).launchState, "failed");
});

test("signingState comes only from a recorded verification", async () => {
  assert.equal((await browser(deps({ verification: () => ({ signatureOk: true }) }))).signingState, "valid");
  assert.equal((await browser(deps({ verification: () => ({ signatureOk: false }) }))).signingState, "invalid");
  assert.equal((await browser(deps({ verification: () => null }))).signingState, "unknown");
});

test("daemonState is unavailable when the readiness store throws (never silent success)", async () => {
  const d = deps({ browserDashboard: () => { throw new Error("db locked"); } });
  const b = await browser(d);
  assert.equal(b.daemonState, "unavailable");
  assert.equal(b.readiness.configuredSites, 0);
  // The other lane is unaffected.
  assert.equal((await terminal(d)).daemonState, "reachable");
});

test("browser readiness summary is counts only", async () => {
  const b = await browser(deps());
  assert.deepEqual(b.readiness, { lane: "browser", configuredSites: 3, ready: 2, stale: 1, needsAttention: 1 });
});

test("terminal readiness summary is counts only", async () => {
  const t = await terminal(deps());
  assert.deepEqual(t.readiness, { lane: "terminal", configuredProfiles: 2, ready: 1, failed: 1, needsAttention: 1 });
});

test("nextAction follows the repair priority", async () => {
  const mk = (over: any) => deps({ appStates: () => [appState({ id: "browser-lane", ...over }), appState({ id: "terminal-lane" })], ...over.depOver });
  assert.equal((await browser(mk({ status: "missing" }))).nextAction.action, "install");
  assert.equal((await browser(mk({ status: "update_available" }))).nextAction.action, "update");
  assert.equal((await browser(mk({ status: "launch_failed" }))).nextAction.action, "verify");
  // current but never verified → verify
  assert.equal((await browser(deps({ verification: () => null }))).nextAction.action, "verify");
  // current + valid but not running → launch
  assert.equal((await browser(deps({ verification: () => ({ signatureOk: true }), isRunning: () => false }))).nextAction.action, "launch");
  // current + valid + running + readiness needs attention → run readiness
  assert.equal((await browser(deps({ verification: () => ({ signatureOk: true }), isRunning: () => true }))).nextAction.action, "run_readiness");
  // all green → open
  const allGreen = deps({
    verification: () => ({ signatureOk: true }),
    isRunning: () => true,
    browserDashboard: () => browserTotals({ totals: { sites: 1, byColor: { green: 1, yellow: 0, orange: 0, red: 0, gray: 0 }, needsAttention: 0, stale: 0 } }),
  });
  assert.equal((await browser(allGreen)).nextAction.action, "open");
  assert.ok((await browser(allGreen)).nextAction.label.length > 0, "label present");
});

test("disabledReasons explain unavailable actions when not installed", async () => {
  const d = deps({ appStates: () => [appState({ id: "browser-lane", status: "missing", installed: null, activePath: null }), appState({ id: "terminal-lane" })] });
  const b = await browser(d);
  assert.ok(b.disabledReasons.verify && /install/i.test(b.disabledReasons.verify), "verify disabled with reason");
  assert.ok(b.disabledReasons.launch && /install/i.test(b.disabledReasons.launch), "launch disabled with reason");
});

test("lane setup output carries NO secret material", async () => {
  // Stub dashboards that DO carry secrets in their detail rows (as the real ones do).
  const d = deps({
    browserDashboard: () => browserTotals({ sites: [{ credentialRef: "hivematrix.browser.foo", providerAccount: "me@example.com", homeUrl: "https://x" }] }),
    terminalDashboard: () => terminalTotals({ profiles: [{ credentialRef: "hivematrix.terminal.bar", host: "10.0.0.9", user: "root", port: 22 }] }),
  });
  const json = JSON.stringify(await getLaneSetup(d));
  assert.doesNotMatch(json, /credentialRef|password|private_key|passphrase|providerAccount|"host"|"user"/, "no secret/identifying fields leak into the unified model");
});
