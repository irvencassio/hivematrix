import test from "node:test";
import assert from "node:assert/strict";
import {
  detectCommandIntent,
  detectOpenClawIntent,
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

test("detects time-specific reminders as scheduled reminders before generic tasks", () => {
  assert.deepEqual(detectCommandIntent("remind me at 5:35 PM to go look up something"), {
    kind: "scheduledReminder",
    reminderWhenText: "5:35 PM",
    reminderText: "go look up something",
  });
  assert.deepEqual(detectCommandIntent("remind me at 2pm video bible idea"), {
    kind: "scheduledReminder",
    reminderWhenText: "2pm",
    reminderText: "video bible idea",
  });
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

test("detects scheduled-items phrasing as directives", () => {
  assert.equal(detectCommandIntent("what are my scheduled items").kind, "directives");
  assert.equal(detectCommandIntent("what scheduled items are active").kind, "directives");
  assert.equal(detectCommandIntent("show scheduled items").kind, "directives");
});

// ── OpenClaw / Vale intent detection ─────────────────────────────────────────

test("detectOpenClawIntent: detects all four wake-phrase forms", () => {
  const phrases = [
    "ask Vale to summarize today's email",
    "ask Vale summarize today's email",
    "hey Vale, summarize today's email",
    "hey Vale summarize today's email",
    "ask OpenClaw to summarize today's email",
    "ask OpenClaw summarize today's email",
    "hey OpenClaw, summarize today's email",
    "hey OpenClaw summarize today's email",
  ];
  for (const phrase of phrases) {
    const result = detectOpenClawIntent(phrase);
    assert.ok(result, `expected match for: ${phrase}`);
    assert.equal(result?.kind, "openclawAsk", phrase);
  }
});

test("detectOpenClawIntent: strips wake phrase and returns only the user request", () => {
  assert.equal(detectOpenClawIntent("ask Vale to summarize today's email")?.openclaw?.prompt, "summarize today's email");
  assert.equal(detectOpenClawIntent("hey Vale, summarize today's email")?.openclaw?.prompt, "summarize today's email");
  assert.equal(detectOpenClawIntent("ask OpenClaw summarize today's email")?.openclaw?.prompt, "summarize today's email");
  assert.equal(detectOpenClawIntent("ask Vale to check my schedule")?.openclaw?.prompt, "check my schedule");
  assert.equal(detectOpenClawIntent("hey OpenClaw, what's on my calendar")?.openclaw?.prompt, "what's on my calendar");
});

test("detectOpenClawIntent: strips trailing punctuation from prompt", () => {
  assert.equal(detectOpenClawIntent("ask Vale to summarize today's email.")?.openclaw?.prompt, "summarize today's email");
  assert.equal(detectOpenClawIntent("hey Vale, what are my tasks?")?.openclaw?.prompt, "what are my tasks");
  assert.equal(detectOpenClawIntent("ask OpenClaw what's new!")?.openclaw?.prompt, "what's new");
});

test("detectOpenClawIntent: sets assistant to 'vale' for 'Vale' phrasing", () => {
  assert.equal(detectOpenClawIntent("ask Vale to do something")?.openclaw?.assistant, "vale");
  assert.equal(detectOpenClawIntent("hey Vale, do something")?.openclaw?.assistant, "vale");
});

test("detectOpenClawIntent: sets assistant to 'openclaw' for 'OpenClaw' phrasing", () => {
  assert.equal(detectOpenClawIntent("ask OpenClaw to do something")?.openclaw?.assistant, "openclaw");
  assert.equal(detectOpenClawIntent("hey OpenClaw, do something")?.openclaw?.assistant, "openclaw");
});

test("detectOpenClawIntent: defaults sessionKey to agent:main:main", () => {
  assert.equal(detectOpenClawIntent("ask Vale to summarize today's email")?.openclaw?.sessionKey, "agent:main:main");
  assert.equal(detectOpenClawIntent("hey OpenClaw, check the news")?.openclaw?.sessionKey, "agent:main:main");
});

test("detectOpenClawIntent: is case-insensitive for the wake phrase", () => {
  assert.equal(detectOpenClawIntent("ASK VALE TO summarize today's email")?.kind, "openclawAsk");
  assert.equal(detectOpenClawIntent("HEY OPENCLAW summarize today's email")?.kind, "openclawAsk");
  assert.equal(detectOpenClawIntent("Ask Vale To summarize")?.kind, "openclawAsk");
});

test("detectOpenClawIntent: returns null when no content follows the wake phrase", () => {
  // Comma-only or space-only after wake phrase — (.+) fails to match
  assert.equal(detectOpenClawIntent("hey Vale,"), null);
  assert.equal(detectOpenClawIntent("ask OpenClaw "), null);
  assert.equal(detectOpenClawIntent("hey OpenClaw,  "), null);
});

test("detectOpenClawIntent: returns null for non-Vale/OpenClaw utterances", () => {
  assert.equal(detectOpenClawIntent("summarize today's email"), null);
  assert.equal(detectOpenClawIntent("ask Siri to do something"), null);
  assert.equal(detectOpenClawIntent("tell me the weather"), null);
  assert.equal(detectOpenClawIntent(""), null);
});

test("detectCommandIntent: routes openclawAsk BEFORE retryFailedTask", () => {
  // "retry failed tasks" is also a valid Jarvis intent — Vale routing must win
  const result = detectCommandIntent("ask Vale to retry failed tasks");
  assert.equal(result.kind, "openclawAsk");
  assert.equal(result.openclaw?.prompt, "retry failed tasks");
});

test("detectCommandIntent: routes openclawAsk BEFORE createTask", () => {
  const result = detectCommandIntent("ask Vale to create a task to email the investors");
  assert.equal(result.kind, "openclawAsk");
  assert.equal(result.openclaw?.prompt, "create a task to email the investors");
});

test("detectCommandIntent: routes openclawAsk BEFORE briefing", () => {
  const result = detectCommandIntent("hey Vale, good morning brief me");
  assert.equal(result.kind, "openclawAsk");
  assert.equal(result.openclaw?.prompt, "good morning brief me");
});

test("detectCommandIntent: does not swallow generic briefing or task utterances", () => {
  assert.equal(detectCommandIntent("good morning").kind, "briefing");
  assert.equal(detectCommandIntent("retry failed task").kind, "retryFailedTask");
  assert.equal(detectCommandIntent("create a task to email the investors").kind, "createTask");
});

test("detectOpenClawIntent: multi-word prompt is preserved verbatim after wake phrase", () => {
  const result = detectOpenClawIntent("ask Vale to read the latest news and summarize the top 3 stories");
  assert.equal(result?.openclaw?.prompt, "read the latest news and summarize the top 3 stories");
});

test("detectOpenClawIntent: handles extra comma and whitespace after wake phrase", () => {
  assert.equal(detectOpenClawIntent("hey Vale,   check my email")?.openclaw?.prompt, "check my email");
  assert.equal(detectOpenClawIntent("ask OpenClaw,  what's new")?.openclaw?.prompt, "what's new");
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

test("approvals reply speaks each pending item with its index", () => {
  const reply = approvalsReply([
    { title: "mail draft to Bob", kind: "tool" },
    { title: "browser step on Chase", kind: "checkpoint" },
  ]);
  assert.match(reply, /2 approvals waiting/);
  assert.match(reply, /one, mail draft to Bob/);
  assert.match(reply, /two, browser step on Chase/);
});

test("approvals reply caps the spoken list and notes how many more are waiting", () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ title: `item ${i + 1}`, kind: "tool" }));
  const reply = approvalsReply(items);
  assert.match(reply, /7 approvals waiting/);
  assert.match(reply, /one, item 1/);
  assert.match(reply, /five, item 5/);
  assert.doesNotMatch(reply, /item 6/);
  assert.match(reply, /and 2 more/);
});

test("resolved + scheduled + task + connectivity replies", () => {
  assert.match(resolvedReply("approve", "send email"), /Approved: send email/);
  assert.match(resolvedReply("deny", null), /Denied/);
  assert.match(directivesReply([{ goal: "ship news", status: "active" }]), /1 active scheduled item: ship news/);
  assert.match(directivesReply([]), /no scheduled items/);
  assert.match(createdTaskReply("call the bank"), /queued a task: call the bank/);
  assert.match(connectivityReply("offline"), /offline/);
  assert.match(setConnectivityReply("auto"), /automatic/);
});

test("deepThink intent: 'think hard about X' variants capture the question", () => {
  assert.deepEqual(detectCommandIntent("think hard about whether to price at 39 or 49"), {
    kind: "deepThink", thinkText: "whether to price at 39 or 49",
  });
  assert.equal(detectCommandIntent("think deeply about the launch plan").kind, "deepThink");
  assert.equal(detectCommandIntent("deep think the pricing model").kind, "deepThink");
  assert.equal(detectCommandIntent("give me your best thinking on hiring").kind, "deepThink");
  // Plain "think" is not enough — everyday speech must fall through
  assert.equal(detectCommandIntent("I think we should ship").kind, "none");
});

test("goals intents: query reads goals; standing/scheduled goals stay directives", () => {
  assert.equal(detectCommandIntent("what are my goals").kind, "goals");
  assert.equal(detectCommandIntent("read me my goals").kind, "goals");
  assert.equal(detectCommandIntent("what am I working toward").kind, "goals");
  assert.equal(detectCommandIntent("what are my standing goals").kind, "directives");
});

test("addGoal intent captures the goal text", () => {
  assert.deepEqual(detectCommandIntent("add a goal to get the annuity license by August"), {
    kind: "addGoal", goalText: "get the annuity license by August",
  });
  assert.equal(detectCommandIntent("my goal is to hit 10k MRR").kind, "addGoal");
  assert.equal(detectCommandIntent("my goal is to hit 10k MRR").goalText, "hit 10k MRR");
});

test("remember intent: 'remember that' is memory; 'remember to' stays a task", () => {
  assert.deepEqual(detectCommandIntent("remember that I prefer terse replies"), {
    kind: "remember", rememberText: "I prefer terse replies",
  });
  assert.equal(detectCommandIntent("note that the demo is on Tuesday").kind, "remember");
  assert.equal(detectCommandIntent("take a note: renew the cert").kind, "remember");
  assert.equal(detectCommandIntent("remember to call the accountant").kind, "createTask");
});

test("heartbeatNow intent", () => {
  assert.equal(detectCommandIntent("run a heartbeat").kind, "heartbeatNow");
  assert.equal(detectCommandIntent("run the pulse").kind, "heartbeatNow");
  assert.equal(detectCommandIntent("pulse now").kind, "heartbeatNow");
  assert.equal(detectCommandIntent("what's your pulse on the market").kind, "none");
});

test("review regressions: heartbeat is anchored; tasks/reminders keep their verbs", () => {
  assert.equal(detectCommandIntent("create a task to run a heartbeat check on the API").kind, "createTask");
  assert.equal(detectCommandIntent("remind me to do a pulse check with the team").kind, "createTask");
  assert.equal(detectCommandIntent("run a heartbeat").kind, "heartbeatNow");
  assert.equal(detectCommandIntent("heartbeat now").kind, "heartbeatNow");
  assert.equal(detectCommandIntent("run the pulse now!").kind, "heartbeatNow");
});

test("review regressions: 'deep thinking...' does not mangle-match; trivial notes fall through", () => {
  const dt = detectCommandIntent("deep thinking about my goals");
  assert.notEqual(dt.thinkText, "ing about my goals");
  assert.equal(detectCommandIntent("note that down").kind, "none");
  assert.equal(detectCommandIntent("note that the demo is Tuesday").kind, "remember");
});
