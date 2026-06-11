import assert from "node:assert/strict";
import test from "node:test";

import { isBoardVisibleDoneTask, isHiddenMissionDoneTask } from "./done-visibility";

test("done column keeps loose completed tasks visible", () => {
  const task = { status: "done", missionId: null, scheduledTaskId: null };

  assert.equal(isBoardVisibleDoneTask(task), true);
  assert.equal(isHiddenMissionDoneTask(task), false);
});

test("done column hides ordinary mission-bound completions", () => {
  const task = { status: "done", missionId: "mission-123", scheduledTaskId: null };

  assert.equal(isBoardVisibleDoneTask(task), false);
  assert.equal(isHiddenMissionDoneTask(task), true);
});

test("done column keeps scheduled mission runs visible after completion", () => {
  const task = { status: "done", missionId: "mission-123", scheduledTaskId: "sched-123" };

  assert.equal(isBoardVisibleDoneTask(task), true);
  assert.equal(isHiddenMissionDoneTask(task), false);
});

test("non-done tasks never qualify for the done column", () => {
  const task = { status: "review", missionId: "mission-123", scheduledTaskId: "sched-123" };

  assert.equal(isBoardVisibleDoneTask(task), false);
  assert.equal(isHiddenMissionDoneTask(task), false);
});
