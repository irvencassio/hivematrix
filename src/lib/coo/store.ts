import { generateId, getDb } from "@/lib/db";
import { laneDisplayName, type LaneId } from "@/lib/lanes/contracts";
import {
  normalizeCooRoutingRule,
  resolveCooRoute,
  type CooResolvedRoute,
  type CooRouteRequest,
  type CooRoutingRule,
} from "./routing-rules";

// SQL-backed persistence for COO (Chief Operating Officer) routing rules.
//
// The rule contract (validation, lane canonicalization, in-memory resolution)
// lives in ./routing-rules. This module is the only place that touches the
// coo_routing_rules / coo_routing_rule_history tables. Rules are always stored
// and resolved against canonical lane ids — normalizeCooRoutingRule maps legacy
// capability names (e.g. "browserbee" -> "browser") on write, so persisted rows
// only ever carry the seven canonical lanes while older callers keep working.

interface CooRoutingRuleRow {
  _id: string;
  name: string;
  priority: number;
  enabled: number;
  intent: string;
  match_json: string;
  constraints_json: string;
  lane: string;
  capability: string;
  backend_policy: string;
  model_posture: string;
  risk_tier: string;
  approval_policy: string;
  verification_policy: string;
  notes: string;
}

export interface CooRoutingRuleHistoryEntry {
  id: string;
  ruleId: string;
  action: "create" | "update" | "delete";
  before: CooRoutingRule | null;
  after: CooRoutingRule | null;
  actor: string;
  createdAt: string;
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowToRule(row: CooRoutingRuleRow): CooRoutingRule {
  // Re-run normalization on read so legacy rows are upgraded to canonical lane
  // ids and the in-memory shape is always validated, never trusted raw.
  return normalizeCooRoutingRule({
    id: row._id,
    name: row.name,
    priority: row.priority,
    enabled: row.enabled === 1,
    intent: row.intent,
    match: parseObject(row.match_json),
    constraints: parseObject(row.constraints_json),
    lane: row.lane,
    capability: row.capability,
    backendPolicy: row.backend_policy,
    modelPosture: row.model_posture,
    riskTier: row.risk_tier,
    approvalPolicy: parseObject(row.approval_policy),
    verificationPolicy: parseObject(row.verification_policy),
    notes: row.notes,
  });
}

function recordHistory(action: CooRoutingRuleHistoryEntry["action"], ruleId: string, before: CooRoutingRule | null, after: CooRoutingRule | null, actor: string): void {
  getDb().prepare(`
    INSERT INTO coo_routing_rule_history (_id, ruleId, action, before_json, after_json, actor)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    generateId(),
    ruleId,
    action,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    actor,
  );
}

export function getCooRoutingRule(id: string): CooRoutingRule | null {
  const row = getDb().prepare("SELECT * FROM coo_routing_rules WHERE _id = ?").get(id) as CooRoutingRuleRow | undefined;
  return row ? rowToRule(row) : null;
}

export interface ListCooRoutingRulesFilter {
  lane?: LaneId | null;
  enabledOnly?: boolean;
}

export function listCooRoutingRules(filter: ListCooRoutingRulesFilter = {}): CooRoutingRule[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.enabledOnly) clauses.push("enabled = 1");
  if (filter.lane) {
    clauses.push("lane = ?");
    params.push(filter.lane);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb().prepare(`
    SELECT * FROM coo_routing_rules
    ${where}
    ORDER BY priority DESC, name COLLATE NOCASE ASC, _id ASC
  `).all(...params) as CooRoutingRuleRow[];
  return rows.map(rowToRule);
}

export function upsertCooRoutingRule(input: unknown, actor = "hive"): CooRoutingRule {
  const db = getDb();
  // Generate an id when callers omit one so the contract's required-id rule is
  // satisfied while the daemon stays ergonomic for "create" requests.
  const seeded = input && typeof input === "object" && !Array.isArray(input)
    ? { ...(input as Record<string, unknown>) }
    : input;
  if (seeded && typeof seeded === "object" && !Array.isArray(seeded) && !(seeded as Record<string, unknown>).id) {
    (seeded as Record<string, unknown>).id = generateId();
  }
  const rule = normalizeCooRoutingRule(seeded);
  const before = getCooRoutingRule(rule.id);

  db.prepare(`
    INSERT INTO coo_routing_rules
      (_id, name, priority, enabled, intent, match_json, constraints_json, lane, capability,
       backend_policy, model_posture, risk_tier, approval_policy, verification_policy, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(_id) DO UPDATE SET
      name = excluded.name,
      priority = excluded.priority,
      enabled = excluded.enabled,
      intent = excluded.intent,
      match_json = excluded.match_json,
      constraints_json = excluded.constraints_json,
      lane = excluded.lane,
      capability = excluded.capability,
      backend_policy = excluded.backend_policy,
      model_posture = excluded.model_posture,
      risk_tier = excluded.risk_tier,
      approval_policy = excluded.approval_policy,
      verification_policy = excluded.verification_policy,
      notes = excluded.notes,
      updatedAt = datetime('now')
  `).run(
    rule.id,
    rule.name,
    rule.priority,
    rule.enabled ? 1 : 0,
    rule.intent,
    JSON.stringify(rule.match),
    JSON.stringify(rule.constraints),
    rule.lane,
    rule.capability,
    rule.backendPolicy,
    rule.modelPosture,
    rule.riskTier,
    JSON.stringify(rule.approvalPolicy),
    JSON.stringify(rule.verificationPolicy),
    rule.notes,
  );

  recordHistory(before ? "update" : "create", rule.id, before, rule, actor);
  return getCooRoutingRule(rule.id)!;
}

export function deleteCooRoutingRule(id: string, actor = "hive"): boolean {
  const before = getCooRoutingRule(id);
  if (!before) return false;
  getDb().prepare("DELETE FROM coo_routing_rules WHERE _id = ?").run(id);
  recordHistory("delete", id, before, null, actor);
  return true;
}

export function listCooRoutingRuleHistory(ruleId: string, limit = 50): CooRoutingRuleHistoryEntry[] {
  const rows = getDb().prepare(`
    SELECT * FROM coo_routing_rule_history
    WHERE ruleId = ?
    ORDER BY createdAt DESC, rowid DESC
    LIMIT ?
  `).all(ruleId, Math.max(1, Math.min(500, Math.floor(limit)))) as Array<{
    _id: string;
    ruleId: string;
    action: CooRoutingRuleHistoryEntry["action"];
    before_json: string | null;
    after_json: string | null;
    actor: string;
    createdAt: string;
  }>;
  return rows.map((row) => ({
    id: row._id,
    ruleId: row.ruleId,
    action: row.action,
    before: row.before_json ? (JSON.parse(row.before_json) as CooRoutingRule) : null,
    after: row.after_json ? (JSON.parse(row.after_json) as CooRoutingRule) : null,
    actor: row.actor,
    createdAt: row.createdAt,
  }));
}

export interface CooResolvedRouteWithDisplay extends CooResolvedRoute {
  laneDisplayName: string;
}

/**
 * Resolve a routing request against the persisted, enabled rules. Pure read —
 * loads enabled rows ordered by priority and defers the match logic to the
 * in-memory resolver so behaviour stays identical to resolveCooRoute().
 */
export function resolveCooRouteFromRules(request: CooRouteRequest): CooResolvedRouteWithDisplay | null {
  const rules = listCooRoutingRules({ enabledOnly: true });
  const route = resolveCooRoute(request, rules);
  if (!route) return null;
  return { ...route, laneDisplayName: laneDisplayName(route.lane) };
}

// ------------------------------------------------------------------
// Canonical default routing table (one representative rule per lane).
// Low priority (10) so operator-authored rules always win. Seeded on demand;
// idempotent by stable id, so re-seeding never duplicates or clobbers edits.
// ------------------------------------------------------------------
export const DEFAULT_COO_ROUTING_RULES: ReadonlyArray<Record<string, unknown>> = [
  {
    id: "default.message",
    name: "Default — Message Lane",
    priority: 10,
    intent: "messaging",
    match: { phrases: ["text", "imessage", "sms", "send a message"] },
    lane: "message",
    capability: "message.send",
    riskTier: "external_side_effect",
    notes: "Canonical default route for outbound SMS/iMessage.",
  },
  {
    id: "default.mail",
    name: "Default — Mail Lane",
    priority: 10,
    intent: "email",
    match: { phrases: ["email", "send mail", "draft an email"] },
    lane: "mail",
    capability: "mail.send",
    riskTier: "external_side_effect",
    notes: "Canonical default route for outbound mail.",
  },
  {
    id: "default.browser",
    name: "Default — Browser Lane",
    priority: 10,
    intent: "authenticated_browser_workflow",
    match: { phrases: ["browser", "log into", "on the website", "fill the form"] },
    lane: "browser",
    capability: "workflow.run",
    riskTier: "external_side_effect",
    notes: "Canonical default route for authenticated browser workflows.",
  },
  {
    id: "default.terminal",
    name: "Default — Terminal Lane",
    priority: 10,
    intent: "shell",
    match: { phrases: ["run command", "terminal", "shell", "npm", "git"] },
    lane: "terminal",
    capability: "terminal.run",
    riskTier: "normal",
    notes: "Canonical default route for local shell commands.",
  },
  {
    id: "default.desktop",
    name: "Default — Desktop Lane",
    priority: 10,
    intent: "desktop_action",
    match: { phrases: ["desktop", "click the app", "open the app"] },
    lane: "desktop",
    capability: "desktop.action",
    riskTier: "external_side_effect",
    notes: "Canonical default route for native desktop control.",
  },
  {
    id: "default.memory",
    name: "Default — Memory Lane",
    priority: 10,
    intent: "memory",
    match: { phrases: ["remember", "recall", "take a note", "save to brain"] },
    lane: "memory",
    capability: "memory.write",
    riskTier: "normal",
    notes: "Canonical default route for brain/memory operations.",
  },
  {
    id: "default.review",
    name: "Default — Review Lane",
    priority: 10,
    intent: "review",
    match: { phrases: ["review", "check my work", "verify this"] },
    lane: "review",
    capability: "review.run",
    riskTier: "normal",
    notes: "Canonical default route for review/verification work.",
  },
];

/**
 * Insert the canonical default rules. Idempotent: an existing rule (matched by
 * stable id) is left untouched so operator edits and enable/disable choices are
 * never overwritten. Returns the count of rules newly created.
 */
export function seedDefaultCooRoutingRules(actor = "seed"): number {
  let created = 0;
  for (const rule of DEFAULT_COO_ROUTING_RULES) {
    if (getCooRoutingRule(rule.id as string)) continue;
    upsertCooRoutingRule(rule, actor);
    created += 1;
  }
  return created;
}
