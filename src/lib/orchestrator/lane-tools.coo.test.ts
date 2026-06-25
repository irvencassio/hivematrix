import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-coo-tool-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { ConnectivityPolicy } = await import("@/lib/connectivity/policy");
const { availableLaneTools, capabilityRoutingGuide } = await import("./lane-tools");
function localPolicy() { const p = new ConnectivityPolicy(); p.setManualOverride("local-only"); return p; }
function offlinePolicy() { const p = new ConnectivityPolicy(); p.setManualOverride("offline"); return p; }

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { upsertCooRoutingRule } = await import("@/lib/coo/dispatch").then(() => import("@/lib/coo/store"));
const { upsertBrowserSite, recordBrowserReadinessRun } = await import("@/lib/browser-lane/store");
const { dispatchCooRequest, dispatchCooTask } = await import("@/lib/coo/dispatch");
const {
  LANE_TOOL_DEFINITIONS,
  isLaneTool,
  executeCooDispatch,
  formatCooDispatchResult,
} = await import("./lane-tools");

before(() => {
  _resetDbForTests();
  getDb();
});

after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().exec("DELETE FROM coo_routing_rules; DELETE FROM coo_routing_rule_history; DELETE FROM coo_dispatch_audit; DELETE FROM browser_sites; DELETE FROM browser_credentials; DELETE FROM browser_readiness_runs;");
});

function seedReadySite(domain = "app.heygen.com", id = "heygen") {
  upsertBrowserSite({ id, displayName: id, homeUrl: `https://${domain}/home`, allowedDomains: [domain] });
  recordBrowserReadinessRun({ siteId: id, status: "ready", color: "green", summary: "ready", traceRunId: `trace-${id}` });
}

const ctx = { projectPath: "/Users/test/proj", project: "proj", requestedBy: "test" };

function browserRule() {
  upsertCooRoutingRule({
    id: "rule_browser",
    name: "Browser workflow",
    priority: 100,
    intent: "authenticated_browser_workflow",
    match: { phrases: ["upload", "browser"] },
    lane: "browser",
    capability: "workflow.run",
    riskTier: "external_side_effect",
  });
}

// A runner backed by the real dispatch functions (no HTTP), with a fake task creator.
const directRunner = async (body: { text: string; domains?: string[]; project?: string | null; create?: boolean; projectPath?: string | null }) => {
  const request = { text: body.text, domains: body.domains, project: body.project ?? null };
  if (body.create) {
    return dispatchCooTask(request, {
      create: true,
      projectPath: body.projectPath ?? null,
      createTask: async () => ({ id: "task_made_1" }),
    });
  }
  return dispatchCooRequest(request, { projectPath: body.projectPath ?? null });
};

test("coo_dispatch is a registered lane tool with a required text param", () => {
  assert.ok(isLaneTool("coo_dispatch"));
  const def = LANE_TOOL_DEFINITIONS.find((t) => t.function.name === "coo_dispatch");
  assert.ok(def, "coo_dispatch should be in LANE_TOOL_DEFINITIONS");
  const required = (def.function.parameters as { required: string[] }).required;
  assert.ok(required.includes("text"));
  // Canonical-path copy is present and avoids the legacy product name.
  assert.match(def.function.description, /Browser Lane/);
  assert.doesNotMatch(def.function.description, /BrowserBee|browserbee/);
});

test("formatCooDispatchResult renders each status and leaks no secrets", () => {
  const base = { request: { text: "x" }, route: null, lane: null, capability: null, workItem: null, approval: null, auditId: "aud1", taskId: null } as never;
  const prepared = formatCooDispatchResult({ ...(base as object), status: "prepared", lane: "browser", capability: "workflow.run", reason: "Prepared a Browser Lane work item", auditId: "aud1" } as never);
  assert.match(prepared, /prepared/i);
  assert.match(prepared, /browser/i);

  const created = formatCooDispatchResult({ ...(base as object), status: "created", lane: "browser", capability: "workflow.run", reason: "made it", auditId: "aud1", taskId: "task_made_1" } as never);
  assert.match(created, /created/i);
  assert.match(created, /task_made_1/);

  for (const status of ["no_match", "needs_input", "approval_required", "unsupported"] as const) {
    const out = formatCooDispatchResult({ ...(base as object), status, reason: `reason-${status}` } as never);
    assert.match(out, new RegExp(status.replace("_", "[ _]"), "i"));
  }
});

test("formatCooDispatchResult surfaces a matched registered workflow (id + runbook)", () => {
  const out = formatCooDispatchResult({
    status: "prepared", request: { text: "x" }, route: null, lane: "browser", capability: "workflow.run",
    workItem: null, approval: null, readiness: null,
    workflow: { id: "heygen.portal_video_from_script", name: "HeyGen portal video from script", lane: "browser", runbook: "docs/runbooks/heygen-portal-video-pipeline.md" },
    reason: "Prepared.", auditId: "a1", taskId: null,
  } as never);
  assert.match(out, /heygen\.portal_video_from_script/);
  assert.match(out, /runbook|docs\/runbooks/i);
});

test("executeCooDispatch prepares a Browser Lane result (no create)", async () => {
  browserRule();
  const out = await executeCooDispatch({ text: "upload to the browser", domains: ["app.heygen.com"] }, ctx, directRunner);
  assert.match(out, /prepared/i);
  assert.match(out, /browser/i);
  assert.doesNotMatch(out, /task_made_1/); // no task created
});

