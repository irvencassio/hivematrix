import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("build-app.sh rebuilds the Desktop Lane helper from source before signing it", () => {
  const buildApp = read("scripts/build-app.sh");

  const rebuildMatch = buildApp.match(/bash\s+desktopbee-helper\/build-app\.sh/);
  assert.ok(rebuildMatch, "expected scripts/build-app.sh to call bash desktopbee-helper/build-app.sh");

  const rebuildIdx = buildApp.indexOf(rebuildMatch[0]);
  const signIdx = buildApp.indexOf("sign-bundled-machos.sh");
  assert.ok(signIdx >= 0, "expected the existing sign-bundled-machos.sh call to still be present");
  assert.ok(
    rebuildIdx < signIdx,
    "the helper must be rebuilt from source BEFORE sign-bundled-machos.sh signs whatever is on disk",
  );
});
