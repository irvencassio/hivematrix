import test from "node:test";
import assert from "node:assert/strict";
import { ConnectivityPolicy } from "./policy";

function freshPolicy() {
  return new ConnectivityPolicy();
}

test("defaults to cloud-ok", () => {
  const p = freshPolicy();
  assert.equal(p.mode, "cloud-ok");
  assert.equal(p.canUseCloud(), true);
});

test("manual override wins over probe failures", () => {
  const p = freshPolicy();
  p.setManualOverride("local-only");
  for (let i = 0; i < 5; i++) p.onProbeFailure();
  assert.equal(p.mode, "local-only"); // override, not offline
});

test("usage exhaustion degrades to local-only", () => {
  const p = freshPolicy();
  p.onUsageWindowExhausted("claude");
  assert.equal(p.mode, "local-only");
  assert.equal(p.canUseCloud(), false);
});

test("all frontier tasks blocked in local-only mode", () => {
  const p = freshPolicy();
  p.onUsageWindowExhausted("claude");
  assert.equal(p.getCapability("frontier").available, false);
  assert.equal(p.getCapability("local").available, true);
  assert.equal(p.getCapability("webbee").available, false);
  assert.equal(p.getCapability("desktopbee").available, true);
});

test("restoring usage window recovers cloud-ok", () => {
  const p = freshPolicy();
  p.onUsageWindowExhausted("claude");
  assert.equal(p.mode, "local-only");
  p.onUsageWindowRestored("claude");
  assert.equal(p.mode, "cloud-ok");
});

test("probe failures below threshold do not change mode", () => {
  const p = freshPolicy();
  for (let i = 0; i < ConnectivityPolicy.OFFLINE_PROBE_THRESHOLD - 1; i++) {
    p.onProbeFailure();
  }
  assert.equal(p.mode, "cloud-ok");
});

test("probe failures at threshold degrade to offline", () => {
  const p = freshPolicy();
  for (let i = 0; i < ConnectivityPolicy.OFFLINE_PROBE_THRESHOLD; i++) {
    p.onProbeFailure();
  }
  assert.equal(p.mode, "offline");
  assert.equal(p.getCapability("frontier").available, false);
  assert.equal(p.getCapability("webbee").available, false);
  assert.equal(p.getCapability("browserbee").available, false);
});

test("probe success clears failures and restores mode", () => {
  const p = freshPolicy();
  for (let i = 0; i < ConnectivityPolicy.OFFLINE_PROBE_THRESHOLD; i++) p.onProbeFailure();
  assert.equal(p.mode, "offline");
  p.onProbeSuccess();
  assert.equal(p.mode, "cloud-ok");
});

test("modeChange event fires on exhaustion", (t, done) => {
  const p = freshPolicy();
  p.once("modeChange", ({ prev, current }) => {
    assert.equal(prev, "cloud-ok");
    assert.equal(current, "local-only");
    done();
  });
  p.onUsageWindowExhausted("claude");
});

test("modeChange event fires on restoration", (t, done) => {
  const p = freshPolicy();
  p.onUsageWindowExhausted("claude");
  p.once("modeChange", ({ prev, current }) => {
    assert.equal(prev, "local-only");
    assert.equal(current, "cloud-ok");
    done();
  });
  p.onUsageWindowRestored("claude");
});

test("resolveModelTier — cloud-ok maps think to frontier", () => {
  const p = freshPolicy();
  assert.equal(p.resolveModelTier("think"), "frontier");
  assert.equal(p.resolveModelTier("execute"), "local-secondary");
  assert.equal(p.resolveModelTier("image"), "nanai");
});

test("resolveModelTier — local-only maps think to local-primary", () => {
  const p = freshPolicy();
  p.setManualOverride("local-only");
  assert.equal(p.resolveModelTier("think"), "local-primary");
  assert.equal(p.resolveModelTier("code-critical"), "local-primary");
  assert.equal(p.resolveModelTier("image"), "unavailable");
});

test("resolveModelTier — offline maps all to local", () => {
  const p = freshPolicy();
  p.setManualOverride("offline");
  assert.equal(p.resolveModelTier("think"), "local-primary");
  assert.equal(p.resolveModelTier("execute"), "local-secondary");
  assert.equal(p.resolveModelTier("image"), "unavailable");
});

test("multiple exhausted providers — all must restore before cloud-ok returns", () => {
  const p = freshPolicy();
  p.onUsageWindowExhausted("claude");
  p.onUsageWindowExhausted("codex");
  assert.equal(p.mode, "local-only");
  p.onUsageWindowRestored("claude");
  assert.equal(p.mode, "local-only"); // codex still exhausted
  p.onUsageWindowRestored("codex");
  assert.equal(p.mode, "cloud-ok");
});

test("getState returns accurate snapshot", () => {
  const p = freshPolicy();
  p.onUsageWindowExhausted("claude");
  const state = p.getState();
  assert.equal(state.mode, "local-only");
  assert.deepEqual(state.exhaustedProviders, ["claude"]);
  assert.equal(state.manualOverride, null);
  assert.equal(state.probeFailures, 0);
});

test("clearing manual override falls back to derived mode", () => {
  const p = freshPolicy();
  p.onUsageWindowExhausted("claude");
  p.setManualOverride("cloud-ok");
  assert.equal(p.mode, "cloud-ok"); // override
  p.setManualOverride(null);
  assert.equal(p.mode, "local-only"); // back to derived
});
