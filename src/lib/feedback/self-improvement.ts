/**
 * Self-improvement loop — the bridge between directive reflection and the
 * feedback backlog, plus a lightweight health signal ("does the loop close?").
 *
 * Before this, a directive retrospective's "what didn't work" + follow-up ideas
 * went ONLY into brain playbooks — durable prose, but nothing tracked, triaged,
 * or measurable. And operator-filed feedback never fed back into planning. This
 * connects the two:
 *
 *   reflection → feedback : recurring problems become tracked backlog items
 *                           (deduped, so the same lesson isn't re-filed each run).
 *   feedback   → planning : openFeedbackForPlanning() surfaces the backlog so a
 *                           maintenance/self-improvement directive (or the
 *                           operator) can pull it into a plan. NOT force-injected
 *                           into unrelated directives.
 *   loopHealth()          : the eval signal — resolution rate, recurring-issue
 *                           count, backlog age — so improvement is measurable
 *                           over time instead of vibes.
 */

import {
  recordFeedbackDedup,
  listFeedback,
  getFeedback,
  setFeedbackStatus,
  normalizeFeedbackTitle,
  type FeedbackItem,
  type FeedbackStatus,
  type RecordFeedbackInput,
} from "./feedback";
import type { DirectiveRetrospective } from "@/lib/orchestrator/directive-autonomy";
import { createDirective, listDirectives, updateDirective, type CreateDirectiveInput } from "@/lib/orchestrator/directive-store";

/**
 * Derive feedback inputs from a retrospective: "what didn't work" → bugs,
 * follow-up directives → enhancements. Pure (no DB). Deduped within the batch by
 * normalized title.
 */
