import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-coo-dispatch-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { upsertCooRoutingRule } = await import("./store");
const {
  dispatchCooRequest,
  dispatchCooTask,
  CooDispatchValidationError,
  listCooDispatchAudit,
  getCooDispatchAudit,
} = await import("./dispatch");

function countAuditRows(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM coo_dispatch_audit").get() as { n: number }).n;
}

function browserRule(id = "rule_browser") {
  upsertCooRoutingRule({
    id,
    name: "Browser workflow",
    priority: 100,
    intent: "authenticated_browser_workflow",
    match: { phrases: ["upload", "browser"] },
    lane: "browser",
    capability: "workflow.run",
    riskTier: "external_side_effect",
  });
}

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

test("browser route prepares a Browser Lane-ready work item", () => {
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

  const result = dispatchCooRequest({ text: "Upload this script in the browser", domains: ["app.heygen.com"] });

  assert.equal(result.status, "prepared");
  assert.equal(result.lane, "browser");
  assert.equal(result.capability, "workflow.run");
  assert.ok(result.workItem, "expected a browser work item");
  assert.equal(result.workItem.lane, "browser");
  assert.equal(result.workItem.envelope.startUrl, "https://app.heygen.com/");
  assert.equal(result.workItem.envelope.requiresLogin, true);
  assert.ok(result.workItem.envelopeId);
  assert.ok(result.auditId, "expected an audit row id");
});

test("no matching rule returns a clear no_match result with no work item", () => {
  const result = dispatchCooRequest({ text: "something with no rule" });
  assert.equal(result.status, "no_match");
  assert.equal(result.route, null);
  assert.equal(result.workItem, null);
  assert.ok(result.reason.length > 0);
});

test("a disabled rule does not match (resolves to no_match)", () => {
  upsertCooRoutingRule({
    id: "rule_disabled",
    name: "Disabled browser",
    priority: 999,
    enabled: false,
    intent: "browser",
    match: { phrases: ["disabled-phrase"] },
    lane: "browser",
    capability: "workflow.run",
  });
  const result = dispatchCooRequest({ text: "trigger the disabled-phrase", domains: ["example.com"] });
  assert.equal(result.status, "no_match");
});

test("legacy lane alias on a rule normalizes to a canonical lane for dispatch", () => {
  upsertCooRoutingRule({
    id: "rule_legacy",
    name: "Legacy browserbee rule",
    priority: 50,
    intent: "browser",
    match: { phrases: ["legacy browser"] },
    lane: "browserbee", // legacy capability name
    capability: "open",
  });
  const result = dispatchCooRequest({ text: "do a legacy browser thing", domains: ["example.com"] });
  assert.equal(result.lane, "browser");
  assert.equal(result.status, "prepared");
});

test("channel/native lanes return approval_required without acting", () => {
  for (const [lane, capability] of [
    ["mail", "mail.send"],
    ["message", "message.send"],
    ["desktop", "desktop.action"],
    ["terminal", "terminal.run"],
  ] as const) {
    upsertCooRoutingRule({
      id: `rule_${lane}`,
      name: `${lane} rule`,
      priority: 10,
      intent: lane,
      match: { phrases: [`do-${lane}`] },
      lane,
      capability,
    });
    const result = dispatchCooRequest({ text: `please do-${lane} now` });
    assert.equal(result.status, "approval_required", `${lane} should require approval`);
    assert.equal(result.lane, lane);
    assert.equal(result.workItem, null);
    assert.ok(result.approval?.required, `${lane} approval flag`);
    assert.ok(result.approval.trust.length > 0, `${lane} trust note`);
  }
});

test("a sensitive-risk browser rule escalates to approval_required", () => {
  upsertCooRoutingRule({
    id: "rule_sensitive",
    name: "Sensitive browser",
    priority: 100,
    intent: "authenticated_browser_workflow",
    match: { phrases: ["sensitive upload"] },
    lane: "browser",
    capability: "workflow.run",
    riskTier: "sensitive",
  });
  const result = dispatchCooRequest({ text: "sensitive upload to the bank", domains: ["bank.example.com"] });
  assert.equal(result.status, "approval_required");
  assert.equal(result.workItem, null);
});

