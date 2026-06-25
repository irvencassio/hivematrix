import { generateId, getDb } from "@/lib/db";
import { laneDisplayName, type LaneId } from "@/lib/lanes/contracts";
import {
  buildBrowserBeeTaskRequestEnvelope,
  parseBrowserBeeJobCreate,
  type BrowserBeeTaskRequestEnvelope,
} from "@/lib/browser-lane/jobs";
import { resolveCooRouteFromRules, type CooResolvedRouteWithDisplay } from "./store";
import type { CooRouteRequest } from "./routing-rules";

// COO route-to-execution bridge.
//
// resolveCooRouteFromRules() answers "which lane + capability + policy"; this
// module turns that into a *safe* execution envelope. Browser is the first real
// executable path: a matched browser route is turned into a Browser-Lane-ready
// work item using the existing browser-lane/jobs abstractions. Channel and
// native lanes (mail/message/desktop/terminal) are returned as
// approval-required — the bridge never performs them. Memory/review have no
// bridge yet and are reported honestly as unsupported.
//
// No secrets ever flow through here: the browser work item carries only
// objective/url/steps. Credentials are resolved later by the lane itself via
// credentialRef indirection, outside this bridge.

export type CooDispatchRequest = CooRouteRequest;

export type CooDispatchStatus =
  | "no_match"
  | "prepared"
  | "approval_required"
  | "unsupported"
  | "needs_input";

export interface CooDispatchWorkItem {
  envelopeId: string;
  lane: "browser";
  capability: string;
  envelope: BrowserBeeTaskRequestEnvelope;
}

export interface CooDispatchApproval {
  required: boolean;
  trust: string;
}

export interface CooDispatchResult {
  status: CooDispatchStatus;
  request: CooDispatchRequest;
  route: CooResolvedRouteWithDisplay | null;
  lane: LaneId | null;
  capability: string | null;
  workItem: CooDispatchWorkItem | null;
  approval: CooDispatchApproval | null;
  reason: string;
  auditId: string | null;
}

type LaneDispatchMode = "executable" | "approval_required" | "unsupported";

interface LaneDispatchPolicy {
  mode: LaneDispatchMode;
  trust: string;
}

// Per-lane execution posture. Browser is the one executable lane in this slice;
// the channel/native lanes always announce their approval/trust boundary and
// never act here; memory/review have no bridge yet.
const LANE_DISPATCH_POLICY: Record<LaneId, LaneDispatchPolicy> = {
  browser: {
    mode: "executable",
    trust: "Browser Lane builds a work item; authenticated steps pause at the lane's own human-required auth checkpoints.",
  },
  mail: {
    mode: "approval_required",
    trust: "Mail Lane sends only to allowlisted recipients; anything else is drafted for human approval.",
  },
  message: {
    mode: "approval_required",
    trust: "Message Lane sends only to allowlisted handles; non-allowlisted recipients are refused.",
  },
  desktop: {
    mode: "approval_required",
    trust: "Desktop Lane controls native apps; actions need explicit approval before they run.",
  },
  terminal: {
    mode: "approval_required",
    trust: "Terminal Lane runs shell commands; the command must be reviewed before execution.",
  },
  memory: {
    mode: "unsupported",
    trust: "Memory Lane has no COO execution bridge yet.",
  },
  review: {
    mode: "unsupported",
    trust: "Review Lane has no COO execution bridge yet.",
  },
};

// Risk tiers that force human approval regardless of the lane's normal posture.
const APPROVAL_FORCING_RISK = new Set(["sensitive", "destructive"]);

