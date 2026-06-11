import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDesktopBeeHealthSnapshot,
  buildDesktopBeeJobSnapshot,
  buildDesktopBeeTaskDescription,
  buildDesktopBeeTaskRequestEnvelope,
  parseDesktopBeeJobCreate,
} from "./contracts";

test("parseDesktopBeeJobCreate normalizes defaults from app scope and risk posture", () => {
  const payload = parseDesktopBeeJobCreate({
    project: "hive",
    primaryApp: "Messages",
    objective: "Open the latest thread and summarize any new inbound requests.",
    requiresElevatedPermissions: false,
  });

  assert.equal(payload.project, "hive");
  assert.equal(payload.primaryApp, "Messages");
  assert.equal(payload.runMode, "background");
  assert.equal(payload.approvalMode, "confirm_app_launch");
  assert.deepEqual(payload.allowedApps, ["Messages"]);
  assert.equal(payload.artifactPolicy, "screenshots");
  assert.equal(payload.tracePolicy, "timeline_and_screenshots");
  assert.ok(payload.title.startsWith("DesktopBee:"));
});

test("buildDesktopBeeTaskDescription keeps DesktopBee distinct from BrowserBee and API work", () => {
  const payload = parseDesktopBeeJobCreate({
    title: "DesktopBee Messages triage",
    project: "hive",
    primaryApp: "Messages",
    objective: "Review new Messages threads and summarize urgent ones.",
    allowedApps: ["Messages", "Finder"],
    steps: ["Open Messages", "Review unread threads"],
    successCriteria: ["Return sender names and urgency."],
    runMode: "foreground",
    requiresElevatedPermissions: true,
  });

  const description = buildDesktopBeeTaskDescription(payload, {
    requestedProjectPath: "/Users/irvencassio/Hive",
  });

  assert.match(description, /This task came from DesktopBee/);
  assert.match(description, /If the workflow can be completed through a direct API/);
  assert.match(description, /Allowed apps: Messages, Finder/);
  assert.match(description, /Requires elevated permissions: yes/);
  assert.match(description, /Execution steps:/);
  assert.match(description, /Success criteria:/);
});

test("buildDesktopBeeJobSnapshot reads task-backed request metadata", () => {
  const payload = parseDesktopBeeJobCreate({
    title: "DesktopBee System Settings repair",
    project: "hive",
    primaryApp: "System Settings",
    objective: "Open privacy settings and inspect accessibility permissions.",
    runMode: "foreground",
    requiresElevatedPermissions: true,
    sessionLabel: "local-permissions",
  });

  const snapshot = buildDesktopBeeJobSnapshot({
    _id: "task-1",
    title: payload.title,
    status: "backlog",
    createdAt: "2026-05-10T10:00:00.000Z",
    updatedAt: "2026-05-10T10:01:00.000Z",
    model: "codex:gpt-5.4-computer-use",
    output: {
      desktopbeeRequest: buildDesktopBeeTaskRequestEnvelope(payload, "/Users/irvencassio/Hive"),
    },
  });

  assert.equal(snapshot.id, "task-1");
  assert.equal(snapshot.requestedProject, "hive");
  assert.equal(snapshot.runMode, "foreground");
  assert.equal(snapshot.approvalMode, "manual");
  assert.equal(snapshot.sessionLabel, "local-permissions");
});

test("buildDesktopBeeHealthSnapshot counts queue states", () => {
  const health = buildDesktopBeeHealthSnapshot({
    readiness: {
      codexConfigured: true,
      codexAuthMode: "subscription",
      acknowledgedDesktopUse: false,
    },
    tasks: [
      { status: "backlog", createdAt: "2026-05-10T10:00:00.000Z" },
      { status: "assigned", createdAt: "2026-05-10T10:05:00.000Z" },
      { status: "review", createdAt: "2026-05-10T10:10:00.000Z" },
      { status: "done", createdAt: "2026-05-10T10:15:00.000Z" },
      { status: "failed", createdAt: "2026-05-10T10:20:00.000Z" },
    ],
  });

  assert.equal(health.counts.total, 5);
  assert.equal(health.counts.backlog, 1);
  assert.equal(health.counts.active, 1);
  assert.equal(health.counts.review, 1);
  assert.equal(health.counts.done, 1);
  assert.equal(health.counts.failed, 1);
  assert.equal(health.readiness.consentRequired, true);
  assert.equal(health.latestTaskAt, "2026-05-10T10:20:00.000Z");
});