test("browser route with no derivable URL returns needs_input", () => {
  upsertCooRoutingRule({
    id: "rule_browser_nourl",
    name: "Browser workflow",
    priority: 100,
    intent: "authenticated_browser_workflow",
    match: { phrases: ["browse"] },
    lane: "browser",
    capability: "workflow.run",
  });
  const result = dispatchCooRequest({ text: "browse and find something" }); // no domains
  assert.equal(result.status, "needs_input");
  assert.equal(result.workItem, null);
  assert.match(result.reason, /url|domain/i);
});

test("unsupported lanes (memory/review) report no execution bridge yet", () => {
  upsertCooRoutingRule({
    id: "rule_memory",
    name: "Memory rule",
    priority: 10,
    intent: "memory",
    match: { phrases: ["remember this"] },
    lane: "memory",
    capability: "memory.write",
  });
  const result = dispatchCooRequest({ text: "remember this fact" });
  assert.equal(result.status, "unsupported");
});

test("dispatch persists an audit row with rule, lane, status, reason and no secret fields", () => {
  upsertCooRoutingRule({
    id: "rule_audit",
    name: "Audit browser",
    priority: 100,
    intent: "authenticated_browser_workflow",
    match: { phrases: ["audit upload"] },
    lane: "browser",
    capability: "workflow.run",
  });
  const result = dispatchCooRequest({ text: "audit upload to site", domains: ["example.com"] });
  assert.ok(result.auditId);

  const audit = getCooDispatchAudit(result.auditId);
  assert.ok(audit);
  assert.equal(audit.ruleId, "rule_audit");
  assert.equal(audit.ruleName, "Audit browser");
  assert.equal(audit.lane, "browser");
  assert.equal(audit.capability, "workflow.run");
  assert.equal(audit.status, "prepared");
  assert.ok(audit.reason.length > 0);

  const row = getDb().prepare("SELECT * FROM coo_dispatch_audit WHERE _id = ?").get(result.auditId) as Record<string, unknown>;
  assert.equal("password" in row, false);
  assert.equal("secret" in row, false);
  assert.equal("cookie" in row, false);

  const recent = listCooDispatchAudit(10);
  assert.equal(recent[0].id, result.auditId);
});

// ── Hardening: validation ─────────────────────────────────────────────

test("empty or whitespace text throws a validation error and writes no audit row", () => {
  const before = countAuditRows();
  assert.throws(() => dispatchCooRequest({ text: "   " }), (err: unknown) => err instanceof CooDispatchValidationError);
  assert.throws(() => dispatchCooRequest({ text: "" }), (err: unknown) => err instanceof CooDispatchValidationError);
  assert.equal(countAuditRows(), before, "no audit rows should be written for invalid input");
});

// ── Hardening: audit redaction ────────────────────────────────────────

test("obvious secrets are redacted from the persisted audit but routing uses the original text", () => {
  browserRule();
  const secrets = [
    "upload with password=hunter2 to the browser",
    "browser upload using token=abc.def-123",
    "browser upload api-key=sk_live_9999",
    "browser upload Authorization: Bearer abcXYZ123",
    "browser upload key=topsecretvalue",
  ];
  for (const text of secrets) {
    const result = dispatchCooRequest({ text, domains: ["app.heygen.com"] });
    // Routing still works on the original text.
    assert.equal(result.lane, "browser");
    const audit = getCooDispatchAudit(result.auditId!);
    assert.ok(audit);
    for (const leak of ["hunter2", "abc.def-123", "sk_live_9999", "abcXYZ123", "topsecretvalue"]) {
      assert.ok(!audit.requestText.includes(leak), `audit must not leak "${leak}" — got: ${audit.requestText}`);
    }
    assert.ok(audit.requestText.includes("[redacted]"), `expected a redaction marker in: ${audit.requestText}`);
  }
});

test("project label no longer falls back to the literal 'hive'", () => {
  browserRule();
  const result = dispatchCooRequest({ text: "browser upload something", domains: ["example.com"] });
  assert.ok(result.workItem);
  assert.notEqual(result.workItem.envelope.project, "hive");
});

// ── Explicit task creation ────────────────────────────────────────────

