import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConnectivityPolicy, getConnectivityPolicy } from "@/lib/connectivity/policy";
import {
  isLaneTool, availableLaneTools, executeLaneTool, LANE_TOOL_DEFINITIONS, resolveLaneToolName,
  capabilityRoutingGuide, executeMailBeeSend, executeMailBeeDraft, executeMessageBeeSend,
  type MailBeeSendIO, type MessageBeeSendIO, type LaneToolContext,
} from "./lane-tools";

function cloud() { return new ConnectivityPolicy(); }
function local() { const p = new ConnectivityPolicy(); p.setManualOverride("local-only"); return p; }
function offline() { const p = new ConnectivityPolicy(); p.setManualOverride("offline"); return p; }

// Point the brain root at a temp dir (skill_run reads/writes real skill files
// on disk via the skills store — same trick as skills/store.test.ts: a fake
// HOME + ~/.hivematrix/config.json, since configuredBrainRootDir() reads that
// file fresh on every call).
const SKILL_TMP = mkdtempSync(join(tmpdir(), "hm-lane-skills-"));
const SKILL_HOME = join(SKILL_TMP, "home");
const SKILL_BRAIN = join(SKILL_TMP, "brain");
mkdirSync(join(SKILL_HOME, ".hivematrix"), { recursive: true });
// browserLane.engine is pinned to "desktop" for the whole file so the
// executeBrowserBeeRun tests below keep exercising the desktop dispatch path
// after T6 flipped the product default to "canopy". The canopy-engine tests
// opt in explicitly by rewriting this file.
writeFileSync(join(SKILL_HOME, ".hivematrix", "config.json"), JSON.stringify({
  memory: { brainRootDir: SKILL_BRAIN },
  browserLane: { engine: "desktop" },
}));
// A fake Codex api-key auth file so resolveBrowserBeeBacking() (called inside
// executeBrowserBeeRun) picks the codex_computer_use backing in the Browser
// Lane accessMode-gating tests below, without depending on this machine's
// real ~/.codex/auth.json state. See resolveBrowserBeeBacking in
// browser-lane/jobs.ts: api-key auth short-circuits straight to that backing
// — the minimal path to a live (stubbed-network) dispatch.
mkdirSync(join(SKILL_HOME, ".codex"), { recursive: true });
writeFileSync(join(SKILL_HOME, ".codex", "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test-browser-lane-gating", tokens: {} }));
const origHome = process.env.HOME;
process.env.HOME = SKILL_HOME;

const { upsertSkill, readSkill } = await import("@/lib/skills/store");
const { setAutonomyLevel } = await import("@/lib/config/autonomy");
const { upsertBrowserSite } = await import("@/lib/browser-lane/store");
const { readAudit } = await import("@/lib/audit/audit");

test.afterEach(() => {
  setAutonomyLevel("standard"); // restore the default between tests
});

test.after(() => {
  process.env.HOME = origHome;
  rmSync(SKILL_TMP, { recursive: true, force: true });
});

function ctx(): LaneToolContext {
  return { projectPath: "/tmp", project: "ops", requestedBy: "test" };
}

const names = (tools: { function: { name: string } }[]) => tools.map((t) => t.function.name).sort();

test("isLaneTool recognizes active lane tools and rejects removed browser aliases", () => {
  assert.equal(isLaneTool("hivematrix_browser"), true);
  assert.equal(isLaneTool("webbee_search"), false);
  assert.equal(isLaneTool("browserbee_run"), false);
  assert.equal(isLaneTool("desktopbee_action"), true);
  assert.equal(isLaneTool("mailbee_send"), true);
  assert.equal(isLaneTool("mailbee_draft"), true);
  assert.equal(isLaneTool("messagebee_send"), true);
  assert.equal(isLaneTool("brain_search"), true);
  assert.equal(isLaneTool("brain_read"), true);
  assert.equal(isLaneTool("skill_used"), true);
  assert.equal(isLaneTool("skill_run"), true);
  assert.equal(isLaneTool("digest_url"), true);
  assert.equal(isLaneTool("code_graph"), true);
  assert.equal(isLaneTool("bash"), false);
  assert.equal(isLaneTool("read_file"), false);
});

test("resolveLaneToolName maps legacy bee ids to their lane-native handler names", () => {
  assert.equal(resolveLaneToolName("desktopbee_action"), "desktop_action");
  assert.equal(resolveLaneToolName("mailbee_send"), "mail_send");
  assert.equal(resolveLaneToolName("mailbee_draft"), "mail_draft");
  assert.equal(resolveLaneToolName("messagebee_send"), "message_send");
  // Lane-native (advertised) names and unknowns resolve to themselves.
  assert.equal(resolveLaneToolName("mail_send"), "mail_send");
  assert.equal(resolveLaneToolName("bash"), "bash");
  // Removed legacy browser ids are not re-introduced as aliases.
  assert.equal(resolveLaneToolName("browserbee_run"), "browserbee_run");
});

test("isLaneTool accepts both the advertised lane ids and legacy bee aliases", () => {
  assert.equal(isLaneTool("mail_send"), true);
  assert.equal(isLaneTool("message_send"), true);
  assert.equal(isLaneTool("desktop_action"), true);
  // Legacy bee ids still resolve for older persisted calls.
  assert.equal(isLaneTool("mailbee_send"), true);
  assert.equal(isLaneTool("desktopbee_action"), true);
  // Still rejects the removed browser ids and non-lane tools.
  assert.equal(isLaneTool("browserbee_run"), false);
  assert.equal(isLaneTool("bash"), false);
});

test("executeLaneTool dispatches a legacy bee alias to its real handler", async () => {
  // The legacy id reaches the mail handler (required-field error) rather than
  // the "Unknown lane tool" path — proving mailbee_send resolved to mail_send.
  // When the lane is gated off it returns the capability error; neither is the
  // unknown-tool error, so the alias resolution holds regardless of policy.
  const out = await executeLaneTool("mailbee_send", {}, { projectPath: "/tmp", project: "p", requestedBy: "t" });
  assert.doesNotMatch(out, /Unknown lane tool/);
  assert.match(out, /required to send an email|unavailable in the current connectivity mode/);
});

test("all bee tools are defined with required schemas", () => {
  assert.equal(LANE_TOOL_DEFINITIONS.length, 23); // 14 lanes (incl. brain_read + brain_write) + 5 PIM tools + 4 goals tools
  for (const t of LANE_TOOL_DEFINITIONS) {
    assert.equal(t.type, "function");
    assert.ok(t.function.name.length > 0);
    assert.ok(t.function.description.length > 0);
    assert.ok(t.function.parameters);
  }
});

