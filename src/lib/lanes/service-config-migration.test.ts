import assert from "node:assert/strict";
import test from "node:test";

import { selectLaneServices, applyLaneServices } from "./service-manager";

const inventor = { autoStart: true, repoPath: "/Users/example/inventorbee" };
const other = { autoStart: false, repoPath: "/Users/example/other" };

test("selectLaneServices reads the legacy beeServices key when only it is present", () => {
  const resolved = selectLaneServices({ beeServices: { inventorbee: inventor } });
  assert.deepEqual(resolved, { inventorbee: inventor });
});

test("selectLaneServices reads the lane-native laneServices key when only it is present", () => {
  const resolved = selectLaneServices({ laneServices: { inventorbee: inventor } });
  assert.deepEqual(resolved, { inventorbee: inventor });
});

test("selectLaneServices prefers laneServices when both keys are present", () => {
  const resolved = selectLaneServices({
    laneServices: { inventorbee: inventor },
    beeServices: { inventorbee: other },
  });
  assert.deepEqual(resolved, { inventorbee: inventor });
});

test("selectLaneServices returns an empty map when neither key is present", () => {
  assert.deepEqual(selectLaneServices({}), {});
});

test("applyLaneServices writes laneServices and drops the legacy beeServices mirror", () => {
  const config: Record<string, unknown> = {
    apns: { team: "X" },
    beeServices: { inventorbee: other },
  };
  const next = applyLaneServices(config, { inventorbee: inventor });

  assert.deepEqual(next.laneServices, { inventorbee: inventor });
  assert.equal("beeServices" in next, false);
  // Unrelated config blocks are preserved.
  assert.deepEqual(next.apns, { team: "X" });
});

test("a save-then-read round trip resolves to the new settings via the lane key", () => {
  const migrated = applyLaneServices({ beeServices: { inventorbee: other } }, { inventorbee: inventor });
  assert.deepEqual(selectLaneServices(migrated), { inventorbee: inventor });
});
