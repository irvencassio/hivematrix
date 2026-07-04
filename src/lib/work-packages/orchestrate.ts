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
import { activeSameProjectTasks, anyTaskActive } from "./active";
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
import {
  parseParentDecisionBlocker,
  serializeParentBlocker,
  serializeOperatorEscalation,
  readItemBlocker,
  type ParentDecisionBlocker,
} from "./parent-blocker";
import { resolveParentDecision } from "./coordinator";
import { appendCoordinatorAnswer } from "@/lib/tasks/reply-continuation";
import type { IntakeActiveTask } from "@/lib/intake/classify";
import { autonomyAutoLandsReviews, autonomyAutoStartsFlights, getAutonomyLevel } from "@/lib/config/autonomy";

export interface AutoLandDecision {
  autoLand: boolean;
  reason: string;
}

const AUTO_LAND_SAFE_LOOP_PROFILES = new Set<string>(["quality", "goal_quality"]);

/**
 * Pure predicate: should this review item land automatically without operator action?
 * Returns true only when ALL conditions pass — low risk, clean task completion,
 * no open blocker, not final-gated, and no sign-off loop.
 */
export function shouldAutoLand(
  item: Pick<WorkPackageItem, "risk" | "blocker" | "executionMode">,
  actualTaskStatus: string | null,
  loop: { profile: string } | null,
  taskReviewState: string | null = null,
  autoLandEnabled = true,
): AutoLandDecision {
  // Manual autonomy: the operator accepts every result, so nothing auto-lands.
  // The remaining checks are the invariant safety floor, kept at every level.
  if (!autoLandEnabled)
    return { autoLand: false, reason: "manual autonomy — operator reviews every item" };
  if (item.risk !== "low")
    return { autoLand: false, reason: `risk is ${item.risk}` };
  if (actualTaskStatus !== "review")
    return {
      autoLand: false,
      reason: actualTaskStatus === "needs_input"
        ? "agent is waiting for input"
        : `task status is ${actualTaskStatus}`,
    };
  if (taskReviewState)
    return { autoLand: false, reason: `task review state is ${taskReviewState}` };
  if (item.blocker !== null)
    return { autoLand: false, reason: "item has an open blocker" };
  if (item.executionMode === "hold")
    return { autoLand: false, reason: "item is final-gated (hold)" };
  if (loop && !AUTO_LAND_SAFE_LOOP_PROFILES.has(loop.profile))
    return { autoLand: false, reason: `${loop.profile} loop requires sign-off` };
  return { autoLand: true, reason: "low-risk, clean completion, no open questions" };
}

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

/**
 * Pull a structured needs_parent_decision blocker out of a child task's output,
 * if the worker emitted the fenced NEEDS_PARENT_DECISION marker. Tolerant of the
 * output being a raw string or an object with a text/summary/message field.
 */
function extractParentDecisionFromTask(task: unknown): ParentDecisionBlocker | null {
  const t = task as Record<string, unknown>;
  const candidates: string[] = [];
  const out = t.output;
  if (typeof out === "string") candidates.push(out);
  else if (out && typeof out === "object") {
    for (const k of ["summary", "text", "message", "result"]) {
      const v = (out as Record<string, unknown>)[k];
      if (typeof v === "string") candidates.push(v);
    }
  }
  if (typeof t.error === "string") candidates.push(t.error);
  for (const c of candidates) {
    const pd = parseParentDecisionBlocker(c);
    if (pd) return pd;
  }
  return null;
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
    if (next === item.status && next !== "review") continue;
    const output = (task as Record<string, unknown>).output;
    const commitHash = output && typeof output === "object" ? (output as Record<string, unknown>).commitHash : undefined;
    const error = (task as Record<string, unknown>).error;
    // Set blocker when failing; clear it when leaving failed (retry); preserve otherwise.
    let newBlocker = next === "failed" && typeof error === "string"
      ? error
      : (item.status === "failed" ? null : item.blocker);
    // A child that emitted a structured parent-decision marker is recorded as a
    // needs_parent_decision blocker for the Flight coordinator — NOT left as a bare
    // operator needs_input. (Don't clobber an existing structured/operator blocker.)
    if (next === "review" && !readItemBlocker(item.blocker)) {
      const pd = extractParentDecisionFromTask(task);
      if (pd) newBlocker = serializeParentBlocker(pd);
    } else if (next === "running" && readItemBlocker(item.blocker)) {
      // Leaving review back into work (operator reply / coordinator requeue) — drop
      // the structured decision blocker so it never lingers on an active item.
      newBlocker = null;
    }
    // Auto-land: bypass manual approval for low-risk, clean, question-free review items.
    // Fires on the normal running→review completion path and on already-review
    // items during repair/reconcile. Failed items salvaged to review by the operator
    // are intentionally managed — never auto-landed.
    // Uses effective blocker (newBlocker) to catch parent-decision blockers extracted above.
    let effectiveNext = next;
    if (next === "review" && (item.status === "running" || item.status === "review")) {
      const actualTaskStatus = String((task as Record<string, unknown>).status);
      const rawReviewState = (task as Record<string, unknown>).reviewState;
      const taskReviewState = typeof rawReviewState === "string" && rawReviewState.length > 0 && rawReviewState !== "ready_for_review"
        ? rawReviewState
        : null;
      const loop = getLoop(id);
      const { autoLand } = shouldAutoLand(
        { ...item, blocker: newBlocker },
        actualTaskStatus,
        loop,
        taskReviewState,
        autonomyAutoLandsReviews(),
      );
      if (autoLand) {
        effectiveNext = "done";
        if (item.createdTaskId) {
          await Task.findByIdAndUpdate(item.createdTaskId, { status: "archived" });
        }
        newBlocker = null;
        console.info(`[work-packages] auto-landed item ${item.id}: low-risk clean completion`);
      }
    }
    if (effectiveNext === item.status && newBlocker === item.blocker) continue;
    db.prepare(
      "UPDATE work_package_items SET status = ?, commitHash = COALESCE(?, commitHash), blocker = ?, updatedAt = ? WHERE _id = ?",
    ).run(
      effectiveNext,
      typeof commitHash === "string" ? commitHash : null,
      newBlocker,
      new Date().toISOString(),
      item.id,
    );
    if (["done", "archived", "failed", "review"].includes(effectiveNext)) selfPacedTrigger = true;
  }
  if (selfPacedTrigger) notifySelfPacedLoop(id);
}

