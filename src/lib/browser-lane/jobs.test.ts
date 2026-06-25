import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBrowserBeeDesktopFallbackDescription,
  buildBrowserBeeHealthSnapshot,
  buildBrowserBeeJobSnapshot,
  buildBrowserBeeTaskDescription,
  buildBrowserBeeTaskRequestEnvelope,
  parseBrowserBeeJobCreate,
  readBrowserBeeDesktopFallbackEnabled,
  resolveBrowserBeeBacking,
} from "./jobs";

test("parseBrowserBeeJobCreate normalizes defaults from the URL and risk posture", () => {
  const payload = parseBrowserBeeJobCreate({
    project: "hive",
    startUrl: "https://app.example.com/inbox",
    objective: "Check the inbox and capture any new recruiter messages.",
    requiresLogin: true,
    runMode: "isolated",
  });

  assert.equal(payload.project, "hive");
  assert.equal(payload.startUrl, "https://app.example.com/inbox");
  assert.equal(payload.approvalMode, "confirm_external");
  assert.deepEqual(payload.allowedDomains, ["app.example.com"]);
  assert.equal(payload.artifactPolicy, "screenshots");
  assert.equal(payload.tracePolicy, "timeline");
  assert.ok(payload.title.startsWith("Browser Lane:"));
});

test("buildBrowserBeeTaskDescription points agents at Browser Lane", () => {
  const payload = parseBrowserBeeJobCreate({
    title: "Browser Lane LinkedIn triage",
    project: "hive",
    startUrl: "https://www.linkedin.com/messaging/",
    objective: "Check recruiter messages and summarize urgent ones.",
    siteLabel: "LinkedIn",
    steps: ["Open messaging", "Identify unread recruiter threads"],
    successCriteria: ["Return the sender names and urgency."],
    runMode: "attached",
    requiresLogin: true,
  });

  const description = buildBrowserBeeTaskDescription(payload, {
    requestedProjectPath: "/Users/irvencassio/Hive",
  });

  assert.match(description, /This task came from Browser Lane/);
  assert.match(description, /Browser Lane read\/search mode/);
  assert.match(description, /Allowed domains: www\.linkedin\.com/);
  assert.match(description, /Execution steps:/);
  assert.match(description, /Success criteria:/);
});

test("buildBrowserBeeJobSnapshot reads task-backed request metadata", () => {
  const payload = parseBrowserBeeJobCreate({
    title: "Browser Lane CRM update",
    project: "hive",
    startUrl: "https://crm.example.com/leads",
    objective: "Update a lead record.",
    siteLabel: "Example CRM",
    runMode: "attached",
    requiresLogin: true,
    sessionLabel: "crm-daily",
  });

  const snapshot = buildBrowserBeeJobSnapshot({
    _id: "task-1",
    title: payload.title,
    status: "backlog",
    createdAt: "2026-05-10T09:00:00.000Z",
    updatedAt: "2026-05-10T09:01:00.000Z",
    model: "codex:gpt-5.4-computer-use",
    output: {
      browserbeeRequest: buildBrowserBeeTaskRequestEnvelope(payload, "/Users/irvencassio/Hive"),
    },
  });

  assert.equal(snapshot.id, "task-1");
  assert.equal(snapshot.requestedProject, "hive");
  assert.equal(snapshot.runMode, "attached");
  assert.equal(snapshot.approvalMode, "manual");
  assert.equal(snapshot.sessionLabel, "crm-daily");
});

test("resolveBrowserBeeBacking uses Codex Computer Use ONLY with an API-key account", () => {
  // api-key: the computer-use model is available → Codex backing.
  const apiKey = resolveBrowserBeeBacking({
    codexAuthMode: "api-key",
    desktopFallbackEnabled: false,
    desktopBeeAvailable: true,
  });
  assert.equal(apiKey.backing, "codex_computer_use");
});

test("resolveBrowserBeeBacking does NOT use Codex on a ChatGPT-subscription account (model 400s)", () => {
  // Regression: gpt-5.4-computer-use is unsupported on subscription accounts, so
  // it must NOT create a doomed Codex task. With no fallback → refuse clearly.
  const refuse = resolveBrowserBeeBacking({
    codexAuthMode: "subscription",
    desktopFallbackEnabled: false,
    desktopBeeAvailable: true,
  });
  assert.equal(refuse.backing, null);
  assert.match(refuse.reason, /ChatGPT-subscription/);
  assert.match(refuse.reason, /desktopFallback=true/);
  // With the fallback enabled, route to Desktop Lane instead of Codex.
  const fallback = resolveBrowserBeeBacking({
    codexAuthMode: "subscription",
    desktopFallbackEnabled: true,
    desktopBeeAvailable: true,
  });
  assert.equal(fallback.backing, "desktop_fallback");
});

test("resolveBrowserBeeBacking refuses when Codex auth is missing and fallback is off", () => {
  const decision = resolveBrowserBeeBacking({
    codexAuthMode: "logged-out",
    desktopFallbackEnabled: false,
    desktopBeeAvailable: true,
  });
  assert.equal(decision.backing, null);
  assert.match(decision.reason, /desktopFallback=true/);
});

