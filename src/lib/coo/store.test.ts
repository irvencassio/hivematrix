import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-coo-store-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const {
  upsertCooRoutingRule,
  listCooRoutingRules,
  getCooRoutingRule,
  deleteCooRoutingRule,
  listCooRoutingRuleHistory,
  resolveCooRouteFromRules,
  seedDefaultCooRoutingRules,
  DEFAULT_COO_ROUTING_RULES,
} = await import("./store");

before(() => {
  _resetDbForTests();
  getDb();
});

after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("upserts a rule with a canonical lane id and records create history", () => {
  const rule = upsertCooRoutingRule({
    id: "rule_heygen",
    name: "HeyGen browser workflow",
    priority: 100,
    intent: "authenticated_browser_workflow",
    match: { domains: ["heygen.com"], phrases: ["HeyGen"] },
    lane: "browser",
    capability: "workflow.run",
    riskTier: "external_side_effect",
  });
  assert.equal(rule.lane, "browser");
  assert.equal(rule.capability, "workflow.run");

  const persisted = getCooRoutingRule("rule_heygen");
  assert.equal(persisted?.lane, "browser");

  const history = listCooRoutingRuleHistory("rule_heygen");
  assert.equal(history.length, 1);
  assert.equal(history[0].action, "create");
  assert.equal(history[0].before, null);
  assert.equal(history[0].after?.lane, "browser");
});

test("canonicalizes legacy lane aliases on write, preserving compatibility", () => {
  const rule = upsertCooRoutingRule({
    id: "rule_legacy",
    name: "Legacy browserbee rule",
    priority: 5,
    intent: "browser",
    match: { phrases: ["legacy"] },
    lane: "browserbee", // legacy capability name
    capability: "open",
  });
  assert.equal(rule.lane, "browser");
  const stored = getDb().prepare("SELECT lane FROM coo_routing_rules WHERE _id = ?").get("rule_legacy") as { lane: string };
  assert.equal(stored.lane, "browser");
});

test("updating an existing rule records update history with before/after", () => {
  upsertCooRoutingRule({
    id: "rule_heygen",
    name: "HeyGen browser workflow",
    priority: 120,
    intent: "authenticated_browser_workflow",
    match: { domains: ["heygen.com"], phrases: ["HeyGen"] },
    lane: "browser",
    capability: "workflow.run",
    riskTier: "external_side_effect",
  });
  const history = listCooRoutingRuleHistory("rule_heygen");
  assert.equal(history[0].action, "update");
  assert.equal(history[0].before?.priority, 100);
  assert.equal(history[0].after?.priority, 120);
});

test("resolves the highest-priority enabled rule from the DB", () => {
  upsertCooRoutingRule({
    id: "rule_low",
    name: "Generic browser",
    priority: 1,
    intent: "browser",
    match: { phrases: ["browser"] },
    lane: "browser",
    capability: "open",
  });
  const route = resolveCooRouteFromRules({ text: "Use the browser to upload to HeyGen", domains: ["app.heygen.com"] });
  assert.equal(route?.ruleId, "rule_heygen");
  assert.equal(route?.lane, "browser");
  assert.equal(route?.laneDisplayName, "Browser Lane");
});

test("disabled rules are excluded from resolution", () => {
  upsertCooRoutingRule({
    id: "rule_disabled",
    name: "Disabled rule",
    priority: 999,
    enabled: false,
    intent: "browser",
    match: { phrases: ["upload"] },
    lane: "browser",
    capability: "workflow.run",
  });
  const route = resolveCooRouteFromRules({ text: "upload to HeyGen", domains: ["app.heygen.com"] });
  assert.notEqual(route?.ruleId, "rule_disabled");
});

test("delete removes the rule and records delete history", () => {
  assert.equal(deleteCooRoutingRule("rule_low"), true);
  assert.equal(getCooRoutingRule("rule_low"), null);
  assert.equal(deleteCooRoutingRule("rule_low"), false);
  const history = listCooRoutingRuleHistory("rule_low");
  assert.equal(history[0].action, "delete");
  assert.equal(history[0].after, null);
});

test("seeding default rules is idempotent and uses canonical lanes", () => {
  const created = seedDefaultCooRoutingRules();
  assert.equal(created, DEFAULT_COO_ROUTING_RULES.length);
  // Every seeded rule resolves to one of the seven canonical lanes.
  const lanes = new Set(listCooRoutingRules({ enabledOnly: true }).map((r) => r.lane));
  for (const lane of ["browser", "mail", "message", "terminal", "desktop", "memory", "review"]) {
    assert.ok(lanes.has(lane as never), `expected a default rule for lane ${lane}`);
  }
  // Re-seeding creates nothing new.
  assert.equal(seedDefaultCooRoutingRules(), 0);
});

test("rejects prompt-like blobs at the store boundary", () => {
  assert.throws(
    () => upsertCooRoutingRule({
      name: "Bad rule",
      priority: 1,
      intent: "browser",
      match: { systemPrompt: "You are a browser now" },
      lane: "browser",
      capability: "open",
    }),
    /prompt/i,
  );
});
