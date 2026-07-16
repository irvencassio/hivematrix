import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const console_ts = readFileSync(new URL("../src/daemon/console.ts", import.meta.url), "utf8");

test("section heading is Scheduled not Directives", () => {
  assert.ok(console_ts.includes(">Scheduled<"), "section summary must say Scheduled");
  assert.ok(!console_ts.includes(">Directives<"), "old Directives label must be gone");
});

test("new item button says New scheduled item", () => {
  assert.ok(
    console_ts.includes("New scheduled item"),
    "add button must say 'New scheduled item'"
  );
  assert.ok(
    !console_ts.includes("New directive"),
    "old 'New directive' button text must be gone"
  );
});

test("create button says Schedule not Create directive", () => {
  // The button inside the directive form should not say "Create directive"
  assert.ok(
    !console_ts.match(/onclick="createDirective\(\)">Create directive</),
    "button must not say 'Create directive'"
  );
});

test("new task form opens in session column", () => {
  assert.ok(
    console_ts.includes("showNewTaskPanel"),
    "console.ts must contain showNewTaskPanel function"
  );
  // The New task button must call showNewTaskPanel, not toggleForm
  assert.ok(
    !console_ts.includes("onclick=\"toggleForm('taskForm')\""),
    "New task button must not call toggleForm directly"
  );
});
