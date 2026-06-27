/**
 * Work Package store — durable parent object for Task Intake. A broad prompt is
 * staged here (draft/held) with proposed child items; an operator explicitly
 * converts an item into exactly one normal task. Mirrors workflows/runs.ts:
 * secret-looking keys/values are redacted on write, records carry parsed JSON.
 *
 * Concurrency policy (principles 4–6): one non-worktree writer per repo. The
 * pure decision lives in resolveItemConcurrency(); orchestration of ready items
 * is a documented follow-up — this slice only converts items one at a time.
 *
 * See docs/superpowers/specs/2026-06-27-work-packages-task-intake-design.md.
 */

import { generateId, getDb, Task } from "@/lib/db";
import { scrubSecretText } from "@/lib/workflows/runs";
import type { IntakeActiveTask, IntakeMode, IntakeResult, ProposedItem } from "@/lib/intake/classify";

export type PackageStatus = "draft" | "held" | "ready" | "running" | "review" | "done" | "failed" | "cancelled";
const TERMINAL = new Set<PackageStatus>(["done", "failed", "cancelled"]);

const SECRET_KEY = /password|passwd|pwd|secret|token|cookie|session|credential|api[_-]?key|bearer|keychain/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return typeof value === "string" ? scrubSecretText(value) : value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v);
  }
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

