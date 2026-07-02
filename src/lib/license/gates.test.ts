import test from "node:test";
import assert from "node:assert/strict";
import { isProLicense, isFeaturePermitted, checkGate } from "./gates";
import type { LicenseStatus } from "./license";

function make(overrides: Partial<LicenseStatus>): LicenseStatus {
  return { state: "missing", permitted: true, reason: "test", ...overrides };
}

// isProLicense

test("isProLicense: false when missing", () => {
  assert.equal(isProLicense(make({ state: "missing" })), false);
});
test("isProLicense: false when edition not pro", () => {
  assert.equal(isProLicense(make({ state: "valid", edition: "free" })), false);
});
test("isProLicense: false when expired beyond grace", () => {
  assert.equal(isProLicense(make({ state: "expired", edition: "pro" })), false);
});
test("isProLicense: false when invalid (tampered)", () => {
  assert.equal(isProLicense(make({ state: "invalid", permitted: false, reason: "bad sig" })), false);
});
test("isProLicense: true for valid pro", () => {
  assert.equal(isProLicense(make({ state: "valid", edition: "pro" })), true);
});
test("isProLicense: true during grace period", () => {
  assert.equal(isProLicense(make({ state: "grace", edition: "pro" })), true);
});

// isFeaturePermitted

test("isFeaturePermitted: blocks channel_mail on free (missing)", () => {
  assert.equal(isFeaturePermitted("channel_mail", make({ state: "missing" })), false);
});
test("isFeaturePermitted: blocks channel_message when unlicensed", () => {
  assert.equal(isFeaturePermitted("channel_message", make({ state: "unlicensed" })), false);
});
test("isFeaturePermitted: allows channel_mail on valid pro", () => {
  assert.equal(isFeaturePermitted("channel_mail", make({ state: "valid", edition: "pro" })), true);
});
test("isFeaturePermitted: allows voice on grace pro", () => {
  assert.equal(isFeaturePermitted("voice", make({ state: "grace", edition: "pro" })), true);
});
test("isFeaturePermitted: blocks companion_pairing on expired", () => {
  assert.equal(isFeaturePermitted("companion_pairing", make({ state: "expired", edition: "pro" })), false);
});
test("isFeaturePermitted: blocks directives on machine_mismatch", () => {
  assert.equal(
    isFeaturePermitted("directives", make({ state: "machine_mismatch", permitted: false, reason: "wrong machine" })),
    false,
  );
});

// checkGate

test("checkGate: upgradeRequired when license missing", () => {
  const r = checkGate("channel_mail", make({ state: "missing" }));
  assert.equal(r.permitted, false);
  assert.equal(r.upgradeRequired, true);
  assert.ok(r.reason.includes("Pro license"));
});
test("checkGate: upgradeRequired when unlicensed (no key)", () => {
  const r = checkGate("voice", make({ state: "unlicensed" }));
  assert.equal(r.permitted, false);
  assert.equal(r.upgradeRequired, true);
});
test("checkGate: upgradeRequired false on expired", () => {
  const r = checkGate("directives", make({ state: "expired", edition: "pro", reason: "past grace" }));
  assert.equal(r.permitted, false);
  assert.equal(r.upgradeRequired, false);
  assert.ok(r.reason.includes("expired"));
});
test("checkGate: permitted on valid pro", () => {
  const r = checkGate("companion_pairing", make({ state: "valid", edition: "pro" }));
  assert.equal(r.permitted, true);
});
test("checkGate: permitted on grace pro", () => {
  const r = checkGate("channel_message", make({ state: "grace", edition: "pro" }));
  assert.equal(r.permitted, true);
});
test("checkGate: reason includes feature label", () => {
  const missing = make({ state: "missing" });
  assert.ok(checkGate("companion_pairing", missing).reason.includes("Companion pairing"));
  assert.ok(checkGate("voice", missing).reason.includes("Voice"));
  assert.ok(checkGate("directives", missing).reason.includes("Directives"));
});
