/**
 * Work Package ready-item orchestration. Once an operator STARTS a package, its
 * ready items run in dependency order under conservative same-repo concurrency
 * (one non-worktree writer per repo), with held release items final-gated.
 *
 * Driven by two paths (belt-and-suspenders):
 *  - an event hook on PATCH /tasks/:id terminal transitions (instant advance), and
 *  - a lightweight reconcile loop (tickWorkPackages) that advances any `running`
 *    package even when a child completed outside the API (in-process scheduler).
 *
 * Deterministic policy — no LLM. See
 * docs/superpowers/specs/2026-06-27-work-package-orchestration-design.md.
 */

import { Task, getDb } from "@/lib/db";
import { activeSameProjectTasks } from "./active";
import {
  createTaskFromItem,
  getWorkPackage,
  listWorkPackages,
  updateWorkPackage,
  type PackageStatus,
  type WorkPackageDetail,
  type WorkPackageItem,
} from "./store";
import { notifySelfPacedLoop } from "./flight-loop-store";
import type { IntakeActiveTask } from "@/lib/intake/classify";

/** A writer item mutates the repo working tree; worktree/safe items do not. */
function isWriterItem(item: Pick<WorkPackageItem, "executionMode" | "scopeHints">): boolean {
  if (item.executionMode === "worktree_parallel" || item.executionMode === "safe_parallel") return false;
  if (item.scopeHints.includes("worktree") || item.scopeHints.includes("read-only")) return false;
  return true;
}

/**
 * Pure planner: the ids of items that may START now. An item is eligible iff it
 * is `ready`, all of its dependsOn items are `done`, and concurrency allows it —
 * at most one writer in flight per repo (counting external active same-project
 * tasks and already-running package writers).
 */
export function planNextItems(items: WorkPackageItem[], activeSameProject: IntakeActiveTask[]): string[] {
  const doneIds = new Set(items.filter((i) => i.status === "done").map((i) => i.id));
  let activeWriters = activeSameProject.length + items.filter((i) => i.status === "running" && isWriterItem(i)).length;
  const eligible: string[] = [];
  for (const item of [...items].sort((a, b) => a.position - b.position)) {
    if (item.status !== "ready") continue;
    if (!item.dependsOn.every((d) => doneIds.has(d))) continue;
    if (isWriterItem(item)) {
      if (activeWriters > 0) continue;
      eligible.push(item.id);
      activeWriters++;
    } else {
      eligible.push(item.id);
    }
  }
  return eligible;
}

/** Map a child task's status onto its package item's status. */
function itemStatusForTask(taskStatus: string): PackageStatus | null {
  switch (taskStatus) {
    case "done": return "done";
    case "archived": return "done";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    case "review":
    case "needs_input": return "review";
    case "backlog":
    case "assigned":
    case "in_progress": return "running";
    default: return null;
  }
}

/**
 * Sync each running/review item from its linked task. Never resurrects a terminal
 * item. Captures commitHash from the task output when present. Idempotent.
 */
export async function reconcileWorkPackage(id: string): Promise<void> {
  const db = getDb();
  const detail = getWorkPackage(id);
  if (!detail) return;
  let selfPacedTrigger = false;
  for (const item of detail.items) {
    if (!item.createdTaskId) continue;
    if (item.status !== "running" && item.status !== "review") continue;
    const task = await Task.findById(item.createdTaskId);
    if (!task) continue;
    const next = itemStatusForTask(String((task as Record<string, unknown>).status));
    if (!next || next === item.status) continue;
    const output = (task as Record<string, unknown>).output;
    const commitHash = output && typeof output === "object" ? (output as Record<string, unknown>).commitHash : undefined;
    const error = (task as Record<string, unknown>).error;
    db.prepare(
      "UPDATE work_package_items SET status = ?, commitHash = COALESCE(?, commitHash), blocker = COALESCE(?, blocker), updatedAt = ? WHERE _id = ?",
    ).run(
      next,
      typeof commitHash === "string" ? commitHash : null,
      next === "failed" && typeof error === "string" ? error : null,
      new Date().toISOString(),
      item.id,
    );
    if (["done", "failed", "review"].includes(next)) selfPacedTrigger = true;
  }
  if (selfPacedTrigger) notifySelfPacedLoop(id);
}

/** Recompute a package's status from its item statuses. */
function rollupStatus(items: WorkPackageItem[]): PackageStatus {
  if (items.length === 0) return "draft";
  if (items.every((i) => i.status === "done")) return "done";
  if (items.some((i) => ["running", "ready", "draft"].includes(i.status))) return "running";
  if (items.some((i) => i.status === "review")) return "review";
  if (items.some((i) => i.status === "held")) return "held";
  if (items.some((i) => i.status === "failed")) return "failed";
  return "running";
}

export interface AdvanceResult {
  started: string[];
  package: WorkPackageDetail;
}

/**
 * Reconcile linked task states, start every eligible item (idempotent), and roll
 * up the package status. Safe to call repeatedly and concurrently — createTaskFromItem
 * returns the existing task rather than spawning a duplicate.
 */
export async function advanceWorkPackage(id: string): Promise<AdvanceResult> {
  await reconcileWorkPackage(id);
  let detail = getWorkPackage(id);
  if (!detail) throw new Error(`unknown work package "${id}"`);

  const active = detail.projectPath ? activeSameProjectTasks(detail.projectPath) : [];
  const eligible = planNextItems(detail.items, active);
  const started: string[] = [];
  for (const itemId of eligible) {
    const r = await createTaskFromItem(id, itemId);
    if (r.created) started.push(itemId);
  }

  detail = getWorkPackage(id)!;
  const rolled = rollupStatus(detail.items);
  if (rolled !== detail.status) {
    updateWorkPackage(id, { status: rolled });
    detail = getWorkPackage(id)!;
  }
  return { started, package: detail };
}

/**
 * The explicit operator action: promote draft items to ready (NOT held — the
 * final gate stays closed), set the package running, then advance.
 */
export async function startWorkPackage(id: string): Promise<AdvanceResult> {
  const db = getDb();
  const detail = getWorkPackage(id);
  if (!detail) throw new Error(`unknown work package "${id}"`);
  const now = new Date().toISOString();
  for (const item of detail.items) {
    if (item.status === "draft") {
      db.prepare("UPDATE work_package_items SET status = 'ready', updatedAt = ? WHERE _id = ?").run(now, item.id);
    }
  }
  updateWorkPackage(id, { status: "running" });
  return advanceWorkPackage(id);
}

// ── Lightweight reconcile loop ────────────────────────────────────

/** One pass: advance every package currently `running`. Cheap (indexed query). */
export async function tickWorkPackages(): Promise<void> {
  const running = listWorkPackages({ status: "running" });
  for (const pkg of running) {
    try {
      await advanceWorkPackage(pkg.id);
    } catch (e) {
      console.error(`[work-packages] advance failed for ${pkg.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

const LOOP_INTERVAL_MS = 15_000;
let timer: ReturnType<typeof setInterval> | null = null;
let looping = false;

/** Start the orchestration loop (idempotent). Mirrors startBrowserLaneReadinessLoop. */
export function startWorkPackageOrchestrationLoop(intervalMs = LOOP_INTERVAL_MS): () => void {
  if (timer) return stopWorkPackageOrchestrationLoop;
  timer = setInterval(() => {
    if (looping) return;
    looping = true;
    void tickWorkPackages().finally(() => { looping = false; });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return stopWorkPackageOrchestrationLoop;
}

export function stopWorkPackageOrchestrationLoop(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
