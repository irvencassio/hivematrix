/**
 * Workflow Run Ledger — durable run state, events, artifacts, and blockers for
 * registered workflows. Generic (works for any workflow); the HeyGen linkage lives
 * in heygen-run-link.ts. Never stores secrets: metadata + artifacts are key-redacted
 * on write.
 */

import { generateId, getDb } from "@/lib/db";
import { ContractValidationError } from "@/lib/central/contracts";
import { getWorkflowRegistry } from "./registry";

/** Terminal statuses set completedAt. Other statuses (incl. holds) leave it null. */
const TERMINAL = new Set(["done", "failed", "cancelled"]);

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  status: string;
  title: string;
  lane: string | null;
  capability: string | null;
  parentTaskId: string | null;
  draftId: string | null;
  childTaskId: string | null;
  currentStep: string | null;
  blocker: string | null;
  artifacts: Record<string, unknown>;
  runbook: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface WorkflowRunEvent {
  id: string;
  runId: string;
  event: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface WorkflowRunDetail extends WorkflowRunRecord {
  events: WorkflowRunEvent[];
}

interface WorkflowRunRow {
  _id: string; workflowId: string; status: string; title: string; lane: string | null; capability: string | null;
  parentTaskId: string | null; draftId: string | null; childTaskId: string | null; currentStep: string | null;
  blocker: string | null; artifact_json: string; runbook: string | null; createdAt: string; updatedAt: string; completedAt: string | null;
}

const SECRET_KEY = /password|passwd|pwd|secret|token|cookie|session|credential|api[_-]?key|bearer|keychain/i;

/** Key-based recursive redaction — secret-looking keys → "[redacted]". */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v);
  }
  return out;
}
function redactObject(value: Record<string, unknown>): Record<string, unknown> {
  return redact(value) as Record<string, unknown>;
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try { const p = JSON.parse(value); return p && typeof p === "object" && !Array.isArray(p) ? p as Record<string, unknown> : {}; }
  catch { return {}; }
}

function rowToRun(row: WorkflowRunRow): WorkflowRunRecord {
  return {
    id: row._id, workflowId: row.workflowId, status: row.status, title: row.title,
    lane: row.lane, capability: row.capability, parentTaskId: row.parentTaskId, draftId: row.draftId,
    childTaskId: row.childTaskId, currentStep: row.currentStep, blocker: row.blocker,
    artifacts: parseObject(row.artifact_json), runbook: row.runbook,
    createdAt: row.createdAt, updatedAt: row.updatedAt, completedAt: row.completedAt,
  };
}

export interface CreateWorkflowRunInput {
  workflowId: string;
  title?: string;
  status?: string;
  draftId?: string;
  parentTaskId?: string;
  childTaskId?: string;
  currentStep?: string;
  blocker?: string;
  artifacts?: Record<string, unknown>;
}

