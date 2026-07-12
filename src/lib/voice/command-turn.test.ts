import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { commandTurnOverride, deliverOpenClawReply } from "./command-turn";
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

test("commandTurnOverride lists pending approvals with a spoken index each", async () => {
  const out = await commandTurnOverride("anything to approve", {
    sessionId: "list-with-index",
    buildApprovalQueue: async () => approvals,
    synthesize: async () => "",
  });

  assert.ok(out);
  assert.match(out?.reply ?? "", /2 approvals waiting/);
  assert.match(out?.reply ?? "", /one, Review plan/);
  assert.match(out?.reply ?? "", /two, Run deploy/);
});

test("commandTurnOverride resolves an approval by kind keyword or a unique title substring, without listing first", async () => {
  const resolved: Array<{ taskId: string; timestamp: string; decision: string; via: string }> = [];
  const deps = {
    sessionId: "match-by-text",
    buildApprovalQueue: async () => approvals,
    resolveApproval: async (taskId: string, timestamp: string, decision: "approve" | "done" | "denied", via: string) => {
      resolved.push({ taskId, timestamp, decision, via });
    },
    synthesize: async () => "",
  };

  const byKind = await commandTurnOverride("approve the checkpoint", deps);
  assert.match(byKind?.reply ?? "", /Approved: Review plan/);

  const bySubstring = await commandTurnOverride("deny the deploy", deps);
  assert.match(bySubstring?.reply ?? "", /Denied: Run deploy/);

  assert.deepEqual(resolved, [
    { taskId: "t1", timestamp: "checkpoint-plan", decision: "approve", via: "voice" },
    { taskId: "t2", timestamp: "123", decision: "denied", via: "voice" },
  ]);
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

test("commandTurnOverride routes ask Vale requests to OpenClaw with the wake phrase stripped", async () => {
  const calls: Array<{ assistant: string; prompt: string; sessionKey: string }> = [];
  const out = await commandTurnOverride("ask Vale to summarize today's email", {
    sessionId: "vale-openclaw",
    synthesize: async () => "",
    askOpenClaw: async (request) => {
      calls.push(request);
      return { ok: true, available: true, sessionKey: request.sessionKey, runId: "run-vale", reason: null };
    },
  });

  assert.ok(out);
  assert.equal(out?.command.kind, "openclawAsk");
  assert.equal(out?.command.detail, "openclaw:vale:run-vale");
  assert.match(out?.reply ?? "", /asked Vale/i);
  assert.deepEqual(calls, [{
    assistant: "vale",
    prompt: "summarize today's email",
    sessionKey: "agent:main:main",
  }]);
});

test("commandTurnOverride returns a spoken OpenClaw unavailable reply", async () => {
  const out = await commandTurnOverride("hey OpenClaw, summarize today's email", {
    sessionId: "openclaw-unavailable",
    synthesize: async () => "",
    askOpenClaw: async (request) => ({
      ok: false,
      available: false,
      sessionKey: request.sessionKey,
      runId: null,
      reason: "OpenClaw Gateway is not reachable.",
    }),
  });

  assert.ok(out);
  assert.equal(out?.command.kind, "openclawAsk");
  assert.equal(out?.command.detail, "openclaw:openclaw:unavailable");
  assert.match(out?.reply ?? "", /couldn't reach OpenClaw/i);
  assert.match(out?.reply ?? "", /Gateway is not reachable/i);
});

test("commandTurnOverride broadcasts voice:result when Vale reply arrives asynchronously", async () => {
  const broadcasts: Array<{ event: string; data: unknown }> = [];
  const sentAt = new Date().toISOString();

  const out = await commandTurnOverride("ask Vale to summarize today's email", {
    sessionId: "vale-async",
    synthesize: async () => "",
    askOpenClaw: async (request) => ({
      ok: true,
      available: true,
      sessionKey: request.sessionKey,
      runId: "run-async",
      reason: null,
      gatewayUrl: "ws://127.0.0.1:18789",
      sentAt,
    }),
    pollOpenClawReply: async () => ({
      found: true,
      text: "You have 5 emails from today. The most important is from your manager.",
      reason: null,
    }),
    broadcast: (event, data) => broadcasts.push({ event, data }),
  });

  // Immediate ack — voice turn completes synchronously
  assert.ok(out);
  assert.equal(out?.command.kind, "openclawAsk");
  assert.match(out?.reply ?? "", /asked Vale/i);
  assert.match(out?.reply ?? "", /read it back/i);

  // Wait for the async delivery microtasks to drain
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].event, "voice:result");
  const data = broadcasts[0].data as Record<string, unknown>;
  assert.equal(data.sessionId, "vale-async");
  assert.equal(data.ok, true);
  assert.match(String(data.text), /email/i);
  assert.equal(typeof data.audioBase64, "string");
});

test("commandTurnOverride broadcasts voice:result timeout message when Vale does not respond", async () => {
  const broadcasts: Array<{ event: string; data: unknown }> = [];
  const sentAt = new Date().toISOString();

  await commandTurnOverride("hey Vale, check my schedule", {
    sessionId: "vale-timeout",
    synthesize: async () => "",
    askOpenClaw: async (request) => ({
      ok: true,
      available: true,
      sessionKey: request.sessionKey,
      runId: "run-timeout",
      reason: null,
      gatewayUrl: "ws://127.0.0.1:18789",
      sentAt,
    }),
    pollOpenClawReply: async () => ({ found: false, text: null, reason: "OpenClaw response timed out." }),
    broadcast: (event, data) => broadcasts.push({ event, data }),
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].event, "voice:result");
  const data = broadcasts[0].data as Record<string, unknown>;
  assert.equal(data.ok, false);
  assert.match(String(data.text), /didn't respond/i);
});

test("commandTurnOverride sets a REAL Apple Reminder for 'remind me …' — never a do-nothing task", async () => {
  // Regression 2026-07-12: voice "remind me to X in 5 minutes" was classified as
  // createTask and queued a HiveMatrix task ("I queued a task: …") that never set
  // a reminder. Now an explicit reminder pre-routes to a real Apple Reminder and
  // must NOT create a task.
  const created: Record<string, unknown>[] = [];
  const reminderCalls: Array<{ name: string; due: string }> = [];

  const out = await commandTurnOverride("remind me to call the dentist in 5 minutes", {
    sessionId: "reminder-preroute",
    synthesize: async () => "",
    createReminder: async (args) => {
      reminderCalls.push(args);
      return `Reminder set: "${args.name}" for Sunday, July 12 at 2:19 PM.`;
    },
    createTask: async (payload) => {
      created.push(payload);
      return { _id: "should-not-happen", title: String(payload.title) };
    },
  });

  assert.ok(out);
  assert.equal(out?.command.kind, "scheduledReminder");
  assert.equal(out?.command.detail, "apple-reminder");
  assert.match(out?.reply ?? "", /Reminder set/i);
  assert.deepEqual(reminderCalls, [{ name: "call the dentist", due: "in 5 minutes" }]);
  assert.equal(created.length, 0, "must NOT queue a HiveMatrix task for a reminder");
});

test("commandTurnOverride: 'remind me at 5:35 PM to X' also sets a real Apple Reminder", async () => {
  const reminderCalls: Array<{ name: string; due: string }> = [];
  const out = await commandTurnOverride("remind me at 5:35 PM to go look up something", {
    sessionId: "reminder-preroute-clock",
    synthesize: async () => "",
    createReminder: async (args) => { reminderCalls.push(args); return `Reminder set: "${args.name}".`; },
    createTask: async () => { throw new Error("must not create a task for a reminder"); },
  });
  assert.ok(out);
  assert.equal(out?.command.kind, "scheduledReminder");
  assert.deepEqual(reminderCalls, [{ name: "go look up something", due: "at 5:35 PM" }]);
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

test("deliverOpenClawReply survives a throwing broadcast dep: logs, does not reject", async (t) => {
  const errors: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { errors.push(args.join(" ")); });

  await assert.doesNotReject(deliverOpenClawReply({
    deps: {
      synthesize: async () => "",
      pollOpenClawReply: async () => ({ found: true, text: "hello", reason: null }),
      broadcast: () => { throw new Error("socket gone"); },
    },
    sessionId: "vale-broadcast-crash",
    gatewayUrl: "ws://127.0.0.1:18789",
    sessionKey: "agent:main:main",
    sentAfter: new Date().toISOString(),
    assistant: "vale",
  }));

  assert.ok(errors.some((e) => e.includes("socket gone")), "broadcast failure should be logged");
});

// --- Voice memory + goals + heartbeat + deep think ---------------------------

test("goals + addGoal: voice reads and writes persona/GOALS.md with dedupe", async () => {
  const { mkdtempSync, rmSync, readFileSync: rf } = await import("node:fs");
  const { join: j } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = mkdtempSync(j(tmpdir(), "hm-voice-goals-"));
  const deps = { getBrainRoot: () => root, synthesize: async () => "" };

  const empty = await commandTurnOverride("what are my goals", deps);
  assert.match(empty!.reply, /No goals written down yet/);

  const added = await commandTurnOverride("add a goal to get the annuity license by August", deps);
  assert.match(added!.reply, /Added to your goals/);
  assert.match(rf(j(root, "persona", "GOALS.md"), "utf-8"), /## Active goals[\s\S]*annuity license by August/);

  const dup = await commandTurnOverride("my goal is to get the annuity license by August", deps);
  assert.match(dup!.reply, /already on the goal list/i);

  const readBack = await commandTurnOverride("what are my goals", deps);
  assert.match(readBack!.reply, /You're working toward: 1\. get the annuity license by August/);
  rmSync(root, { recursive: true, force: true });
});

test("remember: appends a dated voice note to persona memory", async () => {
  const { mkdtempSync, rmSync, readFileSync: rf } = await import("node:fs");
  const { join: j } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = mkdtempSync(j(tmpdir(), "hm-voice-note-"));
  const now = new Date("2026-07-04T15:30:00Z");
  const out = await commandTurnOverride("remember that the demo is on Tuesday", {
    getBrainRoot: () => root, synthesize: async () => "", now,
  });
  assert.match(out!.reply, /Noted/);
  const note = rf(j(root, "persona", "memory", "2026-07-04.md"), "utf-8");
  assert.match(note, /- 15:30 \(voice\): the demo is on Tuesday/);
  rmSync(root, { recursive: true, force: true });
});

test("heartbeatNow: acks immediately, delivers the outcome via voice:result (async, non-blocking)", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const mkDeps = (result: { ran: boolean; stoodDown: boolean; report: string | null }) => ({
    synthesize: async () => "",
    broadcast: (event: string, data: unknown) => events.push({ event, data: data as Record<string, unknown> }),
    runHeartbeat: async () => result,
  });

  const quiet = await commandTurnOverride("run a heartbeat", mkDeps({ ran: true, stoodDown: true, report: null }));
  assert.match(quiet!.reply, /Running a pulse/);
  assert.equal(quiet!.command.detail, "heartbeat:started");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(events.length, 1);
  assert.match(String(events[0].data.text), /nothing needs your attention/i);

  events.length = 0;
  await commandTurnOverride("pulse now", mkDeps({ ran: true, stoodDown: false, report: "Two approvals are waiting and the build is red." }));
  await new Promise((r) => setTimeout(r, 20));
  assert.match(String(events[0].data.text), /Two approvals are waiting/);

  const unwired = await commandTurnOverride("run a heartbeat", { synthesize: async () => "" });
  assert.match(unwired!.reply, /isn't wired up/);
});

test("deepThink: acks immediately, then broadcasts the framed answer via voice:result", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  let resolveThink!: (v: { answer: string; confidence: "high" | "medium" | "low"; reflected: boolean }) => void;
  const thinkPromise = new Promise<{ answer: string; confidence: "high" | "medium" | "low"; reflected: boolean }>((res) => { resolveThink = res; });

  const out = await commandTurnOverride("think hard about whether to price at 39 or 49", {
    synthesize: async () => "",
    broadcast: (event, data) => events.push({ event, data: data as Record<string, unknown> }),
    deepThink: () => thinkPromise,
  });
  assert.match(out!.reply, /thinking through|worth thinking/i);
  assert.equal(out!.command.detail, "deep-think:started");
  assert.equal(events.length, 0); // nothing broadcast yet

  resolveThink({ answer: "Charge 49 — the anchor supports it.", confidence: "high", reflected: false });
  await new Promise((r) => setTimeout(r, 20)); // let the background delivery flush

  assert.equal(events.length, 1);
  assert.equal(events[0].event, "voice:result");
  assert.match(String(events[0].data.text), /several angles and they agree.*Charge 49/);
  assert.equal(events[0].data.ok, true);
});

test("spokenDeepThinkReply frames low confidence honestly and caps length", async () => {
  const { spokenDeepThinkReply } = await import("./command-turn");
  const low = spokenDeepThinkReply({ answer: "Maybe.", confidence: "low", reflected: true });
  assert.match(low, /attempts disagreed.*re-checked.*Hold it loosely/);
  const long = spokenDeepThinkReply({ answer: "x".repeat(2000), confidence: "high", reflected: false });
  assert.ok(long.length < 1400);
  assert.match(long, /full answer is in the session/);
});
