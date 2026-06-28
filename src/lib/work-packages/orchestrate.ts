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
import { notifySelfPacedLoop, getLoop } from "./flight-loop-store";
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
  const doneIds = new Set(items.filter((i) => i.status === "done" || i.status === "archived").map((i) => i.id));
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

/**
 * Classify why no items started. Each item ID appears in exactly one category
 * (first matching reason wins). Call only when planNextItems returned [].
 */
export function classifyBlockers(items: WorkPackageItem[], activeSameProject: IntakeActiveTask[]): BlockerSummary {
  const doneIds = new Set(items.filter((i) => i.status === "done" || i.status === "archived").map((i) => i.id));
  const activeWriterCount = activeSameProject.length + items.filter((i) => i.status === "running" && isWriterItem(i)).length;
  const review: string[] = [];
  const held: string[] = [];
  const dependency: string[] = [];
  const activeWriter: string[] = [];
  let hasReady = false;
  for (const item of items) {
    if (item.status === "review") { review.push(item.id); continue; }
    if (item.status === "held") { held.push(item.id); continue; }
    if (item.status !== "ready") continue;
    hasReady = true;
    if (!item.dependsOn.every((d) => doneIds.has(d))) { dependency.push(item.id); continue; }
    if (isWriterItem(item) && activeWriterCount > 0) { activeWriter.push(item.id); continue; }
  }
  return { review, held, dependency, activeWriter, noReadyItems: !hasReady };
}

/** Map a child task's status onto its package item's status. */
function itemStatusForTask(taskStatus: string): PackageStatus | null {
  switch (taskStatus) {
    case "done": return "done";
    case "archived": return "archived";
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
    // Also process failed items so a retry (task moves back to backlog/in_progress)
    // restores the item to running. Terminal cancelled/archived items are never re-synced.
    if (item.status !== "running" && item.status !== "review" && item.status !== "failed") continue;
    const task = await Task.findById(item.createdTaskId);
    if (!task) continue;
    const raw = itemStatusForTask(String((task as Record<string, unknown>).status));
    if (!raw) continue;
    // Durable runtime repair: archiving the linked task of a running/review item lands
    // it as done (accepted work), not as an intentional skip (archived). This handles
    // the case where an operator archives a task that was still in flight — the item
    // should complete cleanly so Advance can unblock dependent items.
    const next: PackageStatus = (raw === "archived" && (item.status === "running" || item.status === "review"))
      ? "done"
      : raw;
    if (next === item.status) continue;
    const output = (task as Record<string, unknown>).output;
    const commitHash = output && typeof output === "object" ? (output as Record<string, unknown>).commitHash : undefined;
    const error = (task as Record<string, unknown>).error;
    // Set blocker when failing; clear it when leaving failed (retry); preserve otherwise.
    const newBlocker = next === "failed" && typeof error === "string"
      ? error
      : (item.status === "failed" ? null : item.blocker);
    db.prepare(
      "UPDATE work_package_items SET status = ?, commitHash = COALESCE(?, commitHash), blocker = ?, updatedAt = ? WHERE _id = ?",
    ).run(
      next,
      typeof commitHash === "string" ? commitHash : null,
      newBlocker,
      new Date().toISOString(),
      item.id,
    );
    if (["done", "archived", "failed", "review"].includes(next)) selfPacedTrigger = true;
  }
  if (selfPacedTrigger) notifySelfPacedLoop(id);
}

/** Recompute a package's status from its item statuses. */
function rollupStatus(items: WorkPackageItem[]): PackageStatus {
  if (items.length === 0) return "draft";
  const terminalStatuses = new Set(["done", "cancelled", "archived", "failed"]);
  const allTerminal = items.every((i) => terminalStatuses.has(i.status));
  if (allTerminal) {
    const anyFailed = items.some((i) => i.status === "failed");
    if (anyFailed) return "failed";
    // Archived items are explicit skips. High-risk cancelled items are intentional
    // scope reductions (operator declined a held action) — same signal.
    const anySkipped = items.some(
      (i) => i.status === "archived" || (i.status === "cancelled" && i.risk === "high"),
    );
    if (anySkipped) return "done_with_skips";
    return "done";
  }
  if (items.some((i) => ["running", "ready", "draft"].includes(i.status))) return "running";
  if (items.some((i) => i.status === "review")) return "review";
  if (items.some((i) => i.status === "held")) return "held";
  if (items.some((i) => i.status === "failed")) return "failed";
  return "running";
}

