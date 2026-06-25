import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("service and build operator copy uses lane wording", () => {
  const serviceManager = read("src/lib/lanes/service-manager.ts");
  const signingScript = read("scripts/sign-bundled-machos.sh");
  const releaseDoc = read("docs/RELEASE.md");

  assert.match(serviceManager, /Lane \$\{kind\} does not support LaunchAgent generation/);
  assert.match(serviceManager, /Lane \$\{kind\} is not launchagent-managed/);
  assert.match(serviceManager, /Run the lane build first/);
  assert.match(serviceManager, /Lane \$\{kind\} is not restartable/);

  assert.doesNotMatch(serviceManager, /Bee \$\{kind\}/);
  assert.doesNotMatch(serviceManager, /Run the Bee build first/);

  assert.match(signingScript, /Signing Desktop Lane helper \(DesktopBeeHelper\.app\)/);
  assert.doesNotMatch(signingScript, /Signing DesktopBeeHelper\.app \(its own entitlements\)/);

  assert.match(releaseDoc, /Desktop Lane helper compatibility bundle,\s+`DesktopBeeHelper\.app`/);
  assert.doesNotMatch(releaseDoc, /nested \*\*DesktopBeeHelper\.app\*\*/);
});
