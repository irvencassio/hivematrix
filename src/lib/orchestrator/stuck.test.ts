import test from "node:test";
import assert from "node:assert/strict";
import { selectLatestPendingStuck } from "./stuck";
import type { StuckRequest } from "./stuck";

function req(overrides: Partial<StuckRequest>): StuckRequest {
  return {
    taskId: "task1", timestamp: "1000", reason: "r", lastOutput: "",
    options: ["retry", "skip", "abort"], missionId: null, source: "watchdog",
    ...overrides,
  };
}

test("selectLatestPendingStuck returns null when there are no pending requests", () => {
  assert.equal(selectLatestPendingStuck([]), null);
});

test("selectLatestPendingStuck picks the most recent by timestamp", () => {
  const older = req({ timestamp: "1000", reason: "old" });
  const newer = req({ timestamp: "2000", reason: "new" });
  assert.equal(selectLatestPendingStuck([older, newer])?.reason, "new");
  assert.equal(selectLatestPendingStuck([newer, older])?.reason, "new");
});

test("selectLatestPendingStuck carries the options array through unchanged", () => {
  const r = req({ timestamp: "1000", options: ["Implement", "Defer", "Skip"] });
  assert.deepEqual(selectLatestPendingStuck([r])?.options, ["Implement", "Defer", "Skip"]);
});
