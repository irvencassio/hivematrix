import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBrowserBeeHealthSnapshot,
  buildBrowserBeeJobSnapshot,
  buildBrowserBeeTaskDescription,
  buildBrowserBeeTaskRequestEnvelope,
  parseBrowserBeeJobCreate,
} from "./contracts";

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
  assert.ok(payload.title.startsWith("BrowserBee:"));
});

test("buildBrowserBeeTaskDescription keeps BrowserBee distinct from WebBee", () => {
  const payload = parseBrowserBeeJobCreate({
    title: "BrowserBee LinkedIn triage",
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

  assert.match(description, /This task came from BrowserBee/);
  assert.match(description, /If the work can be completed by WebBee/);
  assert.match(description, /Allowed domains: www\.linkedin\.com/);
  assert.match(description, /Execution steps:/);
  assert.match(description, /Success criteria:/);
});

test("buildBrowserBeeJobSnapshot reads task-backed request metadata", () => {
  const payload = parseBrowserBeeJobCreate({
    title: "BrowserBee CRM update",
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