export function createWorkflowRun(input: CreateWorkflowRunInput): WorkflowRunRecord {
  const def = getWorkflowRegistry().get(input.workflowId);
  if (!def) throw new ContractValidationError(`unknown workflowId "${input.workflowId}" — not in the registry`);
  const id = generateId();
  const status = input.status?.trim() || "created";
  getDb().prepare(`
    INSERT INTO workflow_runs (_id, workflowId, status, title, lane, capability, parentTaskId, draftId, childTaskId, currentStep, blocker, artifact_json, runbook, completedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, def.id, status, input.title ?? def.name, def.lane, def.capability,
    input.parentTaskId ?? null, input.draftId ?? null, input.childTaskId ?? null,
    input.currentStep ?? null, input.blocker ?? null,
    JSON.stringify(redactObject(input.artifacts ?? {})), def.runbook,
    TERMINAL.has(status) ? new Date().toISOString() : null,
  );
  appendWorkflowRunEvent(id, "created", `Run created (${status})`);
  return getWorkflowRunRecord(id)!;
}

export function getWorkflowRunRecord(id: string): WorkflowRunRecord | null {
  const row = getDb().prepare("SELECT * FROM workflow_runs WHERE _id = ?").get(id) as WorkflowRunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function getWorkflowRun(id: string): WorkflowRunDetail | null {
  const record = getWorkflowRunRecord(id);
  if (!record) return null;
  const events = (getDb().prepare(`
    SELECT * FROM workflow_run_events WHERE runId = ? ORDER BY createdAt ASC, rowid ASC
  `).all(id) as Array<{ _id: string; runId: string; event: string; message: string; metadata_json: string; createdAt: string }>)
    .map((e) => ({ id: e._id, runId: e.runId, event: e.event, message: e.message, metadata: parseObject(e.metadata_json), createdAt: e.createdAt }));
  return { ...record, events };
}

export function listWorkflowRuns(filter: { workflowId?: string; draftId?: string; limit?: number } = {}): WorkflowRunRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.workflowId) { clauses.push("workflowId = ?"); params.push(filter.workflowId); }
  if (filter.draftId) { clauses.push("draftId = ?"); params.push(filter.draftId); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(500, Math.floor(filter.limit ?? 50)));
  // rowid DESC is the monotonic tiebreak — createdAt is 1-second resolution.
  const rows = getDb().prepare(`SELECT * FROM workflow_runs ${where} ORDER BY createdAt DESC, rowid DESC LIMIT ?`).all(...params, limit) as WorkflowRunRow[];
  return rows.map(rowToRun);
}

export function appendWorkflowRunEvent(runId: string, event: string, message = "", metadata: Record<string, unknown> = {}): void {
  getDb().prepare(`
    INSERT INTO workflow_run_events (_id, runId, event, message, metadata_json) VALUES (?, ?, ?, ?, ?)
  `).run(generateId(), runId, event, message, JSON.stringify(redactObject(metadata)));
}

export function updateWorkflowRunStatus(id: string, status: string, opts: { blocker?: string | null; currentStep?: string | null } = {}): WorkflowRunRecord | null {
  const sets: string[] = ["status = ?", "updatedAt = datetime('now')"];
  const params: unknown[] = [status];
  if ("blocker" in opts) { sets.push("blocker = ?"); params.push(opts.blocker ?? null); }
  if ("currentStep" in opts) { sets.push("currentStep = ?"); params.push(opts.currentStep ?? null); }
  if (TERMINAL.has(status)) sets.push("completedAt = datetime('now')");
  params.push(id);
  getDb().prepare(`UPDATE workflow_runs SET ${sets.join(", ")} WHERE _id = ?`).run(...params);
  appendWorkflowRunEvent(id, "status", `→ ${status}${opts.blocker ? ` (blocked: ${opts.blocker})` : ""}`);
  return getWorkflowRunRecord(id);
}

export function setWorkflowRunLinks(id: string, links: { draftId?: string; parentTaskId?: string; childTaskId?: string }): void {
  const sets: string[] = ["updatedAt = datetime('now')"];
  const params: unknown[] = [];
  for (const k of ["draftId", "parentTaskId", "childTaskId"] as const) {
    if (links[k] != null) { sets.push(`${k} = ?`); params.push(links[k]); }
  }
  if (sets.length === 1) return;
  params.push(id);
  getDb().prepare(`UPDATE workflow_runs SET ${sets.join(", ")} WHERE _id = ?`).run(...params);
}

export function linkWorkflowRunArtifact(id: string, key: string, value: unknown): void {
  const record = getWorkflowRunRecord(id);
  if (!record) return;
  const artifacts = redactObject({ ...record.artifacts, [key]: value });
  getDb().prepare("UPDATE workflow_runs SET artifact_json = ?, updatedAt = datetime('now') WHERE _id = ?").run(JSON.stringify(artifacts), id);
  appendWorkflowRunEvent(id, "artifact", `Linked artifact "${key}"`);
}

export function findWorkflowRunByDraft(draftId: string, workflowId?: string): WorkflowRunRecord | null {
  return listWorkflowRuns({ draftId, workflowId, limit: 1 })[0] ?? null;
}
