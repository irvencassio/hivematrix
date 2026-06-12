import assert from "node:assert/strict";
import test from "node:test";

import { decideBootMode } from "./install-state";

test("fresh: no config and no launchd agent", () => {
  const d = decideBootMode({ hasConfig: false, hasLaunchAgent: false, installedVersion: null, bundledVersion: "1.0.0" });
  assert.equal(d.mode, "fresh");
  assert.equal(d.to, "1.0.0");
});

test("update: installed at an older version", () => {
  const d = decideBootMode({ hasConfig: true, hasLaunchAgent: true, installedVersion: "1.0.0", bundledVersion: "1.1.0" });
  assert.equal(d.mode, "update");
  assert.equal(d.from, "1.0.0");
  assert.equal(d.to, "1.1.0");
});

test("update: installed but no version recorded (pre-versioning build)", () => {
  const d = decideBootMode({ hasConfig: true, hasLaunchAgent: false, installedVersion: null, bundledVersion: "1.1.0" });
  assert.equal(d.mode, "update");
  assert.equal(d.from, null);
});

test("same: installed at the current version", () => {
  const d = decideBootMode({ hasConfig: true, hasLaunchAgent: true, installedVersion: "1.1.0", bundledVersion: "1.1.0" });
  assert.equal(d.mode, "same");
});

test("same: installed version newer than bundle (no downgrade churn)", () => {
  const d = decideBootMode({ hasConfig: true, hasLaunchAgent: true, installedVersion: "2.0.0", bundledVersion: "1.1.0" });
  assert.equal(d.mode, "same");
});

test("config present but no agent still counts as installed", () => {
  const d = decideBootMode({ hasConfig: true, hasLaunchAgent: false, installedVersion: "1.0.0", bundledVersion: "1.0.0" });
  assert.equal(d.mode, "same");
});
