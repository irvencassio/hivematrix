import assert from "node:assert/strict";
import test from "node:test";

import {
  LANE_IDS,
  laneDisplayName,
  legacyCapabilityToLane,
  normalizeLaneId,
} from "./contracts";

test("normalizes public lane ids and legacy bee capability ids", () => {
  assert.deepEqual([...LANE_IDS], ["browser", "desktop", "mail", "message", "memory", "review"]);
  assert.equal(normalizeLaneId("Browser Lane"), "browser");
  assert.equal(normalizeLaneId("browser"), "browser");
  assert.equal(laneDisplayName("browser"), "Browser Lane");
  assert.equal(legacyCapabilityToLane("browserbee"), "browser");
  assert.equal(legacyCapabilityToLane("webbee"), "browser");
});

test("rejects unknown lane ids", () => {
  assert.throws(() => normalizeLaneId("weaver"), /Unknown lane/);
  // termbee (Terminal Lane) was retired — it no longer resolves to a lane.
  assert.equal(legacyCapabilityToLane("termbee"), null);
  assert.throws(() => normalizeLaneId("terminal"), /Unknown lane/);
});