test("lane tools advertise lane-native names and descriptions, not bee brands", () => {
  const prose = LANE_TOOL_DEFINITIONS.map((t) => JSON.stringify({
    description: t.function.description,
    parameters: t.function.parameters,
  })).join("\n");

  assert.match(prose, /Desktop Lane/);
  assert.match(prose, /Mail Lane/);
  assert.match(prose, /Message Lane/);
  assert.doesNotMatch(prose, /DesktopBee/);
  assert.doesNotMatch(prose, /TermBee/);
  assert.doesNotMatch(prose, /MailBee/);
  assert.doesNotMatch(prose, /MessageBee/);
  assert.ok(LANE_TOOL_DEFINITIONS.some((t) => t.function.name === "desktop_action"));
  assert.ok(LANE_TOOL_DEFINITIONS.some((t) => t.function.name === "mail_send"));
  assert.ok(LANE_TOOL_DEFINITIONS.some((t) => t.function.name === "message_send"));
  // The advertised surface no longer carries bee-branded ids.
  assert.ok(!LANE_TOOL_DEFINITIONS.some((t) => /bee_|bee$/.test(t.function.name)));
});

// PIM tools ride the "brain" capability — local osascript, present in every mode.
const PIM_NAMES = ["calendar_create", "calendar_today", "contacts_lookup", "reminder_create", "reminders_list"];
// Goals tools ride the "brain" capability too — local SQLite, present in every mode.
const GOALS_NAMES = ["goals_list", "goal_upsert", "goal_checkin", "daily_review"];

test("cloud-ok advertises every lane (web, browser, desktop, mail, message, brain, skill, digest, pim, goals)", () => {
  assert.deepEqual(names(availableLaneTools(cloud())),
    ["brain_search", "brain_read", "brain_write", ...PIM_NAMES, ...GOALS_NAMES, "code_graph", "coo_dispatch", "desktop_action", "digest_url", "hivematrix_browser", "mail_draft", "mail_send", "message_send", "skill_used", "skill_run", "workflow_inbox"].sort());
});

test("digest_url is web-gated: absent offline (no internet to fetch)", () => {
  assert.ok(!names(availableLaneTools(offline())).includes("digest_url"));
  assert.ok(!names(availableLaneTools(local())).includes("digest_url"));
});

test("local-only drops web lanes but keeps Desktop Lane + outbound channels + brain/skill/codegraph/pim/goals + COO routing", () => {
  assert.deepEqual(names(availableLaneTools(local())),
    ["brain_search", "brain_read", "brain_write", ...PIM_NAMES, ...GOALS_NAMES, "code_graph", "coo_dispatch", "desktop_action", "mail_draft", "mail_send", "message_send", "skill_used", "skill_run", "workflow_inbox"].sort());
});

test("offline keeps the offline workhorses + outbound channels + brain/skill/codegraph/pim/goals + COO routing (all local)", () => {
  assert.deepEqual(names(availableLaneTools(offline())),
    ["brain_search", "brain_read", "brain_write", ...PIM_NAMES, ...GOALS_NAMES, "code_graph", "coo_dispatch", "desktop_action", "mail_draft", "mail_send", "message_send", "skill_used", "skill_run", "workflow_inbox"].sort());
});

test("capabilityRoutingGuide lists email/message/brain lanes in cloud, drops web lanes offline", () => {
  const cloudGuide = capabilityRoutingGuide(cloud());
  assert.match(cloudGuide, /mail_send/);
  assert.match(cloudGuide, /message_send/);
  assert.match(cloudGuide, /brain_search/);
  assert.match(cloudGuide, /brain_read/);
  assert.match(cloudGuide, /hivematrix_browser/);
  assert.doesNotMatch(cloudGuide, /webbee_search/);
  assert.doesNotMatch(cloudGuide, /browserbee_run/);
  assert.match(cloudGuide, /do not improvise/i);

  const offlineGuide = capabilityRoutingGuide(offline());
  assert.match(offlineGuide, /mail_send/);   // still routable offline
  assert.match(offlineGuide, /brain_search/);   // brain is local, still routable
  assert.doesNotMatch(offlineGuide, /hivematrix_browser/); // browser lane gone offline
});

test("executeLaneTool refuses an unknown lane tool", async () => {
  const out = await executeLaneTool("nopebee", {}, { projectPath: "/tmp", project: "ops", requestedBy: "test" });
  assert.match(out, /Unknown lane tool/);
});

test("executeLaneTool: brain_read returns a doc's full content for a valid in-root path", async () => {
  mkdirSync(SKILL_BRAIN, { recursive: true });
  writeFileSync(join(SKILL_BRAIN, "goals.md"), "# Goals\nShip the thing.");
  const out = await executeLaneTool("brain_read", { path: "goals.md" }, ctx());
  assert.match(out, /Ship the thing/);
});

test("executeLaneTool: brain_read rejects a `..` escape from the brain root", async () => {
  const out = await executeLaneTool("brain_read", { path: "../../../../etc/passwd" }, ctx());
  assert.match(out, /Error:.*escapes the brain root/);
});

test("executeLaneTool: brain_read requires a path", async () => {
  const out = await executeLaneTool("brain_read", {}, ctx());
  assert.match(out, /'path' is required for brain_read/);
});

test("isLaneTool recognizes all four goals tools", () => {
  assert.equal(isLaneTool("goals_list"), true);
  assert.equal(isLaneTool("goal_upsert"), true);
  assert.equal(isLaneTool("goal_checkin"), true);
  assert.equal(isLaneTool("daily_review"), true);
});

test("executeLaneTool: goals_list reports no active goals in a fresh store", async () => {
  const out = await executeLaneTool("goals_list", {}, ctx());
  assert.match(out, /No active goals yet/);
});

test("executeLaneTool: goal_upsert creates a goal, then goals_list shows it", async () => {
  const created = await executeLaneTool("goal_upsert", { title: "Run 5k", category: "health", cadence: "weekly" }, ctx());
  assert.match(created, /Created goal "Run 5k"/);

  const listed = await executeLaneTool("goals_list", {}, ctx());
  assert.match(listed, /Run 5k/);
  assert.match(listed, /health/);
});

