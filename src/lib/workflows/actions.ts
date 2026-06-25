/**
 * Workflow action handoffs — a run can durably PROPOSE a next workflow, and an
 * operator/model later EXECUTES it explicitly. Generic: execution routes through the
 * registered workflow's handler (prepareWorkflowById), never bespoke per-target code.
 * Nothing auto-executes; no secrets are stored (suggested inputs are key-redacted).
 */

import { generateId, getDb } from "@/lib/db";
import { ContractValidationError } from "@/lib/central/contracts";
import { appendWorkflowRunEvent, getWorkflowRunRecord, isWorkflowRunReviewBlocked } from "./runs";
import { getWorkflowRegistry } from "./registry";

export type WorkflowActionStatus = "proposed" | "accepted" | "completed" | "refused" | "failed";

export interface WorkflowActionRecord {
  id: string;
  sourceRunId: string;
  targetWorkflowId: string;
  title: string;
  reason: string;
  requiredInputs: string[];
  suggestedInputs: Record<string, unknown>;
  /** target input field → source-run artifact key, resolved fresh at execute time. */
  sourceArtifactMap: Record<string, string>;
  status: WorkflowActionStatus;
  resultRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowActionRow {
  _id: string; sourceRunId: string; targetWorkflowId: string; title: string; reason: string;
  required_inputs_json: string; suggested_inputs_json: string; source_artifact_map_json: string | null;
  status: WorkflowActionStatus; resultRunId: string | null; createdAt: string; updatedAt: string;
}

const SECRET_KEY = /password|passwd|pwd|secret|token|cookie|session|credential|api[_-]?key|bearer|keychain/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v);
  return out;
}

function parseArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try { const p = JSON.parse(value); return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}
function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try { const p = JSON.parse(value); return p && typeof p === "object" && !Array.isArray(p) ? p as Record<string, unknown> : {}; } catch { return {}; }
}

function parseStringMap(value: string | null | undefined): Record<string, string> {
  const obj = parseObject(value);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) if (typeof v === "string") out[k] = v;
  return out;
}

function rowToAction(row: WorkflowActionRow): WorkflowActionRecord {
  return {
    id: row._id, sourceRunId: row.sourceRunId, targetWorkflowId: row.targetWorkflowId, title: row.title, reason: row.reason,
    requiredInputs: parseArray(row.required_inputs_json), suggestedInputs: parseObject(row.suggested_inputs_json),
    sourceArtifactMap: parseStringMap(row.source_artifact_map_json),
    status: row.status, resultRunId: row.resultRunId, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export interface ProposeWorkflowActionInput {
  sourceRunId: string;
  targetWorkflowId: string;
  title: string;
  reason?: string;
  requiredInputs?: string[];
  suggestedInputs?: Record<string, unknown>;
  sourceArtifactMap?: Record<string, string>;
}

export function proposeWorkflowAction(input: ProposeWorkflowActionInput): WorkflowActionRecord {
  const def = getWorkflowRegistry().get(input.targetWorkflowId);
  if (!def) throw new ContractValidationError(`unknown targetWorkflowId "${input.targetWorkflowId}" — not in the registry`);
  // Required inputs default to the target def's required fields.
  const requiredInputs = input.requiredInputs ?? def.inputSchema.filter((f) => f.required).map((f) => f.name);
  const id = generateId();
  getDb().prepare(`
    INSERT INTO workflow_actions (_id, sourceRunId, targetWorkflowId, title, reason, required_inputs_json, suggested_inputs_json, source_artifact_map_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed')
  `).run(
    id, input.sourceRunId, def.id, input.title, input.reason ?? "",
    JSON.stringify(requiredInputs), JSON.stringify(redact(input.suggestedInputs ?? {})),
    JSON.stringify(input.sourceArtifactMap ?? {}),
  );
  appendWorkflowRunEvent(input.sourceRunId, "action.proposed", `Proposed next workflow "${def.id}": ${input.title}`, { targetWorkflowId: def.id, actionId: id });
  return getWorkflowAction(id)!;
}

export function getWorkflowAction(id: string): WorkflowActionRecord | null {
  const row = getDb().prepare("SELECT * FROM workflow_actions WHERE _id = ?").get(id) as WorkflowActionRow | undefined;
  return row ? rowToAction(row) : null;
}

export function listWorkflowActions(filter: { sourceRunId?: string; status?: WorkflowActionStatus; limit?: number } = {}): WorkflowActionRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.sourceRunId) { clauses.push("sourceRunId = ?"); params.push(filter.sourceRunId); }
  if (filter.status) { clauses.push("status = ?"); params.push(filter.status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(500, Math.floor(filter.limit ?? 50)));
  const rows = getDb().prepare(`SELECT * FROM workflow_actions ${where} ORDER BY createdAt DESC, rowid DESC LIMIT ?`).all(...params, limit) as WorkflowActionRow[];
  return rows.map(rowToAction);
}

export function updateWorkflowActionStatus(id: string, status: WorkflowActionStatus, opts: { resultRunId?: string | null } = {}): WorkflowActionRecord | null {
  const sets = ["status = ?", "updatedAt = datetime('now')"];
  const params: unknown[] = [status];
  if ("resultRunId" in opts) { sets.push("resultRunId = ?"); params.push(opts.resultRunId ?? null); }
  params.push(id);
  getDb().prepare(`UPDATE workflow_actions SET ${sets.join(", ")} WHERE _id = ?`).run(...params);
  return getWorkflowAction(id);
}

export interface ExecuteWorkflowActionResult {
  ok: boolean;
  status: "prepared" | "needs_input" | "unsupported" | "invalid" | "review_required";
  actionId: string;
  sourceRunId?: string;
  missing?: string[];
  resultRunId?: string;
  result?: unknown;
  reason?: string;
}

export interface ExecuteWorkflowActionDeps {
  /** The generic prepare dispatcher (default: prepareWorkflowById). Injectable for tests. */
  prepare?: (workflowId: string, inputs: Record<string, unknown>) => Promise<{ ok: boolean; status: string; workflow: unknown; runId?: string; missing?: string[]; result?: unknown; reason?: string }>;
}

function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export type WorkflowActionReadiness =
  | "ready" | "review_required" | "needs_input" | "completed" | "refused" | "failed" | "unsupported" | "invalid";

export interface WorkflowActionAssessment {
  readiness: WorkflowActionReadiness;
  sourceRunId: string;
  missing?: string[];
  reason?: string;
  /** The resolved inputs (suggested ∩ schema + fresh source artifacts + operator). Internal. */
  merged: Record<string, unknown>;
}

/**
 * PURE, read-only assessment of a proposed action — the same gate + required-input logic
 * executeWorkflowAction uses, but it NEVER dispatches. The inbox and execution agree.
 */
export function assessWorkflowAction(action: WorkflowActionRecord, operatorInputs: Record<string, unknown> = {}): WorkflowActionAssessment {
  const base: WorkflowActionAssessment = { readiness: "ready", sourceRunId: action.sourceRunId, merged: {} };
  if (action.status === "completed") return { ...base, readiness: "completed" };
  if (action.status === "refused") return { ...base, readiness: "refused", reason: "action was refused" };
  if (action.status === "failed") return { ...base, readiness: "failed", reason: "action failed" };

  const def = getWorkflowRegistry().get(action.targetWorkflowId);
  if (!def) return { ...base, readiness: "unsupported", reason: "target workflow no longer registered" };

  const sourceRun = getWorkflowRunRecord(action.sourceRunId);
  if (sourceRun && isWorkflowRunReviewBlocked(sourceRun)) {
    return { ...base, readiness: "review_required", reason: `Source run "${action.sourceRunId}" (${sourceRun.status}) needs approval before this action can run.` };
  }

  // Only the target's actual input fields satisfy requirements — a "scriptDraft"
  // suggestion never silently becomes "script".
  const fieldNames = new Set(def.inputSchema.map((f) => f.name));
  const suggested: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(action.suggestedInputs)) if (fieldNames.has(k)) suggested[k] = v;
  // Fresh source artifacts (e.g. a revised script) override stale suggestions.
  const fresh: Record<string, unknown> = {};
  if (sourceRun) {
    for (const [inputName, artifactKey] of Object.entries(action.sourceArtifactMap)) {
      if (fieldNames.has(inputName) && sourceRun.artifacts[artifactKey] !== undefined) fresh[inputName] = sourceRun.artifacts[artifactKey];
    }
  }
  const merged = { ...suggested, ...fresh, ...operatorInputs };
  const missing = action.requiredInputs.filter((name) => !hasValue(merged[name]));
  if (missing.length) return { ...base, readiness: "needs_input", missing, merged };
  return { ...base, readiness: "ready", merged };
}

