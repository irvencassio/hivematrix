import test from "node:test";
import assert from "node:assert/strict";

import { detectBundleVersionDrift, maybeSelfHealBundleDrift } from "./self-heal";

test("detectBundleVersionDrift flags a newer on-disk bundle when packaged", () => {
  const d = detectBundleVersionDrift({ runningVersion: "0.1.137", onDiskVersion: "0.1.138", isPackaged: true });
  assert.equal(d.drifted, true);
});

test("detectBundleVersionDrift is quiet when versions match", () => {
  const d = detectBundleVersionDrift({ runningVersion: "0.1.138", onDiskVersion: "0.1.138", isPackaged: true });
  assert.equal(d.drifted, false);
});

test("detectBundleVersionDrift never drifts in a dev/source run (not packaged)", () => {
  const d = detectBundleVersionDrift({ runningVersion: "0.1.137", onDiskVersion: "0.1.138", isPackaged: false });
  assert.equal(d.drifted, false, "an unpackaged daemon has no bundle to restart into");
});

test("detectBundleVersionDrift ignores an older on-disk bundle", () => {
  const d = detectBundleVersionDrift({ runningVersion: "0.1.138", onDiskVersion: "0.1.137", isPackaged: true });
  assert.equal(d.drifted, false);
});

test("maybeSelfHealBundleDrift kickstarts when the bundle was swapped underneath", async () => {
  let restarted = 0;
  const r = await maybeSelfHealBundleDrift({
    runningVersion: "0.1.137",
    readOnDiskVersion: () => "0.1.138",
    isPackaged: () => true,
    restart: async () => { restarted++; },
    log: () => {},
  });
  assert.equal(restarted, 1, "should kickstart launchd exactly once on drift");
  assert.equal(r.healed, true);
});

test("maybeSelfHealBundleDrift does nothing without drift", async () => {
  let restarted = 0;
  const r = await maybeSelfHealBundleDrift({
    runningVersion: "0.1.138",
    readOnDiskVersion: () => "0.1.138",
    isPackaged: () => true,
    restart: async () => { restarted++; },
    log: () => {},
  });
  assert.equal(restarted, 0);
  assert.equal(r.healed, false);
});

test("maybeSelfHealBundleDrift treats an unreadable Info.plist as no drift", async () => {
  let restarted = 0;
  const r = await maybeSelfHealBundleDrift({
    runningVersion: "0.1.137",
    readOnDiskVersion: () => { throw new Error("mid-swap"); },
    isPackaged: () => true,
    restart: async () => { restarted++; },
    log: () => {},
  });
  assert.equal(restarted, 0, "an unreadable plist must not trigger a restart");
  assert.equal(r.healed, false);
});

test("maybeSelfHealBundleDrift reports a failed kickstart without throwing", async () => {
  const r = await maybeSelfHealBundleDrift({
    runningVersion: "0.1.137",
    readOnDiskVersion: () => "0.1.138",
    isPackaged: () => true,
    restart: async () => { throw new Error("launchctl not found"); },
    log: () => {},
  });
  assert.equal(r.healed, false);
  assert.match(r.error ?? "", /launchctl not found/);
});