test("executeLaneTool: goals_list surfaces description + target so a nudge can propose a next step", async () => {
  await executeLaneTool("goal_upsert", {
    title: "Pass the annuities exam",
    category: "income",
    cadence: "weekly",
    target: "70% on a practice exam",
    description: "Ohio combined Life + A&H license — study 30 min/day, sit a practice exam weekly",
  }, ctx());
  const listed = await executeLaneTool("goals_list", {}, ctx());
  assert.match(listed, /Pass the annuities exam/);
  assert.match(listed, /target: 70% on a practice exam/, "target is shown so the model knows 'done' looks like what");
  assert.match(listed, /Ohio combined Life/, "description gives the model enough to propose a concrete next step");
});

test("executeLaneTool: goal_upsert stores a next action and goals_list surfaces it as the step to take", async () => {
  await executeLaneTool("goal_upsert", {
    title: "Ship the AI-consulting site",
    category: "income",
    nextAction: "draft the landing-page hero copy",
  }, ctx());
  const listed = await executeLaneTool("goals_list", {}, ctx());
  assert.match(listed, /→ next: draft the landing-page hero copy/, "the explicit next step is surfaced for a nudge");
});

test("executeLaneTool: goal_checkin resolves by fuzzy title and records progress", async () => {
  await executeLaneTool("goal_upsert", { title: "Italian practice", cadence: "daily" }, ctx());
  const out = await executeLaneTool("goal_checkin", { goal: "italian", note: "20 minutes on Duolingo" }, ctx());
  assert.match(out, /Logged progress on "Italian practice"/);
  assert.match(out, /20 minutes on Duolingo/);
});

test("executeLaneTool: goal_checkin reports no match instead of guessing", async () => {
  const out = await executeLaneTool("goal_checkin", { goal: "a goal that does not exist anywhere" }, ctx());
  assert.match(out, /no goal matching/);
  assert.match(out, /goals_list/);
});

test("executeLaneTool: daily_review reflects a freshly upserted, never-checked-in goal as due", async () => {
  await executeLaneTool("goal_upsert", { title: "Daily review target goal", cadence: "daily" }, ctx());
  const out = await executeLaneTool("daily_review", {}, ctx());
  assert.match(out, /Daily review target goal/);
});

test("executeLaneTool rejects removed BrowserBee/WebBee aliases", async () => {
  assert.match(
    await executeLaneTool("webbee_search", { query: "x" }, { projectPath: "/tmp", project: "ops", requestedBy: "test" }),
    /Unknown lane tool/,
  );
  assert.match(
    await executeLaneTool("browserbee_run", { objective: "x" }, { projectPath: "/tmp", project: "ops", requestedBy: "test" }),
    /Unknown lane tool/,
  );
});

// ── Browser Lane accessMode gating + actorKind stamping (Canopy parity,
//    2026-07-16) ─────────────────────────────────────────────────────────────
//
// Not implemented yet — see
// docs/superpowers/specs/2026-07-16-browser-lane-canopy-parity-design.md.
// executeBrowserBeeRun/executeBrowserLaneRead are not exported, so these tests
// go through the public executeLaneTool("hivematrix_browser", ...) entry
// point exactly like every other lane in this file. The outer capability gate
// (LANE_TOOL_CAPABILITY.hivematrix_browser === "browserbee") is only
// available in cloud-ok connectivity mode, so each test forces that via the
// getConnectivityPolicy() singleton and restores it afterward.

function browserCtx(actorKind: "agent" | "human" = "agent", requestedBy = "browser-lane-test"): LaneToolContext {
  // actorKind does not exist on LaneToolContext yet (Task 4) — cast forward to
  // the intended future shape rather than widening the real interface here.
  return { projectPath: "/tmp", project: "ops", requestedBy, actorKind } as LaneToolContext;
}

/**
 * Stubs the daemon loopback POST /tasks (Browser Lane job creation) and the
 * Browser Lane read service's POST /answer, so these tests never depend on a
 * real daemon or a real Browser Lane app running on this machine. Mirrors the
 * globalThis.fetch stubbing idiom in src/daemon/server.test.ts.
 */
function installBrowserLaneFetchStub(t: TestContext, taskId = "task-stub"): { dispatched: string[] } {
  const dispatched: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (url.endsWith("/tasks") && init?.method === "POST") {
      dispatched.push(taskId);
      return new Response(JSON.stringify({ _id: taskId, title: "Browser Lane stub task" }), { status: 200 });
    }
    if (url.endsWith("/answer") && init?.method === "POST") {
      return new Response(JSON.stringify({
        status: "failed", answer: null, citations: [], confidence: 0, freshnessVerifiedAt: null,
        escalation: { needed: false, reason: null }, artifacts: [], errorCode: "stubbed_no_read_service",
      }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  return { dispatched };
}

// ── T6: the Canopy Browser engine ──────────────────────────────────────────
//
// Policy now lives in the Canopy Browser app, not here. HiveMatrix's duplicate
// read-only gate was removed; these tests assert the client behaviour that
// replaced it — the app's refusal surfaced verbatim, and the `browser:blocked`
// audit event (the Command Log's Blocked filter) re-emitted on receipt.

const CANOPY_CONFIG_PATH = join(SKILL_HOME, ".hivematrix", "config.json");

/** Point browserLane.engine at "canopy" for one test, then restore. */
function withCanopyEngine(t: TestContext): void {
  const original = readFileSync(CANOPY_CONFIG_PATH, "utf-8");
  writeFileSync(CANOPY_CONFIG_PATH, JSON.stringify({ ...JSON.parse(original), browserLane: { engine: "canopy" } }));
  t.after(() => writeFileSync(CANOPY_CONFIG_PATH, original));
}

/**
 * Stubs the Canopy Browser app's POST /act plus the daemon loopback POST /tasks,
 * so these tests never need a real app on :4021 or a real daemon. Records what
 * was sent to /act and which task bodies were created.
 */
function installCanopyFetchStub(
  t: TestContext,
  actResponse: Record<string, unknown>,
  taskId = "task-canopy-stub",
): { act: Array<Record<string, unknown>>; tasks: Array<Record<string, unknown>> } {
  const act: Array<Record<string, unknown>> = [];
  const tasks: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (url.endsWith("/act") && init?.method === "POST") {
      act.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(actResponse), { status: 200 });
    }
    if (url.endsWith("/tasks") && init?.method === "POST") {
      tasks.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ _id: taskId, title: "Canopy Browser stub task" }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  return { act, tasks };
}

const CANOPY_OK_RESPONSE = {
  ok: true,
  failedStep: null,
  refusal: null,
  humanLoginRequired: null,
  steps: [
    { index: 0, action: "navigate", ok: true, detail: "navigated to https://canopy-ok.example.com/report" },
    { index: 1, action: "extract", ok: true, detail: "extracted 42 chars, 1 links" },
  ],
  finalPage: {
    url: "https://canopy-ok.example.com/report",
    title: "Quarterly report",
    text: "Revenue is up.",
    links: [{ title: "Details", url: "https://canopy-ok.example.com/details" }],
  },
};

test("the canopy engine sends jobType as the policy action and never re-checks policy locally", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));
  withCanopyEngine(t);
  const { act } = installCanopyFetchStub(t, CANOPY_OK_RESPONSE, "task-canopy-action-1");

  // A read-only site in HiveMatrix's local display cache. Pre-T6 this alone
  // refused the run; now the app decides, and the local row is metadata only.
  upsertBrowserSite({
    id: "canopy-readonly-cache",
    displayName: "Canopy Readonly Cache",
    homeUrl: "https://canopy-ok.example.com/home",
    allowedDomains: ["canopy-ok.example.com"],
    accessMode: "readonly",
  } as never);

  const out = await executeLaneTool("hivematrix_browser", {
    mode: "workflow",
    objective: "Fill out the lead intake form",
    startUrl: "https://canopy-ok.example.com/report",
    jobType: "form_fill",
  }, browserCtx());

  assert.equal(act.length, 1, "the run must reach the app — HiveMatrix no longer refuses it locally");
  assert.equal(act[0].action, "form_fill", "jobType is handed over as the app's policy action verb");
  assert.equal(act[0].requester, "browser-lane-test");
  assert.match(out, /completed/i);
});

