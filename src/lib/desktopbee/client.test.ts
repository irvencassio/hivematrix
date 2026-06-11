import test from "node:test";
import assert from "node:assert/strict";
import { dispatchDesktopBeeAction, desktopBeeHelperUrl } from "./client";

// These tests verify the approval gate WITHOUT a running helper — gated actions
// must be refused before any network call. Free actions would attempt a fetch
// (to a port with no helper) and return a connection error, which also proves
// they passed the gate.

test("helper url is loopback", () => {
  assert.equal(desktopBeeHelperUrl(), "http://127.0.0.1:3748");
  assert.equal(desktopBeeHelperUrl(9999), "http://127.0.0.1:9999");
});

test("policy-tier action is refused without approval (no network call)", async () => {
  const r = await dispatchDesktopBeeAction(
    { action: "desktop.click", app: "Finder" },
    { policy: { appAllowlist: ["Finder"] }, port: 1 }
  );
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /approval required \(policy\)/);
});

test("script.run is refused without approval", async () => {
  const r = await dispatchDesktopBeeAction(
    { action: "desktop.script.run", app: "Finder" },
    { policy: { appAllowlist: ["Finder"] }, port: 1 }
  );
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /approval required \(approval\)/);
});

test("explicit approved=true bypasses the gate (then fails on no helper)", async () => {
  const r = await dispatchDesktopBeeAction(
    { action: "desktop.click", app: "Finder" },
    { policy: { appAllowlist: ["Finder"] }, approved: true, port: 1, timeoutMs: 500 }
  );
  // Passed the gate → attempted dispatch → connection failure (no helper on port 1).
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error ?? "", /approval required/);
});

test("free-tier action passes the gate (attempts dispatch)", async () => {
  const r = await dispatchDesktopBeeAction(
    { action: "desktop.apps.list" },
    { port: 1, timeoutMs: 500 }
  );
  // No approval needed; fails only because there's no helper on port 1.
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error ?? "", /approval required/);
});