/**
 * Execute a proposed action — assesses it first (shared gate logic), and only dispatches
 * when ready. Returns needs_input with the exact missing fields, review_required when the
 * source run is unapproved, etc.
 */
export async function executeWorkflowAction(id: string, operatorInputs: Record<string, unknown> = {}, deps: ExecuteWorkflowActionDeps = {}): Promise<ExecuteWorkflowActionResult> {
  const action = getWorkflowAction(id);
  if (!action) return { ok: false, status: "invalid", actionId: id, reason: "action not found" };

  const a = assessWorkflowAction(action, operatorInputs);
  if (a.readiness === "completed") return { ok: true, status: "prepared", actionId: id, resultRunId: action.resultRunId ?? undefined, reason: "already executed" };
  if (a.readiness !== "ready") {
    const status: ExecuteWorkflowActionResult["status"] =
      a.readiness === "needs_input" ? "needs_input" : a.readiness === "review_required" ? "review_required" : a.readiness === "unsupported" ? "unsupported" : "invalid";
    return { ok: false, status, actionId: id, sourceRunId: a.sourceRunId, missing: a.missing, reason: a.reason };
  }

  const def = getWorkflowRegistry().get(action.targetWorkflowId)!;
  const prepare = deps.prepare ?? (async (wid: string, inputs: Record<string, unknown>) => (await import("./prepare")).prepareWorkflowById(wid, inputs));
  const out = await prepare(def.id, a.merged);
  if (!out.ok || out.status === "needs_input") {
    updateWorkflowActionStatus(id, "accepted");
    return { ok: false, status: out.status === "needs_input" ? "needs_input" : "unsupported", actionId: id, missing: out.missing, result: out.result, reason: out.reason };
  }
  updateWorkflowActionStatus(id, "completed", { resultRunId: out.runId ?? null });
  appendWorkflowRunEvent(action.sourceRunId, "action.executed", `Executed action → ${def.id}`, { actionId: id, resultRunId: out.runId ?? null });
  return { ok: true, status: "prepared", actionId: id, resultRunId: out.runId, result: out.result };
}
