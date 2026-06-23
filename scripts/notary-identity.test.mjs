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
