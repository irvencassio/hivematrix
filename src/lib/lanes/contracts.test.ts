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

test("every worker kind in the lane catalog resolves to a canonical lane", async () => {
  // Agreement guard between two deliberately-different vocabularies:
  //   worker kinds  (lanes/catalog.ts)  — internal execution units, "brainbee"
  //   lane ids      (this file)         — user-facing surfaces,    "memory"
  // Two workers may collapse into one lane (webbee + browserbee -> browser),
  // so they are NOT meant to be the same list. What must hold is that every
  // worker kind maps somewhere.
  //
  // Regression: the map keyed "brain" while the catalog kind is "brainbee", so
  // normalizeLaneId("brainbee") THREW "Unknown lane: brainbee". That is a crash
  // path, not a silent null — normalizeLaneId runs over stored records in
  // workflows/registry.ts and coo/routing-rules.ts. Unit tests on each side
  // passed; nothing checked that the two ends agreed.
  const { listLaneDefinitions } = await import("./catalog");
  const unresolved: string[] = [];
  for (const def of listLaneDefinitions()) {
    let lane: string | null = null;
    try { lane = normalizeLaneId(def.kind); } catch { lane = null; }
    if (!lane || !(LANE_IDS as readonly string[]).includes(lane)) unresolved.push(def.kind);
  }
  assert.deepEqual(unresolved, [], `catalog worker kinds that do not resolve to a lane id: ${unresolved.join(", ")}`);
});

test("normalizeLaneId never throws on a worker kind the catalog actually emits", async () => {
  const { listLaneDefinitions } = await import("./catalog");
  for (const def of listLaneDefinitions()) {
    assert.doesNotThrow(() => normalizeLaneId(def.kind), `normalizeLaneId("${def.kind}") must not throw`);
  }
});

test("every canonical lane id is reachable from some worker kind or itself", async () => {
  // The inverse direction: a lane nothing can route to is a dead surface.
  const { listLaneDefinitions } = await import("./catalog");
  const reachable = new Set<string>();
  for (const def of listLaneDefinitions()) {
    try { reachable.add(normalizeLaneId(def.kind)); } catch { /* covered above */ }
  }
  const unreachable = LANE_IDS.filter((id) => !reachable.has(id));
  assert.deepEqual(
    unreachable, [],
    `lane ids with no worker kind resolving to them: ${unreachable.join(", ")}`,
  );
});