test("the canopy engine surfaces the app's refusal verbatim and re-emits browser:blocked", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));
  withCanopyEngine(t);
  const message = "Readonly CRM A is configured read-only — the form_fill action would write to the site, which is refused. Switch its access mode to read-write in Canopy Browser settings if this action is intended.";
  const { tasks } = installCanopyFetchStub(t, {
    ok: false,
    failedStep: null,
    steps: [{ index: 0, action: "form_fill", ok: false, detail: message }],
    finalPage: null,
    humanLoginRequired: null,
    refusal: { code: "refusedReadOnly", siteId: "readonly-crm-a", siteName: "Readonly CRM A", message },
  }, "task-should-not-exist");

  const out = await executeLaneTool("hivematrix_browser", {
    mode: "workflow",
    objective: "Fill out the lead intake form",
    startUrl: "https://readonly-crm-a.example.com/leads/new",
    jobType: "form_fill",
  }, browserCtx());

  assert.match(out, /^Error: /, "a refusal must read as an error to the caller");
  assert.ok(out.includes(message), "the app's refusal message must be surfaced VERBATIM, not paraphrased");
  assert.equal(tasks.length, 0, "a refused run must not create a board task");

  const entry = readAudit({ event: "browser:blocked" }).find((e) => e.target === "readonly-crm-a");
  assert.ok(entry, "a refusal must still produce a browser:blocked audit event — the Command Log's Blocked filter reads it");
  assert.equal(entry!.status, "blocked");
  assert.equal(entry!.actorKind, "agent");
});

test("the canopy engine passes humanLoginRequired through unchanged and creates no board task", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));
  withCanopyEngine(t);
  const message = "Sign in to Example Portal in Canopy Browser, then retry — credentials are always a human click.";
  const { tasks } = installCanopyFetchStub(t, {
    ok: false,
    failedStep: null,
    steps: [{ index: 0, action: "navigate", ok: true, detail: "navigated" }],
    finalPage: null,
    refusal: null,
    humanLoginRequired: {
      code: "humanLoginRequired", siteId: "example-portal", siteName: "Example Portal",
      url: "https://portal.example.com/login", hasSavedCredential: false, message,
    },
  }, "task-should-not-exist-either");

  const out = await executeLaneTool("hivematrix_browser", {
    mode: "workflow",
    objective: "Check the portal inbox",
    startUrl: "https://portal.example.com/inbox",
    jobType: "authenticated_research",
    requiresLogin: true,
  }, browserCtx());

  assert.ok(out.includes(message), "the sign-in message must be surfaced unchanged");
  assert.equal(tasks.length, 0, "a login-walled run must not be recorded as a completed run");
});

test("the canopy engine writes a board task record (done, source browser-lane, transcript in output)", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));
  withCanopyEngine(t);
  const { tasks } = installCanopyFetchStub(t, CANOPY_OK_RESPONSE, "task-canopy-board-1");

  const out = await executeLaneTool("hivematrix_browser", {
    mode: "snapshot",
    objective: "Capture the quarterly report",
    startUrl: "https://canopy-ok.example.com/report",
    jobType: "capture",
  }, browserCtx());

  assert.equal(tasks.length, 1, "a direct run must still write a board record");
  const body = tasks[0];
  assert.equal(body.status, "done", "the run already happened — the record is terminal, never claimable");
  assert.equal(body.source, "browser-lane", "the board filters Browser Lane work by source");
  assert.equal(body.executor, "agent");
  const output = body.output as Record<string, Record<string, unknown>>;
  assert.ok(output.canopyBrowserRun, "the run must be recorded under output.canopyBrowserRun");
  assert.equal(output.canopyBrowserRun.engine, "canopy");
  assert.match(String(output.canopyBrowserRun.transcript), /Quarterly report/, "the transcript must be in the output");
  assert.match(String(body.description), /Revenue is up\./, "the board card must show what the run found");
  assert.match(out, /task-canopy-board-1/, "the caller is told where the run landed on the board");

  const entry = readAudit({ event: "browser:job_created" }).find((e) => e.taskId === "task-canopy-board-1");
  assert.ok(entry, "the run must be audited like a dispatch was");
  assert.equal(entry!.status, "completed");
});

test("the canopy engine reports prose steps as not executed instead of pretending they ran", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));
  withCanopyEngine(t);
  const { act } = installCanopyFetchStub(t, CANOPY_OK_RESPONSE, "task-canopy-prose-1");

  const out = await executeLaneTool("hivematrix_browser", {
    mode: "workflow",
    objective: "Check the invitations",
    startUrl: "https://canopy-ok.example.com/report",
    jobType: "triage",
    steps: ["click the invitations tab", "read the first three names"],
  }, browserCtx());

  assert.deepEqual(act[0].steps, [
    { action: "navigate", url: "https://canopy-ok.example.com/report" },
    { action: "extract" },
  ], "prose steps are not sent to /act — it drives selectors");
  assert.match(out, /Not executed/, "the caller must be told the prose steps did not run");
  assert.match(out, /click the invitations tab/);
});

