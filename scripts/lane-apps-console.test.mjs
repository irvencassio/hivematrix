import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("console exposes a Lane Apps manager card in the Lanes tab", () => {
  const console = read("src/daemon/console.ts");

  // Card heading.
  assert.match(console, /Lane Apps/);

  // Explicit-install copy — the product decision, verbatim.
  assert.match(
    console,
    /HiveMatrix updates itself automatically; lane apps are installed explicitly/,
  );

  // The four operator actions.
  assert.match(console, /Install\/Update|Install\\\/Update/);
  assert.ok(/>\s*Verify\s*</.test(console) || /Verify<\/button>/.test(console), "Verify button");
  assert.ok(/Launch<\/button>/.test(console) || />\s*Launch\s*</.test(console), "Launch button");
  assert.ok(/Reveal<\/button>/.test(console) || />\s*Reveal\s*</.test(console), "Reveal button");

  // Talks to the endpoint via the api() helper, and drives the per-app actions.
  assert.match(console, /api\("\/lane-apps"\)/);
  assert.match(console, /laneAppAction\(/);
  assert.match(console, /renderLaneApps\(\)/);

  // Surfaces installed vs bundled/available version and install path.
  assert.match(console, /installed/);
  assert.match(console, /expected|bundled|available/);

  // The LaunchServices lesson must be visible: launch_failed is a DISTINCT
  // status from invalid_signature in the badge rendering — codesign/spctl
  // passing alone is not sufficient.
  assert.match(console, /launch_failed/);
  assert.match(console, /invalid_signature/);

  // Never demands the restricted entitlement that previously blocked launch.
  assert.doesNotMatch(console, /keychain-access-groups/);
});
