import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBrowserBeeDesktopFallbackDescription,
  buildBrowserBeeHealthSnapshot,
  buildBrowserBeeJobSnapshot,
  buildBrowserBeeTaskDescription,
  buildBrowserBeeTaskRequestEnvelope,
  buildCanopyBrowserTaskDescription,
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

test("buildCanopyBrowserTaskDescription routes the work to the app, never to a desktop browser", () => {
  const payload = parseBrowserBeeJobCreate({
    title: "Browser Lane LinkedIn triage",
    project: "hive",
    startUrl: "https://www.linkedin.com/messaging/",
    objective: "Check recruiter messages and summarize urgent ones.",
    siteLabel: "LinkedIn",
    steps: ["Open messaging"],
    requiresLogin: true,
    jobType: "authenticated_research",
  });

  const description = buildCanopyBrowserTaskDescription(payload, {
    requestedProjectPath: "/Users/example/Hive",
    daemonPort: "3747",
  });

  assert.match(description, /Canopy Browser app/);
  assert.match(description, /\/lane\/browser/, "the task must be pointed at the lane endpoint");
  assert.match(description, /Do NOT use WebSearch, Chrome MCP, desktop_action/);
  assert.doesNotMatch(description, /desktop\.script\.run|desktop\.ax\.query/, "the drive-Chrome-yourself instructions must not appear");
  assert.match(description, /report that refusal message verbatim/);
  assert.match(description, /Allowed domains: www\.linkedin\.com/, "the shared job-metadata block is reused, not re-invented");
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

test("Browser Lane runs on Claude and never asks about Codex", () => {
  // Cutover 2026-07-22. The Codex Computer Use backing was removed: it required
  // an OpenAI API-key account (gpt-5.4-computer-use 400s on a ChatGPT
  // subscription login), so on this machine it could never run — yet its
  // presence made every Browser Lane failure read as a Codex auth problem and
  // sent people chasing `codex login`. Claude driving a desktop browser is now
  // the one engine, and the decision must not consult Codex at all.
  const decision = resolveBrowserBeeBacking({ desktopBeeAvailable: true });
  assert.equal(decision.backing, "desktop_fallback");
  assert.match(decision.reason, /Claude/);
  assert.doesNotMatch(decision.reason, /codex/i, "the reason must never mention Codex");
  assert.doesNotMatch(decision.reason, /api[- ]key/i);
});

test("Browser Lane no longer refuses work for lack of Codex auth, or for a fallback opt-in", () => {
  // Previously: subscription auth + fallback off => refused, telling the operator
  // to set browserLane.desktopFallback=true. There is no primary to fall back
  // FROM now, so gating the only engine behind an opt-in would just make Browser
  // Lane silently dead.
  const decision = resolveBrowserBeeBacking({ desktopBeeAvailable: true });
  assert.equal(decision.backing, "desktop_fallback", "must dispatch without any opt-in flag");
  assert.doesNotMatch(decision.reason, /desktopFallback=true/);
});

test("resolveBrowserBeeBacking refuses only when Desktop Lane itself is down", () => {
  // The one real precondition left: something has to drive the browser.
  const decision = resolveBrowserBeeBacking({ desktopBeeAvailable: false });
  assert.equal(decision.backing, null);
  assert.match(decision.reason, /Desktop Lane is unavailable/);
  assert.doesNotMatch(decision.reason, /codex/i);
  assert.doesNotMatch(decision.reason, /DesktopBee/);
});

test("readBrowserBeeDesktopFallbackEnabled reads the opt-in flag, default off", () => {
  // Retained for status surfaces; it no longer gates dispatch.
  assert.equal(readBrowserBeeDesktopFallbackEnabled({}), false);
  assert.equal(readBrowserBeeDesktopFallbackEnabled({ browserbee: {} }), false);
  assert.equal(readBrowserBeeDesktopFallbackEnabled({ browserbee: { desktopFallback: true } }), true);
  assert.equal(readBrowserBeeDesktopFallbackEnabled({ browserLane: { desktopFallback: true } }), true);
  assert.equal(readBrowserBeeDesktopFallbackEnabled({ browserbee: { desktopFallback: false } }), false);
});

test("the job prompt tells the agent to drive the browser with desktop_action, and never mentions Codex", () => {
  const payload = parseBrowserBeeJobCreate({
    project: "hive",
    startUrl: "https://app.example.com/inbox",
    objective: "Check the inbox and capture new messages.",
    requiresLogin: true,
  });

  const description = buildBrowserBeeTaskDescription(payload, {
    requestedProjectPath: "/Users/irvencassio/Hive",
  });

  assert.match(description, /desktop_action tool/);
  assert.match(description, /Claude drives a real desktop browser/);
  assert.doesNotMatch(description, /Codex Computer Use engine on this path/);
  assert.doesNotMatch(description, /no usable Codex auth/i);
  assert.doesNotMatch(description, /DesktopBee/);
  assert.doesNotMatch(description, /local model/i);
  assert.match(description, /Sign in with saved credential/, "points at one-click credential retrieval");
  // shared body is still present
  assert.match(description, /Allowed domains: app\.example\.com/);
  assert.match(description, /Objective:/);
});

test("the deprecated fallback-description alias returns the same single prompt", () => {
  const payload = parseBrowserBeeJobCreate({
    project: "hive",
    startUrl: "https://app.example.com/inbox",
    objective: "Check the inbox.",
  });
  const opts = { requestedProjectPath: "/Users/irvencassio/Hive" };
  assert.equal(
    buildBrowserBeeDesktopFallbackDescription(payload, opts),
    buildBrowserBeeTaskDescription(payload, opts),
    "one engine means one prompt — the two must not drift again",
  );
});

test("buildBrowserBeeTaskRequestEnvelope records the chosen backing", () => {
  const payload = parseBrowserBeeJobCreate({
    project: "hive",
    startUrl: "https://app.example.com/inbox",
    objective: "Check the inbox.",
  });

  // The default is the Claude desktop engine — it used to default to Codex.
  const dflt = buildBrowserBeeTaskRequestEnvelope(payload, "/Users/irvencassio/Hive");
  assert.equal(dflt.backing, "desktop_fallback");
  assert.doesNotMatch(dflt.backingModel, /codex/i);

  const explicit = buildBrowserBeeTaskRequestEnvelope(payload, "/Users/irvencassio/Hive", {
    backing: "desktop_fallback",
    backingModel: "claude-sonnet-5",
  });
  assert.equal(explicit.backing, "desktop_fallback");
  assert.equal(explicit.backingModel, "claude-sonnet-5");
});

test("buildBrowserBeeHealthSnapshot surfaces the fallback decision", () => {
  // Health now turns on ONE thing: is Desktop Lane up? No Codex fields at all.
  const down = buildBrowserBeeHealthSnapshot({
    readiness: { acknowledgedComputerUse: true, desktopBeeAvailable: false },
    tasks: [],
  });
  assert.equal(down.readiness.effectiveBacking, "unavailable");
  assert.equal("codexAuthMode" in down.readiness, false, "Codex must not reappear in the health surface");
  assert.equal("codexConfigured" in down.readiness, false);
  assert.doesNotMatch(down.backingModel, /codex/i);

  const up = buildBrowserBeeHealthSnapshot({
    readiness: { acknowledgedComputerUse: true, desktopBeeAvailable: true },
    tasks: [],
  });
  assert.equal(up.readiness.effectiveBacking, "desktop_fallback");
});

test("buildBrowserBeeHealthSnapshot counts queue states", () => {
  const health = buildBrowserBeeHealthSnapshot({
    readiness: {
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