export interface CoordinationResult {
  /** Item IDs the coordinator answered from the parent and requeued. */
  requeued: string[];
  /** Item IDs the coordinator escalated to the operator. */
  escalated: string[];
}

/**
 * Flight coordinator pass: for every review item carrying a needs_parent_decision
 * blocker, try to answer it from the parent Flight context (deterministically, no
 * model). Resolved → append the answer to the child task and requeue it (no
 * operator input). Escalated → record an operator-facing decision blocker and leave
 * the item in review. Idempotent: operator-escalated and plain blockers are skipped.
 */
export async function coordinateFlightDecisions(id: string): Promise<CoordinationResult> {
  const db = getDb();
  const detail = getWorkPackage(id);
  if (!detail) return { requeued: [], escalated: [] };
  const parent = { title: detail.title, description: detail.description, intake: detail.intake };
  const requeued: string[] = [];
  const escalated: string[] = [];

  for (const item of detail.items) {
    if (item.status !== "review") continue;
    const read = readItemBlocker(item.blocker);
    if (!read || read.kind !== "parent") continue; // only pending parent decisions

    const res = resolveParentDecision(parent, read.payload);
    const now = new Date().toISOString();

    if (res.resolved && res.answer) {
      if (item.createdTaskId) {
        const task = await Task.findById(item.createdTaskId);
        if (task) {
          const desc = appendCoordinatorAnswer(String((task as Record<string, unknown>).description ?? ""), res.answer);
          await Task.findByIdAndUpdate(item.createdTaskId, {
            description: desc,
            status: "backlog",
            reviewState: null,
            error: null,
            agentPid: null,
            startedAt: null,
            completedAt: null,
          });
        }
      }
      // Raw SQL: a NEEDS_* blocker is structured JSON; updateWorkPackageItem would
      // scrub it. Here we clear it and return the item to running.
      db.prepare("UPDATE work_package_items SET status = 'running', blocker = NULL, updatedAt = ? WHERE _id = ?").run(now, item.id);
      requeued.push(item.id);
    } else if (res.escalate) {
      const question = buildOperatorQuestion(read.payload);
      db.prepare("UPDATE work_package_items SET blocker = ?, updatedAt = ? WHERE _id = ?").run(
        serializeOperatorEscalation(read.payload, question),
        now,
        item.id,
      );
      escalated.push(item.id);
    }
  }
  if (requeued.length) notifySelfPacedLoop(id);
  return { requeued, escalated };
}

