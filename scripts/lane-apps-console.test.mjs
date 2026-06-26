import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

// The Lane Apps console card is now driven by the unified /lane-setup model
// (Lane Setup & Reliability Center). This test pins that contract.
test("console exposes the Lane Apps reliability card in the Lanes tab", () => {
  const console = read("src/daemon/console.ts");

  // Card heading.
  assert.match(console, /Lane Apps/);

  // Explicit-install copy — the product decision.
  assert.match(
    console,
    /HiveMatrix updates itself automatically; lane apps are installed explicitly/,
  );

  // Driven by the unified reliability model, not the old raw /lane-apps list.
  assert.match(console, /api\("\/lane-setup"\)/);
  assert.match(console, /async function renderLaneSetup\(/);
  assert.match(console, /renderLaneSetup\(\)/);
  assert.doesNotMatch(console, /async function renderLaneApps\(/, "old renderer removed");

  // The operator actions are all reachable (install/update/verify/launch/reveal
  // via laneAppAction, readiness via laneRunReadiness).
  assert.match(console, /laneAppAction\(/);
  assert.match(console, /laneRunReadiness\(/);
  // Action labels are passed to the laneBtn helper as string literals.
  assert.match(console, /"verify", "Verify"/, "Verify reachable");
  assert.match(console, /"run_readiness", "Run readiness"/, "Run readiness reachable");
  assert.match(console, /"reveal", "Reveal"/, "Reveal reachable");

  // Surfaces installed vs bundled version + install path.
  assert.match(console, /installedVersion/);
  assert.match(console, /bundledVersion/);
  assert.match(console, /installedPath/);

  // The LaunchServices lesson stays visible: launch is a DISTINCT signal from
  // signature — the model + card render launchState and signingState separately.
  assert.match(console, /launchState/);
  assert.match(console, /signingState/);

  // No dead buttons: disabled actions carry a reason.
  assert.match(console, /disabledReasons/);

  // Never demands the restricted entitlement that previously blocked launch.
  assert.doesNotMatch(console, /keychain-access-groups/);
});
