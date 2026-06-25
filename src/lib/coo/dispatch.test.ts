import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-coo-dispatch-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const { upsertCooRoutingRule } = await import("./store");
const { dispatchCooRequest, listCooDispatchAudit, getCooDispatchAudit } = await import("./dispatch");

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