test("the canopy engine reports an unreachable app instead of a silent failure", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));
  withCanopyEngine(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (String(input).endsWith("/act")) throw new Error("connect ECONNREFUSED 127.0.0.1:4021");
    return originalFetch(input, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const out = await executeLaneTool("hivematrix_browser", {
    mode: "open",
    objective: "Open the report",
    startUrl: "https://canopy-ok.example.com/report",
  }, browserCtx());

  assert.match(out, /^Error: Canopy Browser is unreachable/);
  assert.match(out, /4021/, "the error must name where the app is expected to be listening");
});

test("with browserLane.engine absent the Canopy Browser app is the default (T6 step 6)", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));
  const original = readFileSync(CANOPY_CONFIG_PATH, "utf-8");
  const withoutFlag = { ...JSON.parse(original) } as Record<string, unknown>;
  delete withoutFlag.browserLane;
  writeFileSync(CANOPY_CONFIG_PATH, JSON.stringify(withoutFlag));
  t.after(() => writeFileSync(CANOPY_CONFIG_PATH, original));
  const { act } = installCanopyFetchStub(t, CANOPY_OK_RESPONSE, "task-canopy-default-1");

  await executeLaneTool("hivematrix_browser", {
    mode: "open",
    objective: "Open the report",
    startUrl: "https://canopy-ok.example.com/report",
  }, browserCtx());

  assert.equal(act.length, 1, "with no flag set, browser work must go to the Canopy Browser app");
});

test("engine 'desktop' rolls the whole cutover back to the pre-T6 dispatch path", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));
  // The file-level config already pins engine:"desktop" — this asserts the lever
  // actually works, i.e. rollback is one config edit and nothing more.
  const { dispatched } = installBrowserLaneFetchStub(t, "task-rollback-1");

  const out = await executeLaneTool("hivematrix_browser", {
    mode: "open",
    objective: "Open the report",
    startUrl: "https://canopy-ok.example.com/report",
  }, browserCtx());

  assert.match(out, /Created Browser Lane task/, "engine 'desktop' must restore the pre-T6 dispatch path");
  assert.equal(dispatched.length, 1);
});

test("executeBrowserBeeRun allows authenticated_research against a readonly-access site and stamps actorKind", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));
  const { dispatched } = installBrowserLaneFetchStub(t, "task-readonly-research-1");

  upsertBrowserSite({
    id: "readonly-crm-b",
    displayName: "Readonly CRM B",
    homeUrl: "https://readonly-crm-b.example.com/home",
    allowedDomains: ["readonly-crm-b.example.com"],
    accessMode: "readonly",
  } as never);

  const out = await executeLaneTool("hivematrix_browser", {
    mode: "workflow",
    objective: "Research the account history",
    startUrl: "https://readonly-crm-b.example.com/accounts/42",
    jobType: "authenticated_research",
  }, browserCtx("agent"));

  assert.match(out, /Created Browser Lane task/, "a read-shaped job must still be allowed on a read-only site");
  assert.equal(dispatched.length, 1);

  const entry = readAudit({ event: "browser:job_created" }).find((e) => e.taskId === "task-readonly-research-1");
  assert.ok(entry, "the dispatch must be audited");
  assert.equal(entry!.actorKind, "agent");
});

test("executeBrowserBeeRun allows form_fill against a readwrite-access site and stamps actorKind", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));
  const { dispatched } = installBrowserLaneFetchStub(t, "task-readwrite-formfill-1");

  upsertBrowserSite({
    id: "readwrite-crm-c",
    displayName: "Readwrite CRM C",
    homeUrl: "https://readwrite-crm-c.example.com/home",
    allowedDomains: ["readwrite-crm-c.example.com"],
    accessMode: "readwrite",
  } as never);

  const out = await executeLaneTool("hivematrix_browser", {
    mode: "workflow",
    objective: "Fill out the lead intake form",
    startUrl: "https://readwrite-crm-c.example.com/leads/new",
    jobType: "form_fill",
  }, browserCtx("agent"));

  assert.match(out, /Created Browser Lane task/, "a write-shaped job on a readwrite site must be allowed");
  assert.equal(dispatched.length, 1);

  const entry = readAudit({ event: "browser:job_created" }).find((e) => e.taskId === "task-readwrite-formfill-1");
  assert.ok(entry, "the dispatch must be audited");
  assert.equal(entry!.actorKind, "agent");
});

test("executeBrowserBeeRun resolves the Desktop fallback to a Claude model, not a local model", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));

  // Force Codex into subscription (non-api-key) mode so resolveBrowserBeeBacking
  // cannot pick codex_computer_use — see src/lib/usage/codex.ts normalizeAuthMode:
  // auth_mode "chatgpt" + no OPENAI_API_KEY yields authMode "subscription".
  const codexAuthPath = join(SKILL_HOME, ".codex", "auth.json");
  const originalCodexAuth = readFileSync(codexAuthPath, "utf-8");
  writeFileSync(codexAuthPath, JSON.stringify({ auth_mode: "chatgpt", tokens: {} }));
  t.after(() => writeFileSync(codexAuthPath, originalCodexAuth));

  // Opt into the Desktop fallback for this test only.
  const configPath = join(SKILL_HOME, ".hivematrix", "config.json");
  const originalConfig = readFileSync(configPath, "utf-8");
  writeFileSync(configPath, JSON.stringify({ ...JSON.parse(originalConfig), browserLane: { engine: "desktop", desktopFallback: true } }));
  t.after(() => writeFileSync(configPath, originalConfig));

  let capturedBody: Record<string, unknown> | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (url.endsWith("/tasks") && init?.method === "POST") {
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ _id: "task-desktop-fallback-1", title: "stub" }), { status: 200 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  upsertBrowserSite({
    id: "fallback-site-a",
    displayName: "Fallback Site A",
    homeUrl: "https://fallback-site-a.example.com/home",
    allowedDomains: ["fallback-site-a.example.com"],
    accessMode: "readwrite",
  } as never);

  const out = await executeLaneTool("hivematrix_browser", {
    mode: "workflow",
    objective: "Log in and capture the account summary",
    startUrl: "https://fallback-site-a.example.com/login",
    jobType: "authenticated_research",
    requiresLogin: true,
  }, browserCtx());

  assert.match(out, /Created Browser Lane task/, "the Desktop fallback must dispatch, not error");
  assert.doesNotMatch(out, /configured local model/i, "must never require a local model");
  // TS can't see the closure assignment above; re-read through a cast local.
  const body = capturedBody as Record<string, unknown> | null;
  assert.ok(body, "the /tasks POST must have been captured");
  assert.match(String(body.model), /^(sonnet|opus|haiku)$/, "the fallback must run on a Claude model id");
});

