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

// ---------------------------------------------------------------------------
// Voice approval matcher: index / kind keyword / substring / ambiguous / none.
// Pure — no context/focus, so only the descriptive text (or its absence)
// decides the outcome.

const mixed = [
  { kind: "tool" as const, taskId: "task-mail", timestamp: "1", title: "mail_send: draft to Bob" },
  { kind: "checkpoint" as const, taskId: "task-browser", timestamp: "2", title: "browser step on Chase" },
  { kind: "content" as const, taskId: "task-post", timestamp: "3", title: "LinkedIn post about Q3" },
];

test("matcher: index — ordinal wins outright, even with no context", () => {
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("approve number two"), emptyCommandContext(), mixed), {
    status: "resolved",
    item: mixed[1],
  });
});

test("matcher: kind keyword — 'approve the checkpoint' resolves the one checkpoint pending", () => {
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("approve the checkpoint"), emptyCommandContext(), mixed), {
    status: "resolved",
    item: mixed[1],
  });
});

test("matcher: substring — 'deny the mail draft' resolves by a unique substring of the title", () => {
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("deny the mail draft"), emptyCommandContext(), mixed), {
    status: "resolved",
    item: mixed[0],
  });
});

test("matcher: ambiguous — descriptive text that matches more than one pending item asks which", () => {
  const twoTools = [
    { kind: "tool" as const, taskId: "task-a", timestamp: "1", title: "mail_send: draft to Bob" },
    { kind: "tool" as const, taskId: "task-b", timestamp: "2", title: "mail_send: draft to Ann" },
  ];
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("approve the mail draft"), emptyCommandContext(), twoTools), {
    status: "ambiguous",
    choices: twoTools,
  });
});

test("matcher: none — no pending approvals at all", () => {
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("approve it"), emptyCommandContext(), []), {
    status: "none",
  });
});

test("matcher: none — an ordinal past the end of the list", () => {
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("approve number five"), emptyCommandContext(), mixed), {
    status: "none",
  });
});

test("matcher: an intent that isn't approve/deny never resolves an approval", () => {
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("what's on my board"), emptyCommandContext(), mixed), {
    status: "none",
  });
});

test("matcher: descriptive text that matches nothing falls back to focus/single/ambiguous rather than failing outright", () => {
  // Only one pending approval — an off/vague description still resolves it
  // (mirrors a human assistant: there's only one thing it could mean).
  const solo = [mixed[0]];
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("approve that thing"), emptyCommandContext(), solo), {
    status: "resolved",
    item: solo[0],
  });
  // Multiple pending, description matches none of them — ask which, never guess.
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("approve the thing"), emptyCommandContext(), mixed), {
    status: "ambiguous",
    choices: mixed,
  });
});

test("matcher: stuck items are excluded from approve/deny targets", () => {
  const withStuck = [...mixed, { kind: "stuck" as const, taskId: "task-stuck", timestamp: "4", title: "Stuck: retry limit" }];
  assert.deepEqual(resolveApprovalReference(detectCommandIntent("approve the checkpoint"), emptyCommandContext(), withStuck), {
    status: "resolved",
    item: mixed[1],
  });
});