export function feedbackInputsFromRetrospective(retro: DirectiveRetrospective, source: string): RecordFeedbackInput[] {
  const inputs: RecordFeedbackInput[] = [];
  for (const w of retro.whatDidnt) {
    const title = w.trim();
    if (title) inputs.push({ kind: "bug", title, detail: retro.overallAssessment, source });
  }
  for (const f of retro.followUpDirectives) {
    const title = f.title.trim();
    if (title) inputs.push({ kind: "enhancement", title, detail: f.goal, source });
  }
  const seen = new Set<string>();
  return inputs.filter((i) => {
    const n = normalizeFeedbackTitle(i.title);
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

/** Record a retrospective's problems/ideas as deduped feedback. Returns counts. */
export function recordRetrospectiveFeedback(retro: DirectiveRetrospective, source: string): { created: number; skipped: number } {
  let created = 0;
  let skipped = 0;
  for (const input of feedbackInputsFromRetrospective(retro, source)) {
    if (recordFeedbackDedup(input).created) created++;
    else skipped++;
  }
  return { created, skipped };
}

/** Open + triaged feedback, oldest first (work the backlog), bounded — for a planner to consume. */
export function openFeedbackForPlanning(limit = 10): FeedbackItem[] {
  const items = [...listFeedback({ status: "open" }), ...listFeedback({ status: "triaged" })];
  items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return items.slice(0, Math.max(0, limit));
}

/**
 * Marker embedded in a self-improvement directive's goal so the planner knows to
 * pull the feedback backlog into its plan (vs. an ordinary directive, which
 * shouldn't see global feedback). A goal-text marker avoids a schema migration.
 */
export const SELF_IMPROVEMENT_DIRECTIVE_MARKER = "[self-improvement]";

export function isSelfImprovementDirective(goal: string): boolean {
  return goal.includes(SELF_IMPROVEMENT_DIRECTIVE_MARKER);
}

export interface SelfImprovementDirectiveOptions {
  project?: string;
  projectPath?: string;
  dailyAtHour?: number;
}

/**
 * The standing maintenance directive: each scheduled run pulls the open feedback
 * backlog into its plan and spawns feedback-linked tasks. When the run proves
 * out, those tasks' feedback items auto-close (verify → done).
 */
export function buildSelfImprovementDirective(opts: SelfImprovementDirectiveOptions = {}): CreateDirectiveInput {
  const goal = [
    `${SELF_IMPROVEMENT_DIRECTIVE_MARKER} Maintenance & self-improvement.`,
    "Each run, work the highest-value open feedback (user-reported bugs + enhancement requests) shown to you.",
    "Create one task per item you address and set that item's feedbackId on the task so it closes when proven.",
    "Prefer small, verifiable fixes; do not invent work beyond the backlog.",
  ].join(" ");

  return {
    goal,
    profile: "coo",
    project: opts.project ?? "hivematrix",
    projectPath: opts.projectPath ?? process.cwd(),
    triggerPolicy: { type: "schedule", dailyAt: opts.dailyAtHour ?? 7, quietHours: { startHour: 22, endHour: 7 } },
    approvalPolicy: { checkpoint: "plan" },
    brainSelection: { task: [], mission: [], session: [] },
    status: "active",
  };
}

/**
 * Ensure the standing self-improvement directive exists — idempotent, so it's
 * safe to call on every daemon boot (restarts are routine via auto-update; a
 * non-idempotent version would spam duplicate directives).
 */
export function installSelfImprovementDirectiveIfMissing(
  opts: SelfImprovementDirectiveOptions = {},
): { installed: boolean; directiveId: string } {
  const existing = listDirectives().find((d) => isSelfImprovementDirective(d.goal) && d.status !== "retired");
  if (existing) return { installed: false, directiveId: existing._id };
  const created = createDirective(buildSelfImprovementDirective(opts));
  return { installed: true, directiveId: created._id };
}

/**
 * Block every ACTIVE self-improvement directive. Called on boot when the
 * `selfImprovement` feature is off, so a directive installed by an earlier
 * (feature-on) boot can't keep dispatching. Returns the count blocked.
 * "blocked" (not "retired") is deliberate: only a NON-retired directive stops
 * installSelfImprovementDirectiveIfMissing from re-creating one, and the
 * scheduler dispatches only `active` directives — so `blocked` is dormant AND
 * durable across restarts.
 */
export function disableActiveSelfImprovementDirectives(): number {
  let blocked = 0;
  for (const d of listDirectives()) {
    if (isSelfImprovementDirective(d.goal) && d.status === "active") {
      updateDirective(d._id, { status: "blocked", nextRunAt: null, retiredReason: "self-improvement feature disabled" });
      blocked++;
    }
  }
  return blocked;
}

/** Render the open backlog as a prompt fragment a planner can include. "" when empty. */
export function formatOpenFeedbackForPlanning(limit = 10): string {
  const items = openFeedbackForPlanning(limit);
  if (items.length === 0) return "";
  return [
    "Open feedback (user-reported bugs + enhancement requests) worth folding into the plan when relevant (leading token is the feedbackId):",
    ...items.map((f) => `- ${f._id} [${f.kind}] ${f.title}${f.detail ? ` — ${f.detail.slice(0, 120)}` : ""}`),
  ].join("\n");
}

/**
 * Map a completed task's status to the feedback status it should advance to —
 * the "close the loop" decision. Pure, so the policy is testable on its own:
 *   - task "done" (proven/approved) → feedback "done"
 *   - task "review" (addressed, awaiting verification) → feedback "triaged"
 *   - anything else (failed/cancelled/in-flight) → no change (null)
 */
export function feedbackStatusForCompletedTask(taskStatus: string): FeedbackStatus | null {
  if (taskStatus === "done") return "done";
  if (taskStatus === "review") return "triaged";
  return null;
}

/**
 * Advance a feedback item that a completed task addressed. Only ever moves the
 * item forward (never re-opens or downgrades a closed/triaged item). Returns the
 * new status, or null if nothing changed. The caller links the task to the
 * feedback id (e.g. task.output.feedbackId); this resolves it on completion.
 */
export function resolveFeedbackForCompletedTask(feedbackId: string, taskStatus: string): FeedbackStatus | null {
  const next = feedbackStatusForCompletedTask(taskStatus);
  if (!next) return null;
  const item = getFeedback(feedbackId);
  if (!item) return null;
  if (item.status === "done" || item.status === "wontfix") return null; // already closed
  if (item.status === "triaged" && next === "triaged") return null;     // no forward movement
  setFeedbackStatus(feedbackId, next);
  return next;
}

export interface LoopHealth {
  total: number;
  open: number;
  triaged: number;
  done: number;
  wontfix: number;
  /** resolved (done + wontfix) / total. 0 when empty. */
  resolutionRate: number;
  /** Distinct normalized titles that appear more than once — chronic problems. */
  recurringIssues: number;
  /** Items captured automatically from directive reflection (source starts "directive:"/"reflection"). */
  fromReflection: number;
  /** Age in days of the oldest still-open/triaged item, or null if none. */
  oldestOpenAgeDays: number | null;
  generatedAt: string;
}

/**
 * The loop-health "eval": a measurable signal of whether the self-improvement
 * loop is actually closing (problems captured AND resolved) rather than just
 * accumulating. Reads the feedback backlog; `now` is injectable for tests.
 */
export function loopHealth(now: () => string = () => new Date().toISOString()): LoopHealth {
  const all = listFeedback();
  const byStatus: Record<FeedbackStatus, number> = { open: 0, triaged: 0, done: 0, wontfix: 0 };
  const titleCounts = new Map<string, number>();
  let fromReflection = 0;
  let oldestOpen: string | null = null;

  for (const f of all) {
    if (f.status in byStatus) byStatus[f.status] += 1;
    const n = normalizeFeedbackTitle(f.title);
    if (n) titleCounts.set(n, (titleCounts.get(n) ?? 0) + 1);
    if (f.source.startsWith("directive:") || f.source.startsWith("reflection")) fromReflection++;
    if ((f.status === "open" || f.status === "triaged") && (oldestOpen === null || f.createdAt < oldestOpen)) {
      oldestOpen = f.createdAt;
    }
  }

  const total = all.length;
  const resolved = byStatus.done + byStatus.wontfix;
  const nowIso = now();
  const oldestOpenAgeDays = oldestOpen
    ? Math.max(0, (Date.parse(nowIso) - Date.parse(oldestOpen)) / 86_400_000)
    : null;

  return {
    total,
    open: byStatus.open,
    triaged: byStatus.triaged,
    done: byStatus.done,
    wontfix: byStatus.wontfix,
    resolutionRate: total > 0 ? resolved / total : 0,
    recurringIssues: [...titleCounts.values()].filter((c) => c > 1).length,
    fromReflection,
    oldestOpenAgeDays,
    generatedAt: nowIso,
  };
}
