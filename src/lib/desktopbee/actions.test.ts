import test from "node:test";
import assert from "node:assert/strict";
import {
  DESKTOPBEE_ACTIONS,
  actionTier,
  decideApproval,
  isDesktopBeeAction,
  type DesktopBeeRequest,
} from "./actions";

test("every action has a tier", () => {
  for (const a of DESKTOPBEE_ACTIONS) {
    assert.ok(["free", "policy", "approval"].includes(actionTier(a)), `${a} tier`);
  }
});

test("read-only actions are free tier", () => {
  assert.equal(actionTier("desktop.apps.list"), "free");
  assert.equal(actionTier("desktop.ax.query"), "free");
  assert.equal(actionTier("desktop.capture"), "free");
});

test("act actions are policy tier, script is approval tier", () => {
  assert.equal(actionTier("desktop.app.activate"), "policy");
  assert.equal(actionTier("desktop.ax.act"), "policy");
  assert.equal(actionTier("desktop.type"), "policy");
  assert.equal(actionTier("desktop.click"), "policy");
  assert.equal(actionTier("desktop.script.run"), "approval");
});

test("free actions always auto-approve", () => {
  const d = decideApproval({ action: "desktop.capture" });
  assert.equal(d.autoApproved, true);
  assert.equal(d.tier, "free");
});

test("policy action requires approval by default", () => {
  const req: DesktopBeeRequest = { action: "desktop.ax.act", app: "Finder" };
  const d = decideApproval(req, { appAllowlist: ["Finder"] });
  assert.equal(d.autoApproved, false);
});

test("policy action auto-approves when policy allows and app allowlisted", () => {
  const req: DesktopBeeRequest = { action: "desktop.ax.act", app: "Finder" };
  const d = decideApproval(req, { appAllowlist: ["Finder"], autoApprovePolicyTier: true });
  assert.equal(d.autoApproved, true);
});

test("policy action blocked when app not allowlisted, even with auto-approve", () => {
  const req: DesktopBeeRequest = { action: "desktop.click", app: "Mail" };
  const d = decideApproval(req, { appAllowlist: ["Finder"], autoApprovePolicyTier: true });
  assert.equal(d.autoApproved, false);
  assert.match(d.reason, /not in allowlist/);
});

test("script.run requires approval by default", () => {
  const d = decideApproval({ action: "desktop.script.run", app: "Finder" }, { appAllowlist: ["Finder"] });
  assert.equal(d.autoApproved, false);
});

test("script.run can auto-approve only with explicit autoApproveScripts + allowlist", () => {
  const allow = decideApproval({ action: "desktop.script.run", app: "Finder" },
    { appAllowlist: ["Finder"], autoApproveScripts: true });
  assert.equal(allow.autoApproved, true);
  const blocked = decideApproval({ action: "desktop.script.run", app: "Mail" },
    { appAllowlist: ["Finder"], autoApproveScripts: true });
  assert.equal(blocked.autoApproved, false);
});

test("isDesktopBeeAction guards unknown strings", () => {
  assert.equal(isDesktopBeeAction("desktop.capture"), true);
  assert.equal(isDesktopBeeAction("desktop.nuke"), false);
  assert.equal(isDesktopBeeAction(42), false);
});