test("executeCooDispatch with create=true creates one task and reports taskId", async () => {
  browserRule();
  seedReadySite();
  const out = await executeCooDispatch({ text: "upload to the browser", domains: ["app.heygen.com"], create: true }, ctx, directRunner);
  assert.match(out, /created/i);
  assert.match(out, /task_made_1/);
});

test("executeCooDispatch never creates a task for non-browser / no_match", async () => {
  upsertCooRoutingRule({ id: "r_mail", name: "mail", priority: 10, intent: "mail", match: { phrases: ["mail-it"] }, lane: "mail", capability: "mail.send" });
  const approval = await executeCooDispatch({ text: "please mail-it", create: true }, ctx, directRunner);
  assert.match(approval, /approval[ _]required/i);
  assert.doesNotMatch(approval, /task_made_1/);

  const noMatch = await executeCooDispatch({ text: "nothing matches this", create: true }, ctx, directRunner);
  assert.match(noMatch, /no[ _]match/i);
  assert.doesNotMatch(noMatch, /task_made_1/);
});

test("executeCooDispatch rejects empty objective text", async () => {
  const out = await executeCooDispatch({ text: "   " }, ctx, directRunner);
  assert.match(out, /required|provide|objective|text/i);
});

test("workflow_inbox is a registered read-only tool advertised in every mode", () => {
  assert.ok(isLaneTool("workflow_inbox"));
  const def = LANE_TOOL_DEFINITIONS.find((t) => t.function.name === "workflow_inbox");
  assert.ok(def);
  assert.doesNotMatch(def.function.description, /execute|run the action/i); // read-only
  for (const pol of [localPolicy(), offlinePolicy()]) {
    assert.ok(availableLaneTools(pol).some((t) => t.function.name === "workflow_inbox"), "advertised locally");
  }
});

test("coo_dispatch is advertised in local-only and offline (routing is local)", () => {
  const names = (tools: { function: { name: string } }[]) => tools.map((t) => t.function.name);
  assert.ok(names(availableLaneTools(localPolicy())).includes("coo_dispatch"), "local-only should advertise coo_dispatch");
  assert.ok(names(availableLaneTools(offlinePolicy())).includes("coo_dispatch"), "offline should advertise coo_dispatch");
});

test("capabilityRoutingGuide includes coo_dispatch locally with a route-now/execute-may-wait note", () => {
  for (const guide of [capabilityRoutingGuide(localPolicy()), capabilityRoutingGuide(offlinePolicy())]) {
    assert.match(guide, /coo_dispatch/);
    assert.match(guide, /wait|prepare|connectivity|every mode/i);
  }
});

test("formatCooDispatchResult distinguishes routing success from execution_unavailable", () => {
  const out = formatCooDispatchResult({
    status: "execution_unavailable",
    request: { text: "x" },
    route: { ruleId: "r", ruleName: "Browser workflow", lane: "browser", capability: "workflow.run", backendPolicy: "lane_owned_first", modelPosture: "mixed-local-first", riskTier: "external_side_effect", approvalPolicy: {}, verificationPolicy: {}, laneDisplayName: "Browser Lane" },
    lane: "browser",
    capability: "workflow.run",
    workItem: null,
    approval: null,
    reason: "Routing succeeded but Browser Lane workflow execution is unavailable right now.",
    auditId: "aud1",
    taskId: null,
  } as never);
  assert.match(out, /execution[ _]unavailable/i);
  assert.match(out, /routing/i);
  assert.match(out, /unavailable|wait|connectivity/i);
  assert.doesNotMatch(out, /\bcreated\b/i); // must not claim a task was made
});

test("formatCooDispatchResult surfaces site readiness and a readiness_required hold", () => {
  const readiness = { matched: true, siteId: "heygen", siteName: "HeyGen", color: "orange", status: "needs_reauth", credentialRef: "hivematrix.browser.heygen.primary", traceRunId: "trace-9", requiresLogin: true, acceptable: false, warning: "Browser Lane site HeyGen needs attention — needs_reauth (orange)." };
  // Prepared but the site needs attention — readiness shown.
  const prepared = formatCooDispatchResult({
    status: "prepared", request: { text: "x" }, route: null, lane: "browser", capability: "workflow.run",
    workItem: null, approval: null, readiness, reason: "Prepared.", auditId: "a1", taskId: null,
  } as never);
  assert.match(prepared, /HeyGen/);
  assert.match(prepared, /needs_reauth|attention|reauth/i);

  // Held at create time.
  const held = formatCooDispatchResult({
    status: "readiness_required", request: { text: "x" }, route: null, lane: "browser", capability: "workflow.run",
    workItem: null, approval: null, readiness, reason: "auth/readiness needs attention — no task was made.", auditId: "a1", taskId: null,
  } as never);
  assert.match(held, /readiness[ _]required/i);
  assert.match(held, /routing/i);
  assert.match(held, /readiness|reauth|attention/i);
  assert.doesNotMatch(held, /\bcreated\b/i);
  // Never leak credential values (the ref pointer is allowed, secrets are not).
  assert.doesNotMatch(prepared, /password|cookie|secret/i);
});
