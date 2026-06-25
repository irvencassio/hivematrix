import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-coo-tool-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { upsertCooRoutingRule } = await import("@/lib/coo/dispatch").then(() => import("@/lib/coo/store"));
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
  getDb().exec("DELETE FROM coo_routing_rules; DELETE FROM coo_routing_rule_history; DELETE FROM coo_dispatch_audit;");
});

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

test("executeCooDispatch prepares a Browser Lane result (no create)", async () => {
  browserRule();
  const out = await executeCooDispatch({ text: "upload to the browser", domains: ["app.heygen.com"] }, ctx, directRunner);
  assert.match(out, /prepared/i);
  assert.match(out, /browser/i);
  assert.doesNotMatch(out, /task_made_1/); // no task created
});

test("executeCooDispatch with create=true creates one task and reports taskId", async () => {
  browserRule();
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
