import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_TASK_PROJECT } from "./project-constants";
import {
  getDefaultTaskProject,
  getMissionProjectOptions,
  getTaskProjectOptions,
  shouldShowTaskProjectField,
} from "./project-options";

test("task project options hide personal virtual projects when personal tasks are disabled", () => {
  assert.deepEqual(getTaskProjectOptions(["hive"], false), ["hive", "inbox"]);
});

test("task project options include personal virtual projects when personal tasks are enabled", () => {
  assert.deepEqual(getTaskProjectOptions(["hive"], true), ["goal", "hive", "idea", "inbox", "task"]);
});

test("default task project uses inbox with no real project aliases", () => {
  assert.equal(getDefaultTaskProject([], []), DEFAULT_TASK_PROJECT);
});

test("default task project uses a single real project alias when available", () => {
  assert.equal(getDefaultTaskProject(["hive"], ["hive"]), "hive");
});

test("basic task project field is hidden with zero or one real project and personal tasks disabled", () => {
  assert.equal(shouldShowTaskProjectField({
    showAdvanced: false,
    realProjectCount: 0,
    personalTasksEnabled: false,
  }), false);
  assert.equal(shouldShowTaskProjectField({
    showAdvanced: false,
    realProjectCount: 1,
    personalTasksEnabled: false,
  }), false);
});

test("task project field is shown for advanced mode, multiple projects, personal tasks, or project workflows", () => {
  assert.equal(shouldShowTaskProjectField({
    showAdvanced: true,
    realProjectCount: 0,
    personalTasksEnabled: false,
  }), true);
  assert.equal(shouldShowTaskProjectField({
    showAdvanced: false,
    realProjectCount: 2,
    personalTasksEnabled: false,
  }), true);
  assert.equal(shouldShowTaskProjectField({
    showAdvanced: false,
    realProjectCount: 0,
    personalTasksEnabled: true,
  }), true);
  assert.equal(shouldShowTaskProjectField({
    showAdvanced: false,
    realProjectCount: 0,
    personalTasksEnabled: false,
    workflowRequiresProject: true,
  }), true);
});

test("mission project options keep personal virtual projects behind the personal tasks feature", () => {
  assert.deepEqual(getMissionProjectOptions(["hive"], false), ["hive", "ops"]);
  assert.deepEqual(getMissionProjectOptions(["hive"], true), ["goal", "hive", "idea", "ops", "task"]);
});
