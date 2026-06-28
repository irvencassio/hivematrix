import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const expected = {
  appleId: "cassio.irv@gmail.com",
  teamId: "8B3CHTY93V",
  profile: "hivematrix",
};

for (const script of ["scripts/build-app.sh", "scripts/build-dmg.sh"]) {
  test(`${script} pins notarytool to the Irven Cassio developer team`, () => {
    const body = readFileSync(script, "utf8");

    assert.match(body, new RegExp(`NOTARY_APPLE_ID="${expected.appleId}"`));
    assert.match(body, new RegExp(`NOTARY_TEAM_ID="${expected.teamId}"`));
    assert.match(body, new RegExp(`NOTARY_PROFILE="${expected.profile}"`));
    assert.match(body, /xcrun notarytool submit [^\n]+ "\$\{NOTARY_ARGS\[@\]\}" --wait/);
  });
}

test("release preflight validates the saved notarytool profile before version bump", () => {
  const body = readFileSync("scripts/release.mjs", "utf8");
  const preflightIndex = body.indexOf("xcrun notarytool history");
  const bumpIndex = body.indexOf("step(1, \"bump version");

  assert.notEqual(preflightIndex, -1, "release.mjs should validate the notary profile up front");
  assert.ok(preflightIndex < bumpIndex, "notary validation should run before version files are edited");
  assert.match(body, /const notaryAppleId = "cassio\.irv@gmail\.com"/);
  assert.match(body, /const notaryTeamId = "8B3CHTY93V"/);
  assert.match(body, /const notaryProfile = "hivematrix"/);
  assert.match(body, /--apple-id \$\{notaryAppleId\}/);
  assert.match(body, /--team-id \$\{notaryTeamId\}/);
  assert.match(body, /--keychain-profile \$\{notaryProfile\}/);
});

test("setup-notary documents the actual notarytool Keychain service and account", () => {
  const body = readFileSync("scripts/setup-notary.sh", "utf8");

  assert.match(body, /com\.apple\.gke\.notary\.tool/);
  assert.match(body, /com\.apple\.gke\.notary\.tool\.saved-creds\.hivematrix/);
});
