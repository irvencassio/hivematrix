import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("remaining active source prose uses lane wording", () => {
  const onboardingActions = read("src/lib/onboarding/actions.ts");
  const inventorDispatch = read("src/lib/inventorbee/task-dispatch.ts");
  const decisions = read("DECISIONS.md");

  assert.match(onboardingActions, /launchd plist for the Desktop Lane Swift helper/);
  assert.doesNotMatch(onboardingActions, /DesktopBee Swift helper/);

  assert.match(inventorDispatch, /Capability design task dispatch deferred/);
  assert.doesNotMatch(inventorDispatch, /InventorBee task dispatch deferred/);
  assert.match(inventorDispatch, /dispatchInventorBeeTask/);

  assert.match(decisions, /\*\*not\*\* a new public lane brand/);
  assert.doesNotMatch(decisions, /not a new public Bee brand/);
  assert.match(decisions, /No `VideoBee`\/`AvatarBee` brand is created/);
});