test("resolveBrowserBeeBacking uses the Desktop Lane fallback when enabled and available", () => {
  const decision = resolveBrowserBeeBacking({
    codexAuthMode: "logged-out",
    desktopFallbackEnabled: true,
    desktopBeeAvailable: true,
  });
  assert.equal(decision.backing, "desktop_fallback");
});

test("resolveBrowserBeeBacking refuses the fallback when Desktop Lane is unavailable", () => {
  const decision = resolveBrowserBeeBacking({
    codexAuthMode: "logged-out",
    desktopFallbackEnabled: true,
    desktopBeeAvailable: false,
  });
  assert.equal(decision.backing, null);
  assert.match(decision.reason, /Desktop Lane is unavailable/);
  assert.doesNotMatch(decision.reason, /DesktopBee/);
});

test("readBrowserBeeDesktopFallbackEnabled reads the opt-in flag, default off", () => {
  assert.equal(readBrowserBeeDesktopFallbackEnabled({}), false);
  assert.equal(readBrowserBeeDesktopFallbackEnabled({ browserbee: {} }), false);
  assert.equal(readBrowserBeeDesktopFallbackEnabled({ browserbee: { desktopFallback: true } }), true);
  assert.equal(readBrowserBeeDesktopFallbackEnabled({ browserLane: { desktopFallback: true } }), true);
  assert.equal(readBrowserBeeDesktopFallbackEnabled({ browserbee: { desktopFallback: false } }), false);
});

test("buildBrowserBeeDesktopFallbackDescription drives the browser via Desktop Lane", () => {
  const payload = parseBrowserBeeJobCreate({
    project: "hive",
    startUrl: "https://app.example.com/inbox",
    objective: "Check the inbox and capture new messages.",
    requiresLogin: true,
  });

  const description = buildBrowserBeeDesktopFallbackDescription(payload, {
    requestedProjectPath: "/Users/irvencassio/Hive",
  });

  assert.match(description, /Desktop fallback backing/);
  assert.match(description, /desktop_action tool/);
  assert.match(description, /no Codex Computer Use engine/);
  assert.match(description, /Desktop Lane fallback/);
  assert.doesNotMatch(description, /DesktopBee/);
  // shared body is still present
  assert.match(description, /Allowed domains: app\.example\.com/);
  assert.match(description, /Objective:/);
});

test("buildBrowserBeeTaskRequestEnvelope records the chosen backing", () => {
  const payload = parseBrowserBeeJobCreate({
    project: "hive",
    startUrl: "https://app.example.com/inbox",
    objective: "Check the inbox.",
  });

  const codex = buildBrowserBeeTaskRequestEnvelope(payload, "/Users/irvencassio/Hive");
  assert.equal(codex.backing, "codex_computer_use");
  assert.equal(codex.backingModel, "codex:gpt-5.4-computer-use");

  const fallback = buildBrowserBeeTaskRequestEnvelope(payload, "/Users/irvencassio/Hive", {
    backing: "desktop_fallback",
    backingModel: "qwen3-coder",
  });
  assert.equal(fallback.backing, "desktop_fallback");
  assert.equal(fallback.backingModel, "qwen3-coder");
});

test("buildBrowserBeeHealthSnapshot surfaces the fallback decision", () => {
  const offline = buildBrowserBeeHealthSnapshot({
    readiness: {
      codexConfigured: false,
      codexAuthMode: "logged-out",
      acknowledgedComputerUse: true,
      desktopFallbackEnabled: false,
    },
    tasks: [],
  });
  assert.equal(offline.readiness.effectiveBacking, "unavailable");
  assert.equal(offline.readiness.desktopFallbackEnabled, false);

  const fallbackOn = buildBrowserBeeHealthSnapshot({
    readiness: {
      codexConfigured: false,
      codexAuthMode: "logged-out",
      acknowledgedComputerUse: true,
      desktopFallbackEnabled: true,
      desktopBeeAvailable: true,
    },
    tasks: [],
  });
  assert.equal(fallbackOn.readiness.effectiveBacking, "desktop_fallback");
});

test("buildBrowserBeeHealthSnapshot counts queue states", () => {
  const health = buildBrowserBeeHealthSnapshot({
    readiness: {
      codexConfigured: true,
      codexAuthMode: "subscription",
      acknowledgedComputerUse: false,
    },
    tasks: [
      { status: "backlog", createdAt: "2026-05-10T09:00:00.000Z" },
      { status: "assigned", createdAt: "2026-05-10T09:05:00.000Z" },
      { status: "review", createdAt: "2026-05-10T09:10:00.000Z" },
      { status: "done", createdAt: "2026-05-10T09:15:00.000Z" },
      { status: "cancelled", createdAt: "2026-05-10T09:20:00.000Z" },
    ],
  });

  assert.equal(health.counts.total, 5);
  assert.equal(health.counts.backlog, 1);
  assert.equal(health.counts.active, 1);
  assert.equal(health.counts.review, 1);
  assert.equal(health.counts.done, 1);
  assert.equal(health.counts.cancelled, 1);
  assert.equal(health.readiness.consentRequired, true);
  assert.equal(health.latestTaskAt, "2026-05-10T09:20:00.000Z");
});