test("browser prepared result creates exactly one task when create=true and returns taskId", async () => {
  browserRule();
  const calls: Array<{ projectPath: string; lane: string }> = [];
  const createTask = async (input: { workItem: { lane: string }; projectPath: string }) => {
    calls.push({ projectPath: input.projectPath, lane: input.workItem.lane });
    return { id: "task_created_1" };
  };
  const result = await dispatchCooTask(
    { text: "browser upload to site", domains: ["app.heygen.com"] },
    { create: true, projectPath: "/Users/test/proj", createTask },
  );
  assert.equal(result.status, "created");
  assert.equal(result.taskId, "task_created_1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lane, "browser");

  const audit = getCooDispatchAudit(result.auditId!);
  assert.equal(audit?.taskId, "task_created_1");
  assert.equal(audit?.status, "created");
});

test("dispatchCooTask without create flag stays prepare-only (no task)", async () => {
  browserRule();
  let called = 0;
  const createTask = async () => { called += 1; return { id: "nope" }; };
  const result = await dispatchCooTask(
    { text: "browser upload to site", domains: ["app.heygen.com"] },
    { create: false, projectPath: "/Users/test/proj", createTask },
  );
  assert.equal(result.status, "prepared");
  assert.equal(result.taskId, null);
  assert.equal(called, 0);
});

test("create=true is blocked honestly when Browser Lane execution is unavailable", async () => {
  browserRule();
  let called = 0;
  const createTask = async () => { called += 1; return { id: "should-not-create" }; };
  const result = await dispatchCooTask(
    { text: "browser upload to site", domains: ["app.heygen.com"] },
    { create: true, projectPath: "/Users/test/proj", createTask, browserAvailable: false },
  );
  assert.equal(result.status, "execution_unavailable");
  assert.equal(result.taskId, null);
  assert.equal(called, 0, "must not create a task when Browser Lane is unavailable");
  // Routing still succeeded — the route + prepared work item are present.
  assert.equal(result.lane, "browser");
  assert.ok(result.workItem, "routing prepared a work item even though execution is unavailable");
  assert.match(result.reason, /unavailable|connectivity|wait/i);

  // Audit reflects the held state (no taskId).
  const audit = getCooDispatchAudit(result.auditId!);
  assert.equal(audit?.status, "execution_unavailable");
  assert.equal(audit?.taskId, null);
});

test("create=true still creates when Browser Lane execution is available (browserAvailable:true)", async () => {
  browserRule();
  let called = 0;
  const createTask = async () => { called += 1; return { id: "task_ok_1" }; };
  const result = await dispatchCooTask(
    { text: "browser upload to site", domains: ["app.heygen.com"] },
    { create: true, projectPath: "/Users/test/proj", createTask, browserAvailable: true },
  );
  assert.equal(result.status, "created");
  assert.equal(result.taskId, "task_ok_1");
  assert.equal(called, 1);
});

test("create=true never creates a task for approval_required / no_match / needs_input", async () => {
  // approval-required lane
  upsertCooRoutingRule({ id: "r_mail", name: "mail", priority: 10, intent: "mail", match: { phrases: ["mail-it"] }, lane: "mail", capability: "mail.send" });
  // browser rule but request will lack a URL → needs_input
  upsertCooRoutingRule({ id: "r_brnourl", name: "browser nourl", priority: 20, intent: "browser", match: { phrases: ["browse-nourl"] }, lane: "browser", capability: "workflow.run" });

  let called = 0;
  const createTask = async () => { called += 1; return { id: "should-not-happen" }; };

  const approval = await dispatchCooTask({ text: "please mail-it now" }, { create: true, projectPath: "/Users/test/proj", createTask });
  assert.equal(approval.status, "approval_required");
  assert.equal(approval.taskId, null);

  const noMatch = await dispatchCooTask({ text: "totally unmatched request" }, { create: true, projectPath: "/Users/test/proj", createTask });
  assert.equal(noMatch.status, "no_match");

  const needsInput = await dispatchCooTask({ text: "browse-nourl please" }, { create: true, projectPath: "/Users/test/proj", createTask });
  assert.equal(needsInput.status, "needs_input");

  assert.equal(called, 0, "createTask must never be called for non-prepared results");
});