export interface WorkPackageItem {
  id: string;
  packageId: string;
  position: number;
  title: string;
  prompt: string;
  status: PackageStatus;
  risk: "low" | "medium" | "high";
  dependsOn: string[];
  scopeHints: string[];
  executionMode: IntakeMode;
  createdTaskId: string | null;
  resultTaskId: string | null;
  commitHash: string | null;
  blocker: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkPackageRecord {
  id: string;
  title: string;
  description: string;
  project: string;
  projectPath: string;
  status: PackageStatus;
  sourceTaskId: string | null;
  modelPolicy: string;
  orchestrationMode: string;
  intake: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface WorkPackageDetail extends WorkPackageRecord {
  items: WorkPackageItem[];
  counts: Record<string, number>;
}

interface PackageRow {
  _id: string; title: string; description: string; project: string; projectPath: string; status: string;
  sourceTaskId: string | null; modelPolicy: string; orchestrationMode: string; intake_json: string;
  createdAt: string; updatedAt: string; completedAt: string | null;
}
interface ItemRow {
  _id: string; packageId: string; position: number; title: string; prompt: string; status: string; risk: string;
  dependsOn: string; scopeHints: string; executionMode: string; createdTaskId: string | null; resultTaskId: string | null;
  commitHash: string | null; blocker: string | null; createdAt: string; updatedAt: string;
}

function rowToItem(r: ItemRow): WorkPackageItem {
  return {
    id: r._id, packageId: r.packageId, position: r.position, title: r.title, prompt: r.prompt,
    status: r.status as PackageStatus, risk: r.risk as WorkPackageItem["risk"],
    dependsOn: parseArray(r.dependsOn), scopeHints: parseArray(r.scopeHints),
    executionMode: r.executionMode as IntakeMode, createdTaskId: r.createdTaskId, resultTaskId: r.resultTaskId,
    commitHash: r.commitHash, blocker: r.blocker, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
function rowToPackage(r: PackageRow): WorkPackageRecord {
  return {
    id: r._id, title: r.title, description: r.description, project: r.project, projectPath: r.projectPath,
    status: r.status as PackageStatus, sourceTaskId: r.sourceTaskId, modelPolicy: r.modelPolicy,
    orchestrationMode: r.orchestrationMode, intake: parseObject(r.intake_json),
    createdAt: r.createdAt, updatedAt: r.updatedAt, completedAt: r.completedAt,
  };
}

export interface CreateWorkPackageInput {
  title: string;
  description?: string;
  project?: string;
  projectPath?: string;
  status?: PackageStatus;
  sourceTaskId?: string | null;
  modelPolicy?: string;
  orchestrationMode?: string;
  intake?: IntakeResult | null;
  items: ProposedItem[];
}

/**
 * Map a proposed item's status from its executionMode: held items start `held`,
 * everything else starts `draft` (operator explicitly moves them to `ready`).
 */
function itemStartStatus(mode: IntakeMode): PackageStatus {
  return mode === "hold" ? "held" : "draft";
}

export function createWorkPackage(input: CreateWorkPackageInput): WorkPackageDetail {
  const db = getDb();
  const id = generateId();
  const status = input.status ?? "draft";

  // Pre-assign item ids so we can resolve dependsOn (proposed titles) → item ids.
  const prepared = input.items.map((it) => ({ ...it, _id: generateId() }));
  const titleToId = new Map(prepared.map((p) => [p.title, p._id]));

  const insertPkg = db.prepare(`
    INSERT INTO work_packages (_id, title, description, project, projectPath, status, sourceTaskId, modelPolicy, orchestrationMode, intake_json, completedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO work_package_items (_id, packageId, position, title, prompt, status, risk, dependsOn, scopeHints, executionMode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    insertPkg.run(
      id,
      scrubSecretText(input.title),
      scrubSecretText(input.description ?? ""),
      input.project ?? "hivematrix",
      input.projectPath ?? "",
      status,
      input.sourceTaskId ?? null,
      input.modelPolicy ?? "mixed_orchestrated",
      input.orchestrationMode ?? "sequential",
      JSON.stringify(redact(input.intake ?? {})),
      TERMINAL.has(status) ? new Date().toISOString() : null,
    );
    prepared.forEach((it, i) => {
      const deps = it.dependsOn.map((d) => titleToId.get(d)).filter((d): d is string => !!d);
      insertItem.run(
        it._id, id, i,
        scrubSecretText(it.title),
        scrubSecretText(it.prompt),
        itemStartStatus(it.executionMode),
        it.risk,
        JSON.stringify(deps),
        JSON.stringify(it.scopeHints.map((s) => scrubSecretText(s))),
        it.executionMode,
      );
    });
  });
  tx();
  return getWorkPackage(id)!;
}

export function listWorkPackages(filter: { status?: string; limit?: number } = {}): WorkPackageRecord[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.status) { clauses.push("status = ?"); params.push(filter.status); }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter.limit && filter.limit > 0 ? ` LIMIT ${Math.floor(filter.limit)}` : "";
  const rows = db.prepare(`SELECT * FROM work_packages${where} ORDER BY createdAt DESC${limit}`).all(...params) as PackageRow[];
  return rows.map(rowToPackage);
}

export function getWorkPackage(id: string): WorkPackageDetail | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM work_packages WHERE _id = ?").get(id) as PackageRow | undefined;
  if (!row) return null;
  const items = (db.prepare("SELECT * FROM work_package_items WHERE packageId = ? ORDER BY position ASC").all(id) as ItemRow[]).map(rowToItem);
  const counts: Record<string, number> = {};
  for (const it of items) counts[it.status] = (counts[it.status] ?? 0) + 1;
  return { ...rowToPackage(row), items, counts };
}

const PACKAGE_PATCH_FIELDS = new Set(["title", "description", "status", "orchestrationMode", "modelPolicy"]);

export function updateWorkPackage(id: string, patch: Record<string, unknown>): WorkPackageRecord | null {
  const db = getDb();
  const existing = db.prepare("SELECT _id FROM work_packages WHERE _id = ?").get(id);
  if (!existing) return null;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!PACKAGE_PATCH_FIELDS.has(k)) continue;
    sets.push(`${k} = ?`);
    params.push(typeof v === "string" && (k === "title" || k === "description") ? scrubSecretText(v) : v);
  }
  sets.push("updatedAt = ?"); params.push(new Date().toISOString());
  if (patch.status && TERMINAL.has(patch.status as PackageStatus)) { sets.push("completedAt = ?"); params.push(new Date().toISOString()); }
  db.prepare(`UPDATE work_packages SET ${sets.join(", ")} WHERE _id = ?`).run(...params, id);
  const detail = getWorkPackage(id);
  return detail ? { ...detail } : null;
}

const ITEM_PATCH_FIELDS = new Set(["status", "risk", "executionMode", "blocker", "createdTaskId", "resultTaskId", "commitHash"]);

export function updateWorkPackageItem(packageId: string, itemId: string, patch: Record<string, unknown>): WorkPackageItem | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM work_package_items WHERE _id = ? AND packageId = ?").get(itemId, packageId) as ItemRow | undefined;
  if (!row) return null;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!ITEM_PATCH_FIELDS.has(k)) continue;
    sets.push(`${k} = ?`);
    params.push(k === "blocker" && typeof v === "string" ? scrubSecretText(v) : v);
  }
  if (sets.length === 0) return rowToItem(row);
  sets.push("updatedAt = ?"); params.push(new Date().toISOString());
  db.prepare(`UPDATE work_package_items SET ${sets.join(", ")} WHERE _id = ?`).run(...params, itemId);
  const updated = db.prepare("SELECT * FROM work_package_items WHERE _id = ?").get(itemId) as ItemRow;
  return rowToItem(updated);
}

export interface CreateTaskFromItemResult {
  taskId: string;
  created: boolean;
}

/**
 * Convert a single package item into exactly one normal board task. Idempotent:
 * if the item already created a task, return it without creating another.
 */
export async function createTaskFromItem(packageId: string, itemId: string): Promise<CreateTaskFromItemResult> {
  const db = getDb();
  const pkgRow = db.prepare("SELECT * FROM work_packages WHERE _id = ?").get(packageId) as PackageRow | undefined;
  if (!pkgRow) throw new Error(`unknown work package "${packageId}"`);
  const itemRow = db.prepare("SELECT * FROM work_package_items WHERE _id = ? AND packageId = ?").get(itemId, packageId) as ItemRow | undefined;
  if (!itemRow) throw new Error(`unknown item "${itemId}" in package "${packageId}"`);

  if (itemRow.createdTaskId) return { taskId: itemRow.createdTaskId, created: false };

  const task = await Task.create({
    _id: generateId(),
    title: itemRow.title,
    description: itemRow.prompt,
    project: pkgRow.project,
    projectPath: pkgRow.projectPath || undefined,
    status: "backlog",
    source: "work-package",
    executor: "agent",
    worktreeName: parseArray(itemRow.scopeHints).includes("worktree") ? `wp-${itemId.slice(0, 8)}` : null,
  });
  db.prepare("UPDATE work_package_items SET createdTaskId = ?, status = 'running', updatedAt = ? WHERE _id = ?")
    .run(task._id, new Date().toISOString(), itemId);
  return { taskId: task._id, created: true };
}

/**
 * Conservative same-project concurrency decision (principles 4–6). Returns
 * whether the item may run now and why. A non-worktree writer is blocked while
 * any other same-project work is active; worktree-backed or read-only/safe work
 * may proceed in parallel.
 */
export function resolveItemConcurrency(
  item: Pick<WorkPackageItem, "executionMode" | "scopeHints" | "risk">,
  activeSameProject: IntakeActiveTask[],
): { allow: boolean; reason: string } {
  if (item.executionMode === "hold") return { allow: false, reason: "item is held (final-gated)" };
  if (activeSameProject.length === 0) return { allow: true, reason: "no active same-project work" };
  if (item.executionMode === "worktree_parallel" || item.scopeHints.includes("worktree")) {
    return { allow: true, reason: "worktree-backed — safe to run in parallel" };
  }
  if (item.executionMode === "safe_parallel" || item.scopeHints.includes("read-only")) {
    return { allow: true, reason: "read-only/safe — no write collision" };
  }
  return { allow: false, reason: "non-worktree writer held: one writer per repo" };
}
