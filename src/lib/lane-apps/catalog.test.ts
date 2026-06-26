import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LANE_APPS, getLaneApp } from "./catalog";

test("catalog covers Browser Lane and Terminal Lane with correct identity", () => {
  assert.equal(LANE_APPS.length, 2);
  const browser = getLaneApp("browser-lane");
  assert.equal(browser.displayName, "Browser Lane");
  assert.equal(browser.bundleId, "com.irvcassio.hivematrix.browserlane");
  assert.equal(browser.executable, "BrowserLane");
  const terminal = getLaneApp("terminal-lane");
  assert.equal(terminal.displayName, "Terminal Lane");
  assert.equal(terminal.bundleId, "com.irvcassio.hivematrix.terminallane");
  assert.equal(terminal.executable, "TerminalLane");
});

test("getLaneApp throws on unknown id", () => {
  // @ts-expect-error — exercising the runtime guard with a bad id.
  assert.throws(() => getLaneApp("nope"), /Unknown lane app/);
});

// The lane apps must NOT depend on the restricted keychain-access-groups
// entitlement (a prior launch blocker). Nothing in this module may reintroduce
// the requirement.
test("lane-apps module never references keychain-access-groups", () => {
  for (const file of ["catalog.ts", "contracts.ts"]) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /keychain-access-groups/);
  }
});
