import test from "node:test";
import assert from "node:assert/strict";

import { getTaskSessionMeta } from "./task-session-state";

test("getTaskSessionMeta returns live metadata for in-progress Codex tasks", () => {
  assert.deepEqual(
    getTaskSessionMeta({
      status: "in_progress",
      model: "codex:gpt-5.4",
      sessionId: "thread-1",
      reviewState: null,
    }),
    {
      key: "live",
      label: "Live Session",
      tone: "live",
      title: "Live task session",
      body: "This task is still in progress. You can steer the active Codex run from the session panel.",
      actionLabel: "Steer",
    },
  );
});

test("getTaskSessionMeta returns needs-input metadata for review tasks waiting on a human", () => {
  assert.deepEqual(
    getTaskSessionMeta({
      status: "review",
      model: "claude-sonnet-4-6",
      sessionId: "session-1",
      reviewState: "needs_input",
    }),
    {
      key: "needs_input",
      label: "Needs Input",
      tone: "attention",
      title: "Needs your input",
      body: "The agent is waiting on a human answer before it can continue this task.",
      actionLabel: "Answer",
    },
  );
});

test("getTaskSessionMeta defaults review tasks to ready-for-review metadata", () => {
  assert.deepEqual(
    getTaskSessionMeta({
      status: "review",
      model: "claude-sonnet-4-6",
      sessionId: "session-2",
      reviewState: null,
    }),
    {
      key: "ready_for_review",
      label: "Ready for Review",
      tone: "review",
      title: "Ready for review",
      body: "This task reached a useful stopping point and is waiting for your review or approval.",
      actionLabel: "Reply",
    },
  );
});
