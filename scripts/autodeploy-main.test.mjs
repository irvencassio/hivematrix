import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(path, "utf8");

test("autodeploy command is exposed through npm scripts", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.equal(pkg.scripts.autodeploy, "bash scripts/autodeploy-main.sh");
});

test("README command list includes the repeatable autodeploy command", () => {
  const body = read("README.md");

  assert.match(body, /npm run autodeploy\s+# increment version, commit, push, build, publish update feed/);
});

test("autodeploy wrapper delegates to the existing release lane with an incremented version", () => {
  const body = read("scripts/autodeploy-main.sh");

  assert.match(body, /NEXT_VERSION=/);
  assert.match(body, /package\.json/);
  assert.match(body, /bash scripts\/developer-id-release\.sh --release --marketing-version "\$VERSION" --note "\$NOTE"/);
  assert.match(body, /git fetch origin main/);
  assert.match(body, /git rev-parse --abbrev-ref HEAD/);
});

test("autodeploy wrapper prints release source-of-truth files and Node-RED search results", () => {
  const body = read("scripts/autodeploy-main.sh");

  for (const path of [
    "scripts/developer-id-release.sh",
    "scripts/release-version.mjs",
    "scripts/verify-provisioning-profile.mjs",
    "scripts/build-app.sh",
    "scripts/build-dmg.sh",
    "scripts/setup-notary.sh",
    "scripts/notary-identity.test.mjs",
  ]) {
    assert.match(body, new RegExp(path.replace(/[./]/g, "\\$&")));
  }

  assert.match(body, /Node-RED logic check/);
  assert.match(body, /node-red\|nodered\|Node-RED/);
  assert.match(body, /--glob '!scripts\/autodeploy-main\.sh'/);
  assert.match(body, /--glob '!scripts\/autodeploy-main\.test\.mjs'/);
  assert.match(body, /No Node-RED logic found in HiveMatrix source/);
});
