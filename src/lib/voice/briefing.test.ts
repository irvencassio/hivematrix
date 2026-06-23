import test from "node:test";
import assert from "node:assert/strict";
import { buildVoiceBriefing } from "./briefing";

test("briefing speaks pending approvals, failed tasks, active directives, and usage", () => {
  const briefing = buildVoiceBriefing({
    approvals: [{ title: "Review release plan", kind: "checkpoint" }],
    failedTasks: [{ title: "Sign desktop build" }],
    directives: [
      { goal: "Release watcher", status: "active" },
      { goal: "Inbox cleanup", status: "sleeping" },
    ],
    usage: {
      totalCost: 12.345,
      todayCost: 1.2,
      taskCount: 4,
      todayTaskCount: 1,
      subscriptionPercentRemaining: 42,
    },
  });

  assert.match(briefing, /1 approval/);
  assert.match(briefing, /Review release plan/);
  assert.match(briefing, /1 failed task/);
  assert.match(briefing, /Sign desktop build/);
  assert.match(briefing, /1 active directive/);
  assert.match(briefing, /Release watcher/);
  assert.match(briefing, /\$12\.35/);
  assert.match(briefing, /42%/);
});
