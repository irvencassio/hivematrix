import test from "node:test";
import assert from "node:assert/strict";

import { detectTransientFailureText, shouldRaiseSilenceWatchdog } from "./agent-manager";

test("detectTransientFailureText treats Claude updater lock as retryable", () => {
  const text = [
    "Error: Another instance is currently performing an update",
    "Please wait and try again later",
    "Bun v1.3.14 (macOS arm64)",
  ].join("\n");

  assert.deepEqual(detectTransientFailureText(text), {
    transient: true,
    delayMinutes: 2,
    reason: "Claude CLI update in progress",
  });
});

test("shouldRaiseSilenceWatchdog covers mission and dashboard tasks", () => {
  assert.equal(shouldRaiseSilenceWatchdog({ missionId: "mission-1", source: "dispatch" }), true);
  assert.equal(shouldRaiseSilenceWatchdog({ missionId: null, source: "dashboard" }), true);
  assert.equal(shouldRaiseSilenceWatchdog({ missionId: null, source: "dispatch" }), false);
  assert.equal(shouldRaiseSilenceWatchdog(null), false);
});
