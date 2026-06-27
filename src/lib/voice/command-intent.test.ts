import test from "node:test";
import assert from "node:assert/strict";
import {
  detectCommandIntent,
  boardReply, approvalsReply, resolvedReply, directivesReply,
  createdTaskReply, connectivityReply, setConnectivityReply,
} from "./command-intent";

test("detects board status queries", () => {
  for (const s of ["what's on my board", "board status", "how many tasks are running", "what are you working on", "give me a status report"]) {
    assert.equal(detectCommandIntent(s).kind, "board", s);
  }
});

test("detects approvals query vs approve/deny command", () => {
  assert.equal(detectCommandIntent("anything to approve?").kind, "approvalsList");
  assert.equal(detectCommandIntent("any pending approvals").kind, "approvalsList");
  assert.equal(detectCommandIntent("what needs my approval").kind, "approvalsList");
  assert.equal(detectCommandIntent("approve it").kind, "approve");
  assert.deepEqual(detectCommandIntent("approve the first one"), { kind: "approve", ordinal: 1 });
  assert.deepEqual(detectCommandIntent("approve the second one"), { kind: "approve", ordinal: 2 });
  assert.equal(detectCommandIntent("deny that").kind, "deny");
  assert.equal(detectCommandIntent("reject it").kind, "deny");
});

test("detects Jarvis V2 operator intents", () => {
  assert.equal(detectCommandIntent("good morning").kind, "briefing");
  assert.equal(detectCommandIntent("brief me").kind, "briefing");
  assert.equal(detectCommandIntent("usage").kind, "usage");
  assert.equal(detectCommandIntent("show analytics").kind, "analytics");
  assert.equal(detectCommandIntent("retry failed task").kind, "retryFailedTask");
  assert.deepEqual(detectCommandIntent("set task abc123 to qwen"), { kind: "setTaskModel", taskRef: "abc123", model: "qwen" });
  assert.deepEqual(detectCommandIntent("start directive inbox sweep"), { kind: "startDirective", directiveText: "inbox sweep" });
  assert.deepEqual(detectCommandIntent("pause directive release watcher"), { kind: "pauseDirective", directiveText: "release watcher" });
  assert.equal(detectCommandIntent("trigger release verification").kind, "triggerReleaseVerification");
});

test("detects create-task and extracts the text", () => {
  assert.deepEqual(detectCommandIntent("create a task to email the investors"), { kind: "createTask", taskText: "email the investors" });
  assert.deepEqual(detectCommandIntent("add a task review the Q3 numbers"), { kind: "createTask", taskText: "review the Q3 numbers" });
  assert.deepEqual(detectCommandIntent("remind me to call the bank"), { kind: "createTask", taskText: "call the bank" });
});

test("detects Mail Lane delete requests without deleting immediately", () => {
  assert.deepEqual(detectCommandIntent("delete the latest email from Stripe"), {
    kind: "mailDeleteTask",
    mailDelete: { query: "latest email from Stripe", destructive: true },
  });
  assert.deepEqual(detectCommandIntent("trash emails from noreply@example.com about receipts"), {
    kind: "mailDeleteTask",
    mailDelete: { query: "emails from noreply@example.com about receipts", destructive: true },
  });
  assert.equal(detectCommandIntent("delete the second approval").kind, "none");
});

test("detects weather intent before generic task creation", () => {
  assert.deepEqual(detectCommandIntent("What's the weather today?"), { kind: "weather", weatherWhen: "today" });
  assert.equal(detectCommandIntent("what's the weather").kind, "weather");
  assert.equal(detectCommandIntent("how's the weather").kind, "weather");
  assert.equal(detectCommandIntent("forecast").kind, "weather");
  assert.deepEqual(detectCommandIntent("weather tomorrow"), { kind: "weather", weatherWhen: "tomorrow" });
  assert.deepEqual(detectCommandIntent("what's the forecast"), { kind: "weather", weatherWhen: "tomorrow" });
  assert.deepEqual(detectCommandIntent("do I need an umbrella"), { kind: "weather", weatherWhen: "today" });
  assert.deepEqual(detectCommandIntent("how cold is it"), { kind: "weather", weatherWhen: "today" });
  assert.deepEqual(detectCommandIntent("how hot is it outside"), { kind: "weather", weatherWhen: "today" });
  assert.equal(detectCommandIntent("is it going to rain").kind, "weather");
});

test("weather intent extracts an inline city and strips trailing time words", () => {
  assert.deepEqual(detectCommandIntent("what's the weather in Paris"), { kind: "weather", weatherWhen: "today", weatherCity: "Paris" });
  assert.deepEqual(detectCommandIntent("what's the weather in New York tomorrow"), { kind: "weather", weatherWhen: "tomorrow", weatherCity: "New York" });
  // "in the morning" is a time phrase, not a city.
  assert.deepEqual(detectCommandIntent("is it going to rain in the morning"), { kind: "weather", weatherWhen: "today" });
});

test("weather detection does not swallow an explicit create-task", () => {
  assert.equal(detectCommandIntent("create a task to check the weather tomorrow").kind, "createTask");
});

test("detects explicit Browser Lane task requests", () => {
  assert.deepEqual(detectCommandIntent("Use browser lane to search Tesla Model S price"), {
    kind: "browserLaneTask",
    browserLane: { mode: "search", query: "Tesla Model S price" },
  });
});

test("detects connectivity query and set", () => {
  assert.equal(detectCommandIntent("are we online?").kind, "connectivity");
  assert.equal(detectCommandIntent("connectivity status").kind, "connectivity");
  assert.deepEqual(detectCommandIntent("go offline"), { kind: "setConnectivity", mode: "offline" });
  assert.deepEqual(detectCommandIntent("switch to local only"), { kind: "setConnectivity", mode: "local-only" });
  assert.deepEqual(detectCommandIntent("go back online"), { kind: "setConnectivity", mode: "cloud-ok" });
});

test("detects directives and falls through otherwise", () => {
  assert.equal(detectCommandIntent("what are my directives").kind, "directives");
  assert.equal(detectCommandIntent("tell me a joke").kind, "none");
  assert.equal(detectCommandIntent("").kind, "none");
});

test("board reply summarizes lanes", () => {
  assert.match(boardReply({ backlog: 2, in_progress: 1, review: 1, done: 5, failed: 0 }), /2 queued.*1 in progress.*1 in review.*5 done/);
  assert.match(boardReply({}), /empty/);
});

test("approvals reply guides the next voice action", () => {
  assert.match(approvalsReply([]), /Nothing/);
  assert.match(approvalsReply([{ title: "send email", kind: "tool" }]), /One approval.*send email.*approve it/);
  assert.match(approvalsReply([{ title: "a", kind: "tool" }, { title: "b", kind: "content" }]), /2 approvals/);
});

test("resolved + directive + task + connectivity replies", () => {
  assert.match(resolvedReply("approve", "send email"), /Approved: send email/);
  assert.match(resolvedReply("deny", null), /Denied/);
  assert.match(directivesReply([{ goal: "ship news", status: "active" }]), /1 active directive: ship news/);
  assert.match(directivesReply([]), /no standing directives/);
  assert.match(createdTaskReply("call the bank"), /queued a task: call the bank/);
  assert.match(connectivityReply("offline"), /offline/);
  assert.match(setConnectivityReply("auto"), /automatic/);
});
