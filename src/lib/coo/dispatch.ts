import { generateId, getDb } from "@/lib/db";
import { laneDisplayName, type LaneId } from "@/lib/lanes/contracts";
import { DEFAULT_TASK_PROJECT } from "@/lib/routing/project-constants";
import {
  buildBrowserBeeTaskRequestEnvelope,
  parseBrowserBeeJobCreate,
  type BrowserBeeTaskRequestEnvelope,
} from "@/lib/browser-lane/jobs";
import { resolveCooRouteFromRules, type CooResolvedRouteWithDisplay } from "./store";
import type { CooRouteRequest } from "./routing-rules";

/** Thrown for malformed dispatch input. Raised BEFORE any audit row is written. */
export class CooDispatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CooDispatchValidationError";
  }
}

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
  | "created"
  | "execution_unavailable"
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
  taskId: string | null;
}

export interface CooDispatchOptions {
  /** Real execution project root for the prepared browser envelope (validated by the caller). */
  projectPath?: string | null;
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
  projectPath: string | null,
): CooDispatchWorkItem | null {
  const startUrl = firstStartUrl(request);
  if (!startUrl) return null;
  // Project *label* (never a path) — defaults to the inbox project, never the
  // literal "hive". The real execution root is requestedProjectPath, supplied
  // only when a task is actually created.
  const projectLabel = request.project ?? DEFAULT_TASK_PROJECT;
  const payload = parseBrowserBeeJobCreate({
    objective: request.text,
    startUrl,
    project: projectLabel,
    requestedBy: "coo",
    requiresLogin: route.capability === "workflow.run",
  });
  // Pure: default codex_computer_use backing. The real engine/backing is
  // re-decided when the lane actually executes (executeBrowserBeeRun). Carry the
  // real project root if the caller resolved one; otherwise the label stands in
  // until a root is bound at create time.
  const envelope = buildBrowserBeeTaskRequestEnvelope(payload, projectPath ?? projectLabel);
  return { envelopeId: generateId(), lane: "browser", capability: route.capability, envelope };
}

export function dispatchCooRequest(request: CooDispatchRequest, options: CooDispatchOptions = {}): CooDispatchResult {
  // Validate BEFORE any audit write — invalid input must not leave a trail.
  if (typeof request.text !== "string" || request.text.trim().length === 0) {
    throw new CooDispatchValidationError("dispatch request text must be a non-empty string");
  }

  const route = resolveCooRouteFromRules(request);

  if (!route) {
    const reason = "No enabled COO routing rule matched this request.";
    const auditId = recordCooDispatchAudit({ request, route: null, status: "no_match", workItemId: null, reason });
    return { status: "no_match", request, route: null, lane: null, capability: null, workItem: null, approval: null, reason, auditId, taskId: null };
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
    workItem = buildBrowserWorkItem(request, route, options.projectPath ?? null);
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

  return { status, request, route, lane: route.lane, capability: route.capability, workItem, approval, reason, auditId, taskId: null };
}

// ------------------------------------------------------------------
// Explicit, opt-in task creation. dispatchCooRequest stays pure/prepare-only;
// this async wrapper turns a Browser-Lane *prepared* result into a real task via
// an injected creator (testable without a live DB/daemon). Only "prepared"
// browser results create a task — approval_required, unsupported, needs_input,
// and no_match never do.
// ------------------------------------------------------------------
export interface CooTaskCreateInput {
  workItem: CooDispatchWorkItem;
  projectPath: string;
  route: CooResolvedRouteWithDisplay;
  request: CooDispatchRequest;
}

export type CooTaskCreator = (input: CooTaskCreateInput) => Promise<{ id: string }>;

export interface CooDispatchTaskOptions {
  create?: boolean;
  /** Real execution project root (validated by the caller). Required to create a task. */
  projectPath?: string | null;
  createTask: CooTaskCreator;
  /**
   * Whether Browser Lane workflow execution is available right now (the caller
   * reads this from the connectivity policy). Defaults to true. When false, a
   * browser create is held as execution_unavailable instead of being created —
   * routing still succeeds, execution waits. No silent reroute to another lane.
   */
  browserAvailable?: boolean;
}

export async function dispatchCooTask(
  request: CooDispatchRequest,
  options: CooDispatchTaskOptions,
): Promise<CooDispatchResult> {
  const base = dispatchCooRequest(request, { projectPath: options.projectPath ?? null });
  // Only a prepared Browser-Lane result with a real project root may create a task.
  if (!options.create || base.status !== "prepared" || !base.workItem || !base.route) {
    return base;
  }
  // Honest execution gating: route succeeded, but only create when Browser Lane
  // workflow execution is actually available. No silent downgrade to another lane.
  if (options.browserAvailable === false) {
    const reason = `Routing succeeded (Browser Lane · ${base.capability}, rule "${base.route.ruleName}"), but Browser Lane workflow execution is unavailable right now — no task was created. It will run once connectivity is restored.`;
    if (base.auditId) updateCooDispatchAuditStatus(base.auditId, "execution_unavailable", reason);
    return { ...base, status: "execution_unavailable", reason };
  }
  if (!options.projectPath) {
    return { ...base, reason: `${base.reason} A real projectPath is required to create the task.` };
  }

  const { id } = await options.createTask({
    workItem: base.workItem,
    projectPath: options.projectPath,
    route: base.route,
    request,
  });
  if (base.auditId) updateCooDispatchAuditTask(base.auditId, id, "created");
  return { ...base, status: "created", taskId: id };
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
  taskId: string | null;
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
  taskId: string | null;
  reason: string;
  createdAt: string;
}

/**
 * Redact obvious secrets before they are persisted to the audit log. Covers
 * `password|secret|token|api-key|...key = value` (and `: value`) plus bearer
 * tokens. Over-redaction is acceptable in an audit trail; under-redaction is not.
 * Applied ONLY at persist time — routing and the returned work item use the
 * original request text.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let s = input;
  // Bearer tokens: "Bearer <token>"
  s = s.replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]");
  // Sensitive key=value / key: value (key name may include hyphens/underscores).
  s = s.replace(
    /\b([A-Za-z0-9_-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|key)[A-Za-z0-9_-]*)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi,
    "$1=[redacted]",
  );
  return s;
}

function recordCooDispatchAudit(input: {
  request: CooDispatchRequest;
  route: CooResolvedRouteWithDisplay | null;
  status: CooDispatchStatus;
  workItemId: string | null;
  reason: string;
}): string {
  const id = generateId();
  // Context holds only routing signals — and is redacted as defence in depth in
  // case a secret slipped into a project/workflow/tag/domain string.
  const context = {
    domains: (input.request.domains ?? []).map(redactSecrets),
    project: input.request.project ? redactSecrets(input.request.project) : null,
    workflow: input.request.workflow ? redactSecrets(input.request.workflow) : null,
    tags: (input.request.tags ?? []).map(redactSecrets),
  };
  getDb().prepare(`
    INSERT INTO coo_dispatch_audit (_id, requestText, requestContext, ruleId, ruleName, lane, capability, status, workItemId, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    redactSecrets(input.request.text),
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
    taskId: row.taskId ?? null,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

function updateCooDispatchAuditTask(id: string, taskId: string, status: CooDispatchStatus): void {
  getDb().prepare("UPDATE coo_dispatch_audit SET taskId = ?, status = ? WHERE _id = ?").run(taskId, status, id);
}

function updateCooDispatchAuditStatus(id: string, status: CooDispatchStatus, reason: string): void {
  getDb().prepare("UPDATE coo_dispatch_audit SET status = ?, reason = ? WHERE _id = ?").run(status, reason, id);
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
