import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8");

const expected = {
  appleId: "cassio.irv@gmail.com",
  teamId: "8B3CHTY93V",
  profile: "hivematrix",
  keychainName: "com.apple.gke.notary.tool",
  keychainAccount: "com.apple.gke.notary.tool.saved-creds.hivematrix",
  identity: "Developer ID Application: Irven Cassio (8B3CHTY93V)",
  bundleId: "com.irvcassio.hivematrix.core",
  profileName: "HiveMatrix Core",
};

test("notary-credentials.sh pins the Irven Cassio developer team + default profile", () => {
  const body = read("scripts/notary-credentials.sh");
  assert.match(body, /NOTARY_APPLE_ID_DEFAULT="cassio\.irv@gmail\.com"/);
  assert.match(body, /NOTARY_TEAM_ID="\$\{APPLE_TEAM_ID:-8B3CHTY93V\}"/);
  assert.match(body, /NOTARY_DEFAULT_PROFILE="hivematrix"/);
  assert.match(body, /NOTARY_KEYCHAIN="\$HOME\/Library\/Keychains\/login\.keychain-db"/);
  assert.match(body, /NOTARY_KEYCHAIN_SERVICE="com\.apple\.gke\.notary\.tool"/);
  assert.match(body, /NOTARY_KEYCHAIN_ACCOUNT="com\.apple\.gke\.notary\.tool\.saved-creds\.\$\{NOTARY_DEFAULT_PROFILE\}"/);
  assert.match(body, /security find-generic-password -s "\$NOTARY_KEYCHAIN_SERVICE" -a "\$NOTARY_KEYCHAIN_ACCOUNT"/);
  assert.match(body, /security find-generic-password -l "\$NOTARY_KEYCHAIN_SERVICE" -a "\$NOTARY_KEYCHAIN_ACCOUNT"/);
  assert.match(body, /--keychain "\$NOTARY_KEYCHAIN"/);
});

for (const script of ["scripts/build-app.sh", "scripts/build-dmg.sh"]) {
  test(`${script} resolves notary credentials centrally and submits with NOTARY_ARGS`, () => {
    const body = read(script);
    assert.match(body, /source "\$\(dirname "\$0"\)\/notary-credentials\.sh"/);
    assert.match(body, /resolve_notary_args/);
    assert.match(body, /xcrun notarytool submit [^\n]+ "\$\{NOTARY_ARGS\[@\]\}" --wait/);
  });
}

test("developer-id-release.sh runs the credential + provisioning-profile gate BEFORE the version bump", () => {
  const body = read("scripts/developer-id-release.sh");
  const credGate = body.indexOf("resolve_notary_args");
  const profileGate = body.indexOf("node scripts/verify-provisioning-profile.mjs");
  const versionBump = body.indexOf("node scripts/release-version.mjs");
  assert.notEqual(credGate, -1, "must resolve notary credentials");
  assert.notEqual(profileGate, -1, "must gate on the HiveMatrix Core provisioning profile");
  assert.notEqual(versionBump, -1, "must bump the version via release-version.mjs");
  assert.ok(credGate < versionBump, "credential resolution precedes the version bump");
  assert.ok(profileGate < versionBump, "provisioning-profile gate precedes the version bump");
});

test("developer-id-release.sh pins the Developer ID identity, team, bundle ID, and profile name", () => {
  const body = read("scripts/developer-id-release.sh");
  assert.match(body, new RegExp(`IDENTITY="${expected.identity.replace(/[()]/g, "\\$&")}"`));
  assert.match(body, /TEAM_ID="8B3CHTY93V"/);
  assert.match(body, /BUNDLE_ID="com\.irvcassio\.hivematrix\.core"/);
  assert.match(body, /PROFILE_NAME="HiveMatrix Core"/);
});

test("setup-notary documents the actual notarytool Keychain name and account", () => {
  const body = read("scripts/setup-notary.sh");
  assert.match(body, /com\.apple\.gke\.notary\.tool/);
  assert.match(body, /com\.apple\.gke\.notary\.tool\.saved-creds\.hivematrix/);
  assert.match(body, /KEYCHAIN_PATH="\$HOME\/Library\/Keychains\/login\.keychain-db"/);
});

test("autodeploy banner shows the profile and exact notarytool Keychain account", () => {
  const body = read("scripts/autodeploy-main.sh");
  assert.match(body, /Profile\s+: hivematrix/);
  assert.match(body, /Name\s+: com\.apple\.gke\.notary\.tool/);
  assert.match(body, /Account\s+: com\.apple\.gke\.notary\.tool\.saved-creds\.hivematrix/);
});
