import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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
  assert.match((await commandTurnOverride("start directive release watcher", deps))?.reply ?? "", /Started scheduled item/);
  assert.match((await commandTurnOverride("trigger release verification", deps))?.reply ?? "", /queued release verification/);

  assert.deepEqual(actions, [
    "retry:failed1",
    "model:abc123:qwen",
    "directive:dir1:active",
    "task:Release verification",
  ]);
});

test("commandTurnOverride queues explicit Browser Lane voice requests as Browser Lane tasks", async () => {
  const created: Record<string, unknown>[] = [];
  const out = await commandTurnOverride("Use browser lane to search Tesla Model S price", {
    synthesize: async () => "",
    createTask: async (payload) => {
      created.push(payload);
      return { _id: "task-browser", title: String(payload.title) };
    },
  });

  assert.match(out?.reply ?? "", /queued Browser Lane/i);
  assert.equal(out?.command.kind, "browserLaneTask");
  assert.equal(out?.command.taskId, "task-browser");
  assert.equal(created[0]?.source, "browser-lane");
  assert.deepEqual((created[0]?.output as Record<string, unknown>)?.browserLaneVoice, {
    args: { mode: "search", query: "Tesla Model S price" },
  });
});

test("commandTurnOverride queues Mail Lane delete requests for review and does not delete", async () => {
  const created: Record<string, unknown>[] = [];
  const out = await commandTurnOverride("delete the latest email from Stripe", {
    sessionId: "mail-delete",
    synthesize: async () => "",
    createTask: async (payload) => {
      created.push(payload);
      return { _id: "task-mail-delete", title: String(payload.title) };
    },
  });

  assert.ok(out);
  assert.equal(out?.command.kind, "mailDeleteTask");
  assert.equal(out?.command.taskId, "task-mail-delete");
  assert.match(out?.reply ?? "", /queued/i);
  assert.match(out?.reply ?? "", /review/i);
  assert.match(out?.reply ?? "", /No email has been deleted/i);

  assert.equal(created.length, 1);
  assert.equal(created[0]?.source, "mail-lane");
  assert.equal(created[0]?.status, "review");
  assert.equal(created[0]?.project, "inbox");
  assert.match(String(created[0]?.title), /Delete email review/i);
  assert.match(String(created[0]?.description), /Do not delete anything yet/i);
  assert.deepEqual((created[0]?.output as Record<string, unknown>)?.mailDeleteVoiceRequest, {
    query: "latest email from Stripe",
    destructive: true,
    source: "voice",
  });
  assert.doesNotMatch(JSON.stringify(created[0]), /password|secret|token|cookie/i);
});

test("commandTurnOverride answers weather inline from the saved personalization location and spawns no task", async () => {
  const created: Record<string, unknown>[] = [];
  const seen: Array<{ location: string; when: string }> = [];
  const out = await commandTurnOverride("what's the weather today", {
    sessionId: "weather-saved",
    synthesize: async () => "",
    getLocation: () => "San Francisco, CA",
    fetchWeather: async (location, when) => {
      seen.push({ location, when });
      return {
        ok: true,
        report: { location: "San Francisco", when, tempNow: 61, high: 68, low: 54, conditions: "Overcast", precipChance: 60, units: "fahrenheit" },
      };
    },
    createTask: async (payload) => { created.push(payload); return { _id: "should-not-happen", title: String(payload.title) }; },
  });

  assert.ok(out);
  assert.equal(out?.command.kind, "weather");
  assert.equal(out?.command.taskId, undefined);
  assert.match(out?.reply ?? "", /San Francisco/);
  assert.match(out?.reply ?? "", /61/);
  assert.match(out?.reply ?? "", /overcast/i);
  assert.match(out?.reply ?? "", /60% chance of rain/);
  assert.deepEqual(seen, [{ location: "San Francisco, CA", when: "today" }]);
  assert.equal(created.length, 0); // no generic agent task for simple weather
});

test("commandTurnOverride asks for location once when none is configured and neither fetches nor spawns", async () => {
  let fetched = false;
  const created: unknown[] = [];
  const out = await commandTurnOverride("what's the weather today", {
    sessionId: "weather-missing",
    synthesize: async () => "",
    getLocation: () => "",
    fetchWeather: async () => { fetched = true; return { ok: false, error: "fetch_failed" }; },
    createTask: async (payload) => { created.push(payload); return { _id: "x", title: String(payload.title) }; },
  });

  assert.ok(out);
  assert.equal(out?.command.kind, "weather");
  assert.equal(out?.command.detail, "needs-location");
  assert.match(out?.reply ?? "", /Settings/);
  assert.match(out?.reply ?? "", /Personalization/);
  assert.equal(fetched, false);
  assert.equal(created.length, 0);
});

test("commandTurnOverride uses an inline city without any saved location", async () => {
  const seen: Array<{ location: string; when: string }> = [];
  const out = await commandTurnOverride("what's the weather in Paris", {
    sessionId: "weather-paris",
    synthesize: async () => "",
    getLocation: () => "",
    fetchWeather: async (location, when) => {
      seen.push({ location, when });
      return { ok: true, report: { location: "Paris", when, tempNow: 70, high: 75, low: 60, conditions: "Clear", precipChance: 5, units: "fahrenheit" } };
    },
  });

  assert.ok(out);
  assert.match(out?.reply ?? "", /Paris/);
  assert.deepEqual(seen, [{ location: "Paris", when: "today" }]);
});

test("the weather voice path never reads Claude project memory", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "weather.ts"), "utf8") + readFileSync(join(here, "command-turn.ts"), "utf8");
  assert.doesNotMatch(src, /\.claude\/projects|MEMORY\.md/);
});

test("non-command chit-chat still falls through (returns null)", async () => {
  const out = await commandTurnOverride("tell me a joke", { synthesize: async () => "" });
  assert.equal(out, null);
});
