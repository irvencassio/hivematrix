/**
 * Workflow action handoffs — a run can durably PROPOSE a next workflow, and an
 * operator/model later EXECUTES it explicitly. Generic: execution routes through the
 * registered workflow's handler (prepareWorkflowById), never bespoke per-target code.
 * Nothing auto-executes; no secrets are stored (suggested inputs are key-redacted).
 */

import { generateId, getDb } from "@/lib/db";
import { ContractValidationError } from "@/lib/central/contracts";
import { appendWorkflowRunEvent } from "./runs";
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
  status: WorkflowActionStatus;
  resultRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowActionRow {
  _id: string; sourceRunId: string; targetWorkflowId: string; title: string; reason: string;
  required_inputs_json: string; suggested_inputs_json: string; status: WorkflowActionStatus;
  resultRunId: string | null; createdAt: string; updatedAt: string;
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

function rowToAction(row: WorkflowActionRow): WorkflowActionRecord {
  return {
    id: row._id, sourceRunId: row.sourceRunId, targetWorkflowId: row.targetWorkflowId, title: row.title, reason: row.reason,
    requiredInputs: parseArray(row.required_inputs_json), suggestedInputs: parseObject(row.suggested_inputs_json),
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
}

export function proposeWorkflowAction(input: ProposeWorkflowActionInput): WorkflowActionRecord {
  const def = getWorkflowRegistry().get(input.targetWorkflowId);
  if (!def) throw new ContractValidationError(`unknown targetWorkflowId "${input.targetWorkflowId}" — not in the registry`);
  // Required inputs default to the target def's required fields.
  const requiredInputs = input.requiredInputs ?? def.inputSchema.filter((f) => f.required).map((f) => f.name);
  const id = generateId();
  getDb().prepare(`
    INSERT INTO workflow_actions (_id, sourceRunId, targetWorkflowId, title, reason, required_inputs_json, suggested_inputs_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed')
  `).run(
    id, input.sourceRunId, def.id, input.title, input.reason ?? "",
    JSON.stringify(requiredInputs), JSON.stringify(redact(input.suggestedInputs ?? {})),
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
  status: "prepared" | "needs_input" | "unsupported" | "invalid";
  actionId: string;
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

/**
 * Execute a proposed action: merge the target's schema-matched suggested inputs with
 * the operator's inputs; if a required field is still missing, return needs_input with
 * the exact field names (no guessing). Otherwise dispatch the registered handler.
 */
export async function executeWorkflowAction(id: string, operatorInputs: Record<string, unknown> = {}, deps: ExecuteWorkflowActionDeps = {}): Promise<ExecuteWorkflowActionResult> {
  const action = getWorkflowAction(id);
  if (!action) return { ok: false, status: "invalid", actionId: id, reason: "action not found" };
  if (action.status === "completed") return { ok: true, status: "prepared", actionId: id, resultRunId: action.resultRunId ?? undefined, reason: "already executed" };
  if (action.status === "refused") return { ok: false, status: "invalid", actionId: id, reason: "action was refused" };

  const def = getWorkflowRegistry().get(action.targetWorkflowId);
  if (!def) return { ok: false, status: "unsupported", actionId: id, reason: "target workflow no longer registered" };

  // Only the target's actual input fields satisfy requirements — a "scriptDraft"
  // suggestion never silently becomes "script".
  const fieldNames = new Set(def.inputSchema.map((f) => f.name));
  const suggested: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(action.suggestedInputs)) if (fieldNames.has(k)) suggested[k] = v;
  const merged = { ...suggested, ...operatorInputs };

  const missing = action.requiredInputs.filter((name) => !hasValue(merged[name]));
  if (missing.length) {
    return { ok: false, status: "needs_input", actionId: id, missing };
  }

  const prepare = deps.prepare ?? (async (wid: string, inputs: Record<string, unknown>) => (await import("./prepare")).prepareWorkflowById(wid, inputs));
  const out = await prepare(def.id, merged);
  if (!out.ok || out.status === "needs_input") {
    updateWorkflowActionStatus(id, "accepted");
    return { ok: false, status: out.status === "needs_input" ? "needs_input" : "unsupported", actionId: id, missing: out.missing, result: out.result, reason: out.reason };
  }
  updateWorkflowActionStatus(id, "completed", { resultRunId: out.runId ?? null });
  appendWorkflowRunEvent(action.sourceRunId, "action.executed", `Executed action → ${def.id}`, { actionId: id, resultRunId: out.runId ?? null });
  return { ok: true, status: "prepared", actionId: id, resultRunId: out.runId, result: out.result };
}
