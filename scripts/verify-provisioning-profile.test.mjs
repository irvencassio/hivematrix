import { test } from "node:test";
import assert from "node:assert/strict";

import { parseProfilePlist, matchProfile } from "./verify-provisioning-profile.mjs";

// A real Developer ID Application macOS profile (what `HiveMatrix Core` is):
// macOS profiles carry the bundle app-id under `com.apple.application-identifier`,
// NOT the iOS `application-identifier` key.
const DEVELOPER_ID_MACOS = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>AppIDName</key><string>HiveMatrix Core</string>
  <key>Platform</key><array><string>OSX</string></array>
  <key>ProvisionsAllDevices</key><true/>
  <key>Entitlements</key>
  <dict>
    <key>keychain-access-groups</key><array><string>8B3CHTY93V.*</string></array>
    <key>com.apple.application-identifier</key><string>8B3CHTY93V.com.irvcassio.hivematrix.core</string>
    <key>com.apple.developer.team-identifier</key><string>8B3CHTY93V</string>
  </dict>
  <key>Name</key><string>HiveMatrix Core</string>
  <key>TeamIdentifier</key><array><string>8B3CHTY93V</string></array>
  <key>TeamName</key><string>Irv Cassio</string>
</dict>
</plist>`;

// An iOS-style profile uses the plain `application-identifier` key — the parser
// must accept both spellings.
const DEVELOPER_ID_MACOS_IOS_KEY = DEVELOPER_ID_MACOS.replace(
  "com.apple.application-identifier",
  "application-identifier",
);

// The iOS App Store profile actually installed on the machine — wrong platform + type.
const IOS_APP_STORE = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>AppIDName</key><string>HiveMatrix</string>
  <key>Platform</key><array><string>iOS</string><string>xrOS</string><string>visionOS</string></array>
  <key>Entitlements</key>
  <dict>
    <key>application-identifier</key><string>8B3CHTY93V.com.irvcassio.hivematrix.app</string>
  </dict>
  <key>Name</key><string>HiveMatrix App Store b35</string>
  <key>TeamIdentifier</key><array><string>8B3CHTY93V</string></array>
</dict>
</plist>`;

const EXPECT = { name: "HiveMatrix Core", bundleId: "com.irvcassio.hivematrix.core", teamId: "8B3CHTY93V" };

test("parseProfilePlist extracts name, team, application-identifier, platforms, provisionsAllDevices", () => {
  const p = parseProfilePlist(DEVELOPER_ID_MACOS);
  assert.equal(p.name, "HiveMatrix Core");
  assert.equal(p.teamIdentifier, "8B3CHTY93V");
  assert.equal(p.applicationIdentifier, "8B3CHTY93V.com.irvcassio.hivematrix.core");
  assert.deepEqual(p.platforms, ["OSX"]);
  assert.equal(p.provisionsAllDevices, true);
});

test("parseProfilePlist reads the bundle app-id from the macOS com.apple.application-identifier key", () => {
  const p = parseProfilePlist(DEVELOPER_ID_MACOS);
  assert.equal(p.applicationIdentifier, "8B3CHTY93V.com.irvcassio.hivematrix.core");
});

test("matchProfile accepts the Developer ID HiveMatrix Core profile", () => {
  const r = matchProfile(parseProfilePlist(DEVELOPER_ID_MACOS), EXPECT);
  assert.equal(r.ok, true, r.reasons.join("; "));
});

test("matchProfile accepts a profile using the plain application-identifier key too", () => {
  const r = matchProfile(parseProfilePlist(DEVELOPER_ID_MACOS_IOS_KEY), EXPECT);
  assert.equal(r.ok, true, r.reasons.join("; "));
});

test("matchProfile rejects a wrong name", () => {
  const r = matchProfile(parseProfilePlist(DEVELOPER_ID_MACOS), { ...EXPECT, name: "Something Else" });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /name/i.test(x)));
});

test("matchProfile rejects a wrong team", () => {
  const r = matchProfile(parseProfilePlist(DEVELOPER_ID_MACOS), { ...EXPECT, teamId: "WRONGTEAM0" });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /team/i.test(x)));
});

test("matchProfile rejects a wrong bundle id", () => {
  const r = matchProfile(parseProfilePlist(DEVELOPER_ID_MACOS), { ...EXPECT, bundleId: "com.irvcassio.hivematrix.other" });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /bundle|application-identifier/i.test(x)));
});

test("matchProfile rejects the iOS App Store profile (wrong platform/type)", () => {
  const r = matchProfile(parseProfilePlist(IOS_APP_STORE), EXPECT);
  assert.equal(r.ok, false);
  // It fails on name, application-identifier, AND Developer-ID-macOS type.
  assert.ok(r.reasons.some((x) => /Developer ID|OSX|macOS/i.test(x)));
});