function firstStartUrl(request: CooDispatchRequest): string | null {
  const domains = (request.domains ?? []).map((d) => d.trim()).filter(Boolean);
  if (domains.length === 0) return null;
  const raw = domains[0];
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function buildBrowserWorkItem(
  request: CooDispatchRequest,
  route: CooResolvedRouteWithDisplay,
): CooDispatchWorkItem | null {
  const startUrl = firstStartUrl(request);
  if (!startUrl) return null;
  const payload = parseBrowserBeeJobCreate({
    objective: request.text,
    startUrl,
    project: request.project ?? "hive",
    requestedBy: "coo",
    requiresLogin: route.capability === "workflow.run",
  });
  // Pure: default codex_computer_use backing. The real engine/backing is
  // re-decided when the lane actually executes (executeBrowserBeeRun).
  const envelope = buildBrowserBeeTaskRequestEnvelope(payload, request.project ?? "hive");
  return { envelopeId: generateId(), lane: "browser", capability: route.capability, envelope };
}

export function dispatchCooRequest(request: CooDispatchRequest): CooDispatchResult {
  const route = resolveCooRouteFromRules(request);

  if (!route) {
    const reason = "No enabled COO routing rule matched this request.";
    const auditId = recordCooDispatchAudit({ request, route: null, status: "no_match", workItemId: null, reason });
    return { status: "no_match", request, route: null, lane: null, capability: null, workItem: null, approval: null, reason, auditId };
  }

  const policy = LANE_DISPATCH_POLICY[route.lane];
  const escalated = APPROVAL_FORCING_RISK.has(route.riskTier);

  let status: CooDispatchStatus;
  let workItem: CooDispatchWorkItem | null = null;
  let approval: CooDispatchApproval | null = null;
  let reason: string;

  if (policy.mode === "unsupported") {
    status = "unsupported";
    reason = `No COO execution bridge for the ${laneDisplayName(route.lane)} yet (matched rule "${route.ruleName}").`;
  } else if (policy.mode === "approval_required" || escalated) {
    status = "approval_required";
    approval = { required: true, trust: policy.trust };
    reason = escalated && policy.mode === "executable"
      ? `Rule "${route.ruleName}" is risk-tier ${route.riskTier}; ${laneDisplayName(route.lane)} execution is held for explicit approval.`
      : `${laneDisplayName(route.lane)} requires approval before acting. ${policy.trust}`;
  } else {
    // Executable lane (browser).
    workItem = buildBrowserWorkItem(request, route);
    if (!workItem) {
      status = "needs_input";
      reason = `${laneDisplayName(route.lane)} needs a target URL/domain, but none could be derived from the request.`;
    } else {
      status = "prepared";
      reason = `Prepared a ${laneDisplayName(route.lane)} work item for capability "${route.capability}" (rule "${route.ruleName}").`;
    }
  }

  const auditId = recordCooDispatchAudit({
    request,
    route,
    status,
    workItemId: workItem?.envelopeId ?? null,
    reason,
  });

  return { status, request, route, lane: route.lane, capability: route.capability, workItem, approval, reason, auditId };
}

// ------------------------------------------------------------------
// Audit trail — append-only record answering: what was asked, which rule
// matched, where it routed, what was created, and why it was held/refused.
// ------------------------------------------------------------------
export interface CooDispatchAuditEntry {
  id: string;
  requestText: string;
  requestContext: Record<string, unknown>;
  ruleId: string | null;
  ruleName: string | null;
  lane: string | null;
  capability: string | null;
  status: CooDispatchStatus;
  workItemId: string | null;
  reason: string;
  createdAt: string;
}

interface CooDispatchAuditRow {
  _id: string;
  requestText: string;
  requestContext: string;
  ruleId: string | null;
  ruleName: string | null;
  lane: string | null;
  capability: string | null;
  status: CooDispatchStatus;
  workItemId: string | null;
  reason: string;
  createdAt: string;
}

function recordCooDispatchAudit(input: {
  request: CooDispatchRequest;
  route: CooResolvedRouteWithDisplay | null;
  status: CooDispatchStatus;
  workItemId: string | null;
  reason: string;
}): string {
  const id = generateId();
  // Context holds only routing signals — never secret material.
  const context = {
    domains: input.request.domains ?? [],
    project: input.request.project ?? null,
    workflow: input.request.workflow ?? null,
    tags: input.request.tags ?? [],
  };
  getDb().prepare(`
    INSERT INTO coo_dispatch_audit (_id, requestText, requestContext, ruleId, ruleName, lane, capability, status, workItemId, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.request.text,
    JSON.stringify(context),
    input.route?.ruleId ?? null,
    input.route?.ruleName ?? null,
    input.route?.lane ?? null,
    input.route?.capability ?? null,
    input.status,
    input.workItemId,
    input.reason,
  );
  return id;
}

function rowToAudit(row: CooDispatchAuditRow): CooDispatchAuditEntry {
  let context: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.requestContext);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) context = parsed as Record<string, unknown>;
  } catch {
    context = {};
  }
  return {
    id: row._id,
    requestText: row.requestText,
    requestContext: context,
    ruleId: row.ruleId,
    ruleName: row.ruleName,
    lane: row.lane,
    capability: row.capability,
    status: row.status,
    workItemId: row.workItemId,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export function getCooDispatchAudit(id: string): CooDispatchAuditEntry | null {
  const row = getDb().prepare("SELECT * FROM coo_dispatch_audit WHERE _id = ?").get(id) as CooDispatchAuditRow | undefined;
  return row ? rowToAudit(row) : null;
}

export function listCooDispatchAudit(limit = 50): CooDispatchAuditEntry[] {
  // rowid DESC is the monotonic tiebreak — _id is a random UUID and createdAt is
  // 1-second resolution, so same-second rows would otherwise order unpredictably.
  const rows = getDb().prepare(`
    SELECT * FROM coo_dispatch_audit
    ORDER BY createdAt DESC, rowid DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(500, Math.floor(limit)))) as CooDispatchAuditRow[];
  return rows.map(rowToAudit);
}
