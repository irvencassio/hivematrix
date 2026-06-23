import test from "node:test";
import assert from "node:assert/strict";
import { commandTurnOverride } from "./command-turn";
import type { ApprovalQueueItem } from "@/lib/approvals/queue";

const approvals: ApprovalQueueItem[] = [
  { kind: "checkpoint", taskId: "t1", timestamp: "checkpoint-plan", title: "Review plan", detail: "", options: ["approve", "deny"] },
  { kind: "tool", taskId: "t2", timestamp: "123", title: "Run deploy", detail: "", options: ["approve", "deny"] },
];

test("commandTurnOverride asks for disambiguation when multiple approvals have no context", async () => {
  const out = await commandTurnOverride("approve it", {
    sessionId: "ambiguous",
    buildApprovalQueue: async () => approvals,
    synthesize: async () => "",
  });

  assert.ok(out);
  assert.match(out?.reply ?? "", /Which approval/);
  assert.match(out?.reply ?? "", /first/);
});

test("commandTurnOverride resolves focused approval after listing approvals", async () => {
  const resolved: Array<{ taskId: string; timestamp: string; decision: string; via: string }> = [];
  const deps = {
    sessionId: "approval-context",
    buildApprovalQueue: async () => approvals,
    resolveApproval: async (taskId: string, timestamp: string, decision: "approve" | "done" | "denied", via: string) => {
      resolved.push({ taskId, timestamp, decision, via });
    },
    synthesize: async () => "",
  };

  await commandTurnOverride("anything to approve", deps);
  const out = await commandTurnOverride("approve it", deps);

  assert.ok(out);
  assert.match(out?.reply ?? "", /Approved: Review plan/);
  assert.deepEqual(resolved, [{ taskId: "t1", timestamp: "checkpoint-plan", decision: "approve", via: "voice" }]);
});

test("commandTurnOverride returns briefing and usage summaries", async () => {
  const out = await commandTurnOverride("good morning", {
    sessionId: "briefing",
    buildApprovalQueue: async () => approvals.slice(0, 1),
    listDirectives: async () => [{ goal: "Inbox sweep", status: "active" }],
    listFailedTasks: async () => [{ _id: "f1", title: "Fix build" }],
    getUsage: async () => ({ totalCost: 2.5, todayCost: 1, taskCount: 3, todayTaskCount: 1 }),
    synthesize: async () => "",
  });

  assert.ok(out);
  assert.match(out?.reply ?? "", /1 approval/);
  assert.match(out?.reply ?? "", /Fix build/);
  assert.match(out?.reply ?? "", /Inbox sweep/);
});

test("commandTurnOverride retries failed tasks, sets task model, updates directives, and queues release verification", async () => {
  const actions: string[] = [];
  const deps = {
    sessionId: "actions",
    listFailedTasks: async () => [{ _id: "failed1", title: "Broken build" }],
    retryTask: async (id: string) => { actions.push(`retry:${id}`); },
    updateTaskModel: async (id: string, model: string) => { actions.push(`model:${id}:${model}`); return { title: "Important task" }; },
    listDirectives: async () => [{ _id: "dir1", goal: "Release watcher", status: "sleeping" }],
    updateDirective: async (id: string, fields: Record<string, unknown>) => { actions.push(`directive:${id}:${fields.status}`); },
    createTask: async (payload: Record<string, unknown>) => { actions.push(`task:${payload.title}`); return { _id: "release1", title: String(payload.title) }; },
    synthesize: async () => "",
  };

  assert.match((await commandTurnOverride("retry failed task", deps))?.reply ?? "", /Retrying Broken build/);
  assert.match((await commandTurnOverride("set task abc123 to qwen", deps))?.reply ?? "", /Set Important task to qwen/);
  assert.match((await commandTurnOverride("start directive release watcher", deps))?.reply ?? "", /Started directive/);
  assert.match((await commandTurnOverride("trigger release verification", deps))?.reply ?? "", /queued release verification/);

  assert.deepEqual(actions, [
    "retry:failed1",
    "model:abc123:qwen",
    "directive:dir1:active",
    "task:Release verification",
  ]);
});
