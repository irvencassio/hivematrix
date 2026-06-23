import test from "node:test";
import assert from "node:assert/strict";
import { detectCommandIntent } from "./command-intent";
import {
  emptyCommandContext,
  rememberApprovalList,
  rememberTurn,
  resolveApprovalReference,
} from "./command-context";

const approvals = [
  { kind: "checkpoint" as const, taskId: "task-1", timestamp: "checkpoint-plan", title: "Review release plan" },
  { kind: "tool" as const, taskId: "task-2", timestamp: "1710000000", title: "Run deploy script" },
];

test("listed approvals become the focused voice context", () => {
  const context = rememberApprovalList(emptyCommandContext(), approvals);

  assert.equal(context.approvals.length, 2);
  assert.deepEqual(context.focusedApproval, { taskId: "task-1", timestamp: "checkpoint-plan" });
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("approve it"), context, approvals), {
    status: "resolved",
    item: approvals[0],
  });
});

test("approval ordinals resolve against the current approval list", () => {
  const context = rememberApprovalList(emptyCommandContext(), approvals);

  assert.deepEqual(resolveApprovalReference(detectCommandIntent("approve the second one"), context, approvals), {
    status: "resolved",
    item: approvals[1],
  });
});

test("multiple approvals without context ask for disambiguation", () => {
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("approve it"), emptyCommandContext(), approvals), {
    status: "ambiguous",
    choices: approvals,
  });
});

test("command context keeps a short rolling turn history", () => {
  let context = emptyCommandContext();
  for (let i = 0; i < 8; i += 1) {
    context = rememberTurn(context, { kind: "heard", text: `turn ${i}` });
  }

  assert.equal(context.turns.length, 5);
  assert.deepEqual(context.turns.map((turn) => turn.text), ["turn 3", "turn 4", "turn 5", "turn 6", "turn 7"]);
});