export interface StallDiagnostic {
  reason: string;
  suggestions: string[];
}

/** Structured breakdown of why no items could start when advance returned started=[]. */
export interface BlockerSummary {
  review: string[];       // item IDs currently in review/needs_input status
  held: string[];         // item IDs explicitly held at the final gate
  dependency: string[];   // ready item IDs whose dependsOn are not yet done
  activeWriter: string[]; // ready writer item IDs blocked by another active writer
  noReadyItems: boolean;  // true when no items at all have status "ready"
}

export interface AdvanceResult {
  started: string[];
  package: WorkPackageDetail;
  stall?: StallDiagnostic;
  blockers?: BlockerSummary;
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

  // Stall diagnostic: running Goal Flight with no started items, no eligible next
  // items, and no active scheduled loop pass.
  let stall: StallDiagnostic | undefined;
  const isGoalFlight = !!(detail.intake?.goalFlight);
  if (
    isGoalFlight &&
    (detail.status === "running" || detail.status === "held") &&
    started.length === 0 &&
    eligible.length === 0
  ) {
    const loop = getLoop(id);
    const hasScheduledPass = loop && loop.status !== "stopped" && loop.nextRunAt !== null;
    if (!hasScheduledPass) {
      const heldCount = detail.items.filter((i) => i.status === "held").length;
      const allHeld = heldCount === detail.items.length;
      stall = {
        reason: allHeld
          ? "All items are held — operator approval required to proceed"
          : "Goal Flight is running but has no eligible items and no scheduled loop pass",
        suggestions: [
          allHeld
            ? "Review and approve held items to unblock the flight"
            : "Run a quality pass to discover follow-up work",
          "Use Repair / Nudge to manually guide the next step",
        ],
      };
    }
  }

  // Structured blocker diagnostics: present whenever nothing was started.
  let blockers: BlockerSummary | undefined;
  if (started.length === 0) {
    blockers = classifyBlockers(detail.items, active);
  }

  return { started, package: detail, stall, blockers };
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

/**
 * Explicit operator action: accept a review item as done, archive its linked
 * task (preserving it on the board with its output), then advance. This is the
 * first-class replacement for the former hidden "archive task = accepted" behaviour.
 */
export async function acceptWorkPackageItem(packageId: string, itemId: string): Promise<AdvanceResult> {
  const db = getDb();
  const detail = getWorkPackage(packageId);
  if (!detail) throw new Error(`unknown work package "${packageId}"`);
  const item = detail.items.find((i) => i.id === itemId);
  if (!item) throw new Error(`unknown item "${itemId}" in package "${packageId}"`);
  if (item.status !== "review") throw new Error(`item "${itemId}" is not in review status (current: ${item.status})`);

  db.prepare("UPDATE work_package_items SET status = 'done', updatedAt = ? WHERE _id = ?").run(
    new Date().toISOString(),
    itemId,
  );

  if (item.createdTaskId) {
    await Task.findByIdAndUpdate(item.createdTaskId, { status: "archived" });
  }

  return advanceWorkPackage(packageId);
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

/**
 * Operator-triggered reconcile for a stuck Flight. Forces an immediate
 * reconcile-and-advance cycle so item states are synced from their linked tasks
 * without waiting for the 15-second scheduler tick. The existing
 * reconcileWorkPackage already auto-repairs the unambiguous archived→done case.
 */
export async function reconcileStuckFlight(id: string): Promise<AdvanceResult> {
  const detail = getWorkPackage(id);
  if (!detail) throw new Error(`unknown work package "${id}"`);
  return advanceWorkPackage(id);
}