test("executeBrowserLaneRead stamps actorKind onto its browser:read audit entry", async (t) => {
  getConnectivityPolicy().setManualOverride("cloud-ok");
  t.after(() => getConnectivityPolicy().setManualOverride(null));
  installBrowserLaneFetchStub(t);

  const marker = "actorKind-read-probe unique marker";
  await executeLaneTool("hivematrix_browser", { mode: "read", query: marker }, browserCtx("human", "browser-lane-read-test"));

  const entry = readAudit({ event: "browser:read" }).find((e) => e.prompt === marker);
  assert.ok(entry, "the read must be audited");
  assert.equal(entry!.actorKind, "human");
});

// ── Outbound safety: the trust/allowlist gate lives inside the tool ───────────

function mailIO(over: Partial<MailBeeSendIO> & { trusted: boolean }): { io: MailBeeSendIO; calls: string[] } {
  const calls: string[] = [];
  const io: MailBeeSendIO = {
    isChannelEnabled: () => true,
    isTrustedRecipient: () => over.trusted,
    sendMail: async () => { calls.push("send"); return true; },
    draftMail: async () => { calls.push("draft"); return true; },
    ...over,
  };
  return { io, calls };
}

test("mailbee_send SENDS to a trusted recipient", async () => {
  const { io, calls } = mailIO({ trusted: true });
  const out = await executeMailBeeSend({ to: "boss@known.com", subject: "Hi", body: "yo" }, io);
  assert.deepEqual(calls, ["send"]);
  assert.match(out, /Email sent to boss@known.com/);
});

test("mailbee_send DRAFTS (does not send) for an untrusted recipient", async () => {
  const { io, calls } = mailIO({ trusted: false });
  const out = await executeMailBeeSend({ to: "stranger@nope.com", subject: "Hi", body: "yo" }, io);
  assert.deepEqual(calls, ["draft"]); // crucially NOT "send"
  assert.match(out, /not on the Mail Lane trusted allowlist/);
  assert.doesNotMatch(out, /MailBee/);
  assert.match(out, /saved to Mail Drafts/);
  // Default autonomy (standard) shouldn't mention the dial at all.
  assert.doesNotMatch(out, /autonomy/i);
});

test("mailbee_send still DRAFTS (does not send) to an untrusted recipient under autonomous autonomy — the allowlist is a hard floor, not the dial", async () => {
  setAutonomyLevel("autonomous");
  const { io, calls } = mailIO({ trusted: false });
  const out = await executeMailBeeSend({ to: "stranger@nope.com", subject: "Hi", body: "yo" }, io);
  assert.deepEqual(calls, ["draft"]); // crucially NOT "send" — autonomy never bypasses the allowlist floor
  assert.match(out, /not on the Mail Lane trusted allowlist/);
  // The message should name the allowlist (not the autonomy dial) as the blocker.
  assert.match(out, /autonomy is set to autonomous/i);
  assert.match(out, /hard safety floor/i);
  assert.match(out, /autonomy dial does not bypass/i);
});