/** Build a crisp operator-facing question from an escalated parent-decision blocker. */
function buildOperatorQuestion(b: ParentDecisionBlocker): string {
  const parts = [b.ambiguity.trim()];
  if (b.options.length) parts.push(`Options: ${b.options.join(" / ")}.`);
  if (b.recommendedDefault) parts.push(`Recommended: ${b.recommendedDefault}.`);
  return parts.join(" ");
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
  // Coordinator pass: auto-resolve child parent-decision blockers from the parent
  // context (or escalate genuine operator decisions) before planning next items.
  await coordinateFlightDecisions(id);
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

// ── Stale collision-hold release ──────────────────────────────────

/** The task ids that put a freshly-staged Flight into a `hold` collision. */
function readCollisionHoldTaskIds(intake: Record<string, unknown>): string[] | null {
  const c = intake?.projectCollision;
  if (!c || typeof c !== "object") return null;
  const col = c as Record<string, unknown>;
  if (col.recommendation !== "hold") return null;
  return Array.isArray(col.activeTaskIds)
    ? col.activeTaskIds.filter((x): x is string => typeof x === "string")
    : [];
}

/**
 * A Flight is "freshly staged" — held only by a collision, never started — when
 * every item is still draft/held and none has spawned a task. This distinguishes
 * a stale collision hold from a Flight that reached `held` mid-run via rollup
 * (e.g. a final-gated release item), which must NOT be released.
 */
function isFreshlyStaged(detail: WorkPackageDetail): boolean {
  return detail.items.every(
    (i) => (i.status === "draft" || i.status === "held") && i.createdTaskId === null,
  );
}

/**
 * Release Flights held solely by a same-project collision once the blocking work
 * has finished. A collision hold is a point-in-time concurrency snapshot ("one
 * non-worktree writer per repo") stamped at creation with no self-release path —
 * without this sweep a Flight staged while another task was in flight stays
 * `held` forever. When none of the tasks that triggered the hold are still
 * active, demote held → draft: the exact state the Flight would have had with no
 * collision (the operator still Starts it; run-time concurrency re-serializes
 * writers). Optionally scoped to one project for the fast task-completion path.
 * Returns the ids of the Flights that were released.
 */
export function releaseStaleCollisionHolds(projectPath?: string): string[] {
  const released: string[] = [];
  for (const rec of listWorkPackages({ status: "held" })) {
    if (projectPath && rec.projectPath !== projectPath) continue;
    const holdTaskIds = readCollisionHoldTaskIds(rec.intake);
    if (holdTaskIds === null) continue;
    const detail = getWorkPackage(rec.id);
    if (!detail || !isFreshlyStaged(detail)) continue;
    if (anyTaskActive(holdTaskIds)) continue;
    updateWorkPackage(rec.id, { status: "draft" });
    released.push(rec.id);
  }
  return released;
}

// ── Autonomy: auto-start staged Flights ───────────────────────────

/**
 * Under `autonomous` autonomy, begin a freshly-staged Flight without an operator
 * Start. Only a draft Flight that has never been started (no item has spawned a
 * task) and has a promotable draft item is eligible; a Flight held at the
 * collision or final gate is left alone. Returns true if it was started. The
 * per-item safety floor still applies downstream: startWorkPackage promotes only
 * draft items (held/final-gated items stay held), and concurrency re-serializes
 * writers in advanceWorkPackage.
 */
export async function maybeAutostartFlight(id: string): Promise<boolean> {
  if (!autonomyAutoStartsFlights(getAutonomyLevel())) return false;
  const detail = getWorkPackage(id);
  if (!detail || detail.status !== "draft") return false;
  if (!isFreshlyStaged(detail)) return false;
  if (!detail.items.some((i) => i.status === "draft")) return false;
  await startWorkPackage(id);
  return true;
}

/** Sweep every staged draft Flight and auto-start each one autonomy permits. */
export async function autostartDraftFlights(): Promise<string[]> {
  if (!autonomyAutoStartsFlights(getAutonomyLevel())) return [];
  const started: string[] = [];
  for (const rec of listWorkPackages({ status: "draft" })) {
    try {
      if (await maybeAutostartFlight(rec.id)) started.push(rec.id);
    } catch (e) {
      console.error(`[work-packages] autostart failed for ${rec.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return started;
}

// ── Lightweight reconcile loop ────────────────────────────────────

/** One pass: advance packages that may still have autonomous work to reconcile. */
export async function tickWorkPackages(): Promise<void> {
  // Release Flights whose same-project collision hold has cleared (the blocking
  // task finished). The PATCH /tasks terminal hook is the instant path; this is
  // the backstop for completions that happen outside the API.
  try {
    releaseStaleCollisionHolds();
  } catch (e) {
    console.error(`[work-packages] collision-hold release failed: ${e instanceof Error ? e.message : e}`);
  }
  // Autonomy: auto-start any staged Flight the operator no longer needs to Start
  // (runs after release so a just-unblocked collision Flight starts this tick).
  await autostartDraftFlights();
  const candidates = new Map(
    [...listWorkPackages({ status: "running" }), ...listWorkPackages({ status: "review" })]
      .map((pkg) => [pkg.id, pkg]),
  );
  for (const pkg of candidates.values()) {
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