test("mailbee_send requires to + body", async () => {
  const { io, calls } = mailIO({ trusted: true });
  const out = await executeMailBeeSend({ to: "", subject: "x", body: "y" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /'to' and 'body' are required/);
});

test("mailbee_send refuses while Mail Lane is disabled before send or draft IO", async () => {
  const { io, calls } = mailIO({ trusted: true, isChannelEnabled: () => false });
  const out = await executeMailBeeSend({ to: "boss@known.com", subject: "Hi", body: "yo" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /Mail Lane is disabled/i);
});

test("mailbee_draft never sends, always drafts", async () => {
  const { io, calls } = mailIO({ trusted: true });
  const out = await executeMailBeeDraft({ to: "anyone@x.com", subject: "x", body: "y" }, io);
  assert.deepEqual(calls, ["draft"]);
  assert.match(out, /Draft saved to Mail Drafts/);
});

test("mailbee_draft refuses while Mail Lane is disabled before draft IO", async () => {
  const { io, calls } = mailIO({ trusted: true, isChannelEnabled: () => false });
  const out = await executeMailBeeDraft({ to: "anyone@x.com", subject: "x", body: "y" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /Mail Lane is disabled/i);
});

test("mailbee_send forwards attachments to Apple Mail (no Gmail needed)", async () => {
  let gotAttachments: string[] | undefined;
  const io: MailBeeSendIO = {
    isChannelEnabled: () => true,
    isTrustedRecipient: () => true,
    sendMail: async (_t, _s, _b, att) => { gotAttachments = att; return true; },
    draftMail: async () => true,
  };
  const out = await executeMailBeeSend(
    { to: "boss@known.com", subject: "files", body: "here", attachments: ["/a/x.png", "/a/y.png"] },
    io,
  );
  assert.deepEqual(gotAttachments, ["/a/x.png", "/a/y.png"]);
  assert.match(out, /with 2 attachment\(s\)/);
});

test("readAttachments accepts an array or a comma/newline list", async () => {
  const { readAttachments } = await import("./bee-tools");
  assert.deepEqual(readAttachments({ attachments: ["/a", "/b"] }), ["/a", "/b"]);
  assert.deepEqual(readAttachments({ attachment: "/a, /b\n/c" }), ["/a", "/b", "/c"]);
  assert.deepEqual(readAttachments({}), []);
});

function msgIO(allowed: boolean): { io: MessageBeeSendIO; calls: string[] } {
  const calls: string[] = [];
  const io: MessageBeeSendIO = {
    isSelf: () => false,
    isAllowed: () => allowed,
    sendIMessage: async () => { calls.push("send"); return true; },
    recordOutbound: () => { calls.push("record"); },
  };
  return { io, calls };
}

test("messagebee_send sends to an allowlisted handle and records outbound", async () => {
  const { io, calls } = msgIO(true);
  const out = await executeMessageBeeSend({ to: "+14155551234", text: "hi" }, io);
  assert.deepEqual(calls, ["send", "record"]);
  assert.match(out, /Message sent to \+14155551234/);
});

test("messagebee_send refuses a non-allowlisted handle (no send)", async () => {
  const { io, calls } = msgIO(false);
  const out = await executeMessageBeeSend({ to: "+19998887777", text: "hi" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /not on the Message Lane allowlist/);
  assert.doesNotMatch(out, /MessageBee/);
  // Default autonomy (standard) shouldn't mention the dial at all.
  assert.doesNotMatch(out, /autonomy/i);
});

test("messagebee_send still refuses a non-allowlisted handle under autonomous autonomy — the allowlist is a hard floor, not the dial", async () => {
  setAutonomyLevel("autonomous");
  const { io, calls } = msgIO(false);
  const out = await executeMessageBeeSend({ to: "+19998887777", text: "hi" }, io);
  assert.deepEqual(calls, []); // crucially no send — autonomy never bypasses the allowlist floor
  assert.match(out, /not on the Message Lane allowlist/);
  assert.match(out, /autonomy is set to autonomous/i);
  assert.match(out, /hard safety floor/i);
  assert.match(out, /autonomy dial does not bypass/i);
});

test("messagebee_send refuses while Message Lane is disabled before sending", async () => {
  const calls: string[] = [];
  const io: MessageBeeSendIO = {
    isChannelEnabled: () => false,
    isAllowed: () => { calls.push("allow"); return true; },
    sendIMessage: async () => { calls.push("send"); return true; },
    recordOutbound: () => { calls.push("record"); },
  };
  const out = await executeMessageBeeSend({ to: "+14155551234", text: "hi" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /Message Lane is disabled/i);
});

test("messagebee_send refuses a configured self handle before allowlist/send", async () => {
  const calls: string[] = [];
  const io: MessageBeeSendIO = {
    isSelf: () => true,
    isAllowed: () => { calls.push("allow"); return true; },
    sendIMessage: async () => { calls.push("send"); return true; },
    recordOutbound: () => { calls.push("record"); },
  };
  const out = await executeMessageBeeSend({ to: "+14155551234", text: "standby" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /self handle/i);
  assert.match(out, /loop/i);
});

test("messagebee_send forwards a voice-note attachment with no text required", async () => {
  let gotAttachments: string[] | undefined;
  const io: MessageBeeSendIO = {
    isSelf: () => false,
    isAllowed: () => true,
    sendIMessage: async (_h, _t, attachments) => { gotAttachments = attachments; return true; },
    recordOutbound: () => {},
  };
  const out = await executeMessageBeeSend({ to: "+14155551234", attachments: ["/tmp/voice-x.m4a"] }, io);
  assert.deepEqual(gotAttachments, ["/tmp/voice-x.m4a"]);
  assert.match(out, /with 1 attachment/);
});

test("messagebee_send requires either text or an attachment", async () => {
  const { io, calls } = msgIO(true);
  const out = await executeMessageBeeSend({ to: "+14155551234" }, io);
  assert.deepEqual(calls, []);
  assert.match(out, /required/);
});

// ── skill_run: run a skill from the library live, in this turn ───────────────

test("skill_run requires a name", async () => {
  const out = await executeLaneTool("skill_run", {}, ctx());
  assert.match(out, /'name'.*required/);
});

test("skill_run errors on an unknown skill name", async () => {
  const out = await executeLaneTool("skill_run", { name: "Totally Made Up Skill" }, ctx());
  assert.match(out, /no skill named "Totally Made Up Skill"/);
});

test("skill_run: instruction skill returns the body (params substituted) and records a use", async () => {
  await upsertSkill({ name: "Greet Someone", description: "d", body: "Say hello to {{who}}.", source: "test" });
  const out = await executeLaneTool("skill_run", { name: "Greet Someone", params: { who: "Ada" } }, ctx());
  assert.match(out, /Greet Someone/);
  assert.match(out, /Say hello to Ada\./);
  const s = await readSkill("Greet Someone");
  assert.equal(s?.useCount, 1);
});

test("skill_run: trusted script skill runs in the sandbox and returns stdout; records a use", async () => {
  await upsertSkill({ name: "Echo Hello", description: "d", body: "echo hello", source: "test", kind: "script", trusted: true });
  const out = await executeLaneTool("skill_run", { name: "Echo Hello" }, ctx());
  assert.match(out, /hello/);
  const s = await readSkill("Echo Hello");
  assert.equal(s?.useCount, 1);
  assert.equal(s?.failures, 0);
});

test("skill_run: untrusted, non-probation script skill is refused and NOT run", async () => {
  await upsertSkill({ name: "Untrusted Script", description: "d", body: "echo should-not-run", source: "test", kind: "script", trusted: false });
  const out = await executeLaneTool("skill_run", { name: "Untrusted Script" }, ctx());
  assert.match(out, /untrusted script/i);
  assert.match(out, /Trust it in the Skills view|probation/i);
  const s = await readSkill("Untrusted Script");
  assert.equal(s?.useCount, 0);
  assert.equal(s?.failures, 0);
});

test("skill_run: probationary script skill runs AND the reply is prefixed with the learned-recently announcement", async () => {
  await upsertSkill({ name: "Probation Script", description: "d", body: "echo probationary-output", source: "test", kind: "script", trusted: false, probation: true });
  const out = await executeLaneTool("skill_run", { name: "Probation Script" }, ctx());
  assert.match(out, /\(using a skill I learned recently\)/);
  assert.match(out, /probationary-output/);
  const s = await readSkill("Probation Script");
  assert.equal(s?.useCount, 1);
});

test("skill_run: scanVerdict block refuses a script skill without running it", async () => {
  await upsertSkill({ name: "Blocked Script", description: "d", body: "echo nope", source: "test", kind: "script", trusted: true, scanVerdict: "block" });
  const out = await executeLaneTool("skill_run", { name: "Blocked Script" }, ctx());
  assert.match(out, /blocked by the content scanner/);
  const s = await readSkill("Blocked Script");
  assert.equal(s?.useCount, 0);
  assert.equal(s?.failures, 0);
});

test("skill_run: a failing script gets an honest failure reply and increments failures", async () => {
  await upsertSkill({ name: "Failing Script", description: "d", body: "exit 3", source: "test", kind: "script", trusted: true });
  const out = await executeLaneTool("skill_run", { name: "Failing Script" }, ctx());
  assert.match(out, /fail/i);
  assert.match(out, /3/);
  const s = await readSkill("Failing Script");
  assert.equal(s?.useCount, 0);
  assert.equal(s?.failures, 1);
});

test("executeMessageBeeSend: concurrent sends against cap of 1 — exactly one delivery", async () => {
  // Clear the message_send_cap table for this test
  const db = await import("@/lib/db").then((m) => m.getDb());
  const sendCap = await import("@/lib/messagebee/send-cap");

  try {
    db.prepare("DELETE FROM message_send_cap").run();
  } catch (err) {
    // Table might not exist; that's ok
  }

  const runId = "concurrent-send-test-123";
  const recipient = "+15136595163";
  let sendCount = 0;
  let reserveAttempts = 0;

  // Mock MessageBeeSendIO. The real implementation has atomic reserve-before-send
  // enforced at BOTH the dispatch layer (executeMessageBeeSend) AND the send layer
  // (sendIMessage). This tests both layers.
  const mockIO: MessageBeeSendIO = {
    isChannelEnabled: () => true,
    isAllowed: () => true,
    getSelfHandles: () => ["test@icloud.com"],
    // Dispatch layer reserves before calling this
    attemptReserve: (rid: string, to: string) => {
      reserveAttempts++;
      return sendCap.attemptReserve(rid, to);
    },
    markSent: sendCap.markSent,
    // Send layer (fallback for direct calls)
    sendIMessage: async (_to, _text, _attachments, _sendAs, _timeoutMs, rid) => {
      // In the real code, sendIMessage also checks alreadySent() and isSlotClaimed()
      // For the mock, we just verify it was called and increment sendCount
      sendCount++;
      if (rid) {
        sendCap.markSent(rid, _to);
      }
      return true;
    },
    recordOutbound: () => {
      /* no-op */
    },
  };

  // Concurrently invoke two sends with the same runId and recipient.
  // The atomic cap at the dispatch layer should allow exactly one through.
  const results = await Promise.all([
    executeMessageBeeSend(
      { to: recipient, text: "Test message 1" },
      mockIO,
      runId
    ),
    executeMessageBeeSend(
      { to: recipient, text: "Test message 2" },
      mockIO,
      runId
    ),
  ]);

  // Verify the dispatch layer attempted to reserve twice (both calls reached it)
  assert.equal(
    reserveAttempts,
    2,
    `Expected 2 reserve attempts at dispatch layer, got ${reserveAttempts}`
  );

  // Verify exactly one succeeded and one failed at the dispatch layer
  const successCount = results.filter((r) => r.includes("sent to") && r.includes("via Messages")).length;
  const failureCount = results.filter((r) => r.includes("already sent") || r.startsWith("Error:")).length;

  assert.equal(
    successCount,
    1,
    `Expected 1 successful send at dispatch level, got ${successCount}: ${JSON.stringify(results)}`
  );
  assert.equal(
    failureCount,
    1,
    `Expected 1 failed send at dispatch level, got ${failureCount}: ${JSON.stringify(results)}`
  );

  // Verify exactly one send was attempted (proving the cap blocked one before osascript)
  assert.equal(
    sendCount,
    1,
    `Expected exactly 1 osascript send attempt, got ${sendCount}. This proves the dispatch-layer atomic cap prevented double-send (the 2026-07-14 incident).`
  );

  // Verify the database reflects exactly one reservation (atomic UNIQUE constraint)
  const records = db.prepare(
    "SELECT COUNT(*) as cnt FROM message_send_cap WHERE runId = ? AND recipient = ?"
  ).get(runId, recipient) as { cnt: number };
  assert.equal(records.cnt, 1, "Exactly one cap record should exist");
});

test("executeMessageBeeSend: concurrent dispatch racing daemon restart — exactly one delivery", async () => {
  // REGRESSION TEST for the 2026-07-14 incident.
  // Scenario: Two concurrent daemon processes (simulating a daemon restart race)
  // both try to execute the same directive (weaver-daily-audit) with the same runId.
  // The atomic cap at the dispatch layer should ensure exactly one delivery.
  const db = await import("@/lib/db").then((m) => m.getDb());
  const sendCap = await import("@/lib/messagebee/send-cap");

  try {
    db.prepare("DELETE FROM message_send_cap").run();
  } catch (err) {
    // Table might not exist
  }

  const runId = "weaver-daily-audit-daemon-restart-2026-07-14";
  const recipient = "+15136595163";
  const deliveries: { processId: number; delivered: boolean }[] = [];

  const mockIO: MessageBeeSendIO = {
    isChannelEnabled: () => true,
    isAllowed: () => true,
    getSelfHandles: () => ["test@icloud.com"],
    attemptReserve: sendCap.attemptReserve,
    markSent: sendCap.markSent,
    // Simulate osascript send (fast operation)
    sendIMessage: async (_to, _text, _attachments, _sendAs, _timeoutMs, rid) => {
      if (rid) {
        sendCap.markSent(rid, _to);
      }
      return true;
    },
    recordOutbound: () => {
      /* no-op */
    },
  };

  // Simulate two concurrent daemon processes (e.g., process 1 sends while process 2 starts up)
  // Each has its own async context and both try to execute executeMessageBeeSend
  const processResults = await Promise.all([
    // Process 1: First daemon instance
    (async () => {
      const result = await executeMessageBeeSend(
        { to: recipient, text: "Audit report for 2026-07-14" },
        mockIO,
        runId
      );
      const delivered = result.includes("sent to") && result.includes("via Messages");
      deliveries.push({ processId: 1, delivered });
      return { processId: 1, result, delivered };
    })(),
    // Process 2: Second daemon instance (restart race)
    (async () => {
      const result = await executeMessageBeeSend(
        { to: recipient, text: "Audit report for 2026-07-14" },
        mockIO,
        runId
      );
      const delivered = result.includes("sent to") && result.includes("via Messages");
      deliveries.push({ processId: 2, delivered });
      return { processId: 2, result, delivered };
    })(),
  ]);

  // Verify exactly one process succeeded in delivering
  const successfulDeliveries = deliveries.filter((d) => d.delivered).length;
  assert.equal(
    successfulDeliveries,
    1,
    `REGRESSION FAILURE: Expected 1 delivery in daemon-restart scenario, got ${successfulDeliveries} (2026-07-14 incident was 8 deliveries). Results: ${JSON.stringify(processResults)}`
  );

  // Verify exactly one process failed (cap rejected its dispatch)
  const failedDeliveries = deliveries.filter((d) => !d.delivered).length;
  assert.equal(
    failedDeliveries,
    1,
    `Expected 1 failed delivery attempt, got ${failedDeliveries}`
  );

  // Verify the cap table reflects exactly one reservation
  const capRecords = db.prepare(
    "SELECT COUNT(*) as cnt FROM message_send_cap WHERE runId = ? AND recipient = ?"
  ).get(runId, recipient) as { cnt: number };
  assert.equal(
    capRecords.cnt,
    1,
    "Exactly one cap record should exist; concurrent dispatch attempts are atomic at the UNIQUE constraint"
  );

  // Verify the record is marked as sent
  const sentRecords = db.prepare(
    "SELECT sentAt FROM message_send_cap WHERE runId = ? AND recipient = ? AND sentAt IS NOT NULL"
  ).all(runId, recipient) as Array<{ sentAt: string }>;
  assert.equal(
    sentRecords.length,
    1,
    "Exactly one record should be marked as sent"
  );
});
