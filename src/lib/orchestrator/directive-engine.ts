/**
 * Scheduled item run engine — the 24x7 autonomy loop.
 *
 * "Directive" is the internal/DB identifier; the user-facing product term is
 * "Scheduled item". All DB columns, types, and SQL queries use "directive" to
 * avoid a storage migration.
 *
 * A Scheduled item (Directive internally) is a standing objective. When due,
 * the engine opens a Run and walks it through the plan → execute → verify →
 * reflect → yield loop, one scheduler tick at a time. Every transition is
 * written to run_journal so an interrupted run resumes from its last recorded
 * step after a daemon restart.
 *
 *   Scheduled item / Directive (weeks)  ──>  Run (one episode)  ──>  Task[] (work units)
 *
 * Run phases (runs.phase):
 *   plan     → create bounded task set toward unmet criteria; journal "planned"
 *   execute  → wait for spawned tasks to reach a terminal state
 *   verify   → run provers; only prover results mutate criteria.proven
 *   reflect  → record a reflection; re-arm the directive per trigger policy
 *   done/failed → terminal
 *
 * Planning is model-driven: a `think`-role planner phase task proposes the run's
 * bounded task set, with the directive's own history (recent run outcomes + last
 * reflection) in its prompt so each episode builds on the previous ones. The
 * deterministic one-task-per-criterion path remains the fallback whenever the
 * planner task fails or returns unparseable output.
 */

import { Task, type TaskDoc } from "@/lib/db";
import {
  type DirectiveRow,
  type RunRow,
  getDirective,
  getDueDirectives,
  getActiveRuns,
  createRun,
  setRunPhase,
  updateDirective,
  journal,
  getCriteria,
  getJournal,
  getRecentTerminalRuns,
  markCriterionProven,
  allCriteriaProven,
} from "./directive-store";
import { computeNextRunAt, parseTriggerPolicy, type TriggerPolicy } from "@/lib/scheduling/trigger-policy";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import { routeByRole } from "@/lib/routing/router";
import { resolveModelId } from "@/lib/routing/model-resolver";
import {
  parseDirectivePlanOutput,
  parseDirectiveRetrospectiveOutput,
  parseDirectiveReviewOutput,
  parseDirectiveCheckpointPolicy,
  type DirectiveCheckpointLevel,
  type DirectiveCorrectiveTask,
  type DirectivePlan,
  type DirectiveRetrospective,
  writeDirectiveRetrospectiveLearning,
} from "./directive-autonomy";
import { requestCheckpointApproval, readCheckpointDecision } from "./approval";
import { configuredBrainRootDir, defaultBrainRootDir } from "@/lib/brain/settings";
import {
  isSelfImprovementDirective,
  formatOpenFeedbackForPlanning,
  resolveFeedbackForCompletedTask,
} from "@/lib/feedback/self-improvement";
import { deriveOutput } from "./derive-output";
import type { Turn } from "./turn-types";

const MAX_TASKS_PER_RUN = 5;
const TERMINAL_TASK_STATUSES = new Set(["review", "done", "failed"]);
const PHASE_TASK_STATUSES = new Set(["review", "done", "failed", "cancelled"]);

type DirectivePhaseTaskKind = "planner" | "replanner" | "reviewer" | "retrospective";
type DirectiveRunTask = Pick<TaskDoc, "_id" | "title" | "status" | "output" | "logs" | "turns">;

type DirectivePlanner = (input: {
  directive: DirectiveRow;
  run: RunRow;
  criteria: Array<{ _id: string; description: string }>;
}) => Promise<string | null>;

type DirectiveReviewer = (input: {
  directive: DirectiveRow;
  run: RunRow;
  criteria: Array<{ _id: string; description: string }>;
  tasks: Array<{ _id: string; status: string }>;
}) => Promise<string | null>;

type DirectiveRetrospectiveWriter = (input: {
  directive: DirectiveRow;
  run: RunRow;
  done: boolean;
  reflection: string;
}) => Promise<string | null>;

interface DirectiveTickOptions {
  brainRootDir?: string;
}

let directivePlannerForTests: DirectivePlanner | null = null;
let directiveReviewerForTests: DirectiveReviewer | null = null;
let directiveRetrospectiveForTests: DirectiveRetrospectiveWriter | null = null;

/**
 * Deep-planning hook: when planning would run on the LOCAL model (no cloud), the
 * plan is produced by Deep Think (test-time compute — N diverse rollouts →
 * self-consistency → synthesis on the local Qwen) instead of one single-shot call.
 * Latency doesn't matter for a directive plan, and the extra local tokens are free,
 * so this is the cheapest lever to make local planning meaningfully better. Returns
 * the synthesized plan text (parsed downstream) or null to fall back to the normal
 * planner task. Injected in tests so no real model is called.
 */
type DeepPlanner = (prompt: string) => Promise<string | null>;
let deepPlannerForTests: DeepPlanner | null = null;

export function _setDeepPlannerForTests(fn: DeepPlanner | null): void {
  deepPlannerForTests = fn;
}

async function runDeepThinkPlanner(prompt: string): Promise<string | null> {
  if (deepPlannerForTests) return deepPlannerForTests(prompt);
  try {
    const { deepThink } = await import("@/lib/models/deep-think");
    const result = await deepThink(prompt, {
      samples: 3,
      systemContext: "You are a planner. Return ONLY the plan as the exact JSON schema the instructions specify — no prose, no code fences.",
    });
    return result.answer;
  } catch {
    return null; // Deep Think unavailable → caller falls back to the planner task
  }
}

export function _setDirectivePlannerForTests(planner: DirectivePlanner | null): void {
  directivePlannerForTests = planner;
}

export function _setDirectiveReviewerForTests(reviewer: DirectiveReviewer | null): void {
  directiveReviewerForTests = reviewer;
}

export function _setDirectiveRetrospectiveForTests(retrospective: DirectiveRetrospectiveWriter | null): void {
  directiveRetrospectiveForTests = retrospective;
}

type CheckpointGate = "plan" | "completion";
type CheckpointDecision = "approve" | "reject" | "pending";

type DirectiveCheckpointResolver = (input: {
  directive: DirectiveRow;
  run: RunRow;
  gate: CheckpointGate;
  summary: string;
}) => Promise<CheckpointDecision>;

let directiveCheckpointResolverForTests: DirectiveCheckpointResolver | null = null;

export function _setDirectiveCheckpointResolverForTests(resolver: DirectiveCheckpointResolver | null): void {
  directiveCheckpointResolverForTests = resolver;
}

function checkpointLevel(directive: DirectiveRow): DirectiveCheckpointLevel {
  return parseDirectiveCheckpointPolicy(directive.approvalPolicy).level;
}

/** Journal a checkpoint step at most once per (run, gate) so a held run stays quiet. */
function journalCheckpointOnce(run: RunRow, directive: DirectiveRow, step: string, gate: CheckpointGate): void {
  const already = getJournal(run._id).some(
    (j) => j.step === step && j.payload.includes(`"gate":"${gate}"`)
  );
  if (already) return;
  journal(run._id, directive._id, step, { gate });
}

/**
 * Resolve a checkpoint to approve/reject/pending. Tests inject a resolver; in
 * production this reuses the file-based approval store (escalated by the W1.3
 * notify plane) — a pending checkpoint (re)writes the request and waits.
 */
async function resolveCheckpoint(input: {
  directive: DirectiveRow;
  run: RunRow;
  gate: CheckpointGate;
  summary: string;
}): Promise<CheckpointDecision> {
  if (directiveCheckpointResolverForTests) return directiveCheckpointResolverForTests(input);

  const decision = readCheckpointDecision(input.run._id, input.gate);
  if (decision === "approve") return "approve";
  if (decision === "denied") return "reject";
  requestCheckpointApproval({
    id: input.run._id,
    gate: input.gate,
    goal: input.directive.goal,
    summary: input.summary,
  });
  return "pending";
}

/**
 * Apply a checkpoint gate. Returns "proceed" when the run may continue (gate
 * not required, or approved), "hold" when it must wait, or "reject" when the
 * founder denied it. The caller turns "reject" into a failed run.
 */
async function applyCheckpoint(
  directive: DirectiveRow,
  run: RunRow,
  gate: CheckpointGate,
  summary: string
): Promise<"proceed" | "hold" | "reject"> {
  const level = checkpointLevel(directive);
  const required = gate === "plan" ? level === "plan" || level === "full" : level === "full";
  if (!required) return "proceed";

  const decision = await resolveCheckpoint({ directive, run, gate, summary });
  if (decision === "approve") {
    journalCheckpointOnce(run, directive, "checkpoint_approved", gate);
    return "proceed";
  }
  if (decision === "reject") return "reject";
  journalCheckpointOnce(run, directive, "checkpoint_pending", gate);
  return "hold";
}

function failRunRejected(run: RunRow, directive: DirectiveRow, gate: CheckpointGate, nowIso: string): void {
  setRunPhase(run._id, "failed", { failedAt: nowIso, failReason: "checkpoint_rejected" });
  journal(run._id, directive._id, "checkpoint_rejected", { gate });
}

function isDirectivePhaseTask(task: Pick<TaskDoc, "output">): boolean {
  const out = (task.output ?? {}) as Record<string, unknown>;
  return typeof out.directivePhase === "string";
}

async function collectAllRunTasks(directiveId: string, runId: string): Promise<DirectiveRunTask[]> {
  // Tasks spawned by this run are tagged with directiveId and a runId marker in output.
  const tasks = await Task.find({ directiveId });
  return tasks
    .filter((t): t is TaskDoc => {
      const out = (t.output ?? {}) as Record<string, unknown>;
      return out.runId === runId;
    });
}

async function collectRunTasks(directiveId: string, runId: string): Promise<Array<{ _id: string; status: string }>> {
  return (await collectAllRunTasks(directiveId, runId))
    .filter((t) => !isDirectivePhaseTask(t))
    .map((t) => ({ _id: t._id.toString(), status: t.status as string }));
}

async function findPhaseTask(directiveId: string, runId: string, phase: DirectivePhaseTaskKind): Promise<DirectiveRunTask | null> {
  const tasks = await collectAllRunTasks(directiveId, runId);
  return tasks.find((t) => {
    const out = (t.output ?? {}) as Record<string, unknown>;
    return out.directivePhase === phase && !out.directivePhaseConsumedAt;
  }) ?? null;
}

async function createPhaseTask(
  directive: DirectiveRow,
  run: RunRow,
  phase: DirectivePhaseTaskKind,
  title: string,
  description: string,
  profile: string
): Promise<DirectiveRunTask> {
  const { getDefaultModel, CLOUD_ONLY_ID } = await import("@/lib/models/available");
  const noLocal = getDefaultModel() === CLOUD_ONLY_ID;
  const route = routeByRole("think", getConnectivityPolicy(), { noLocal });
  const modelId = resolveModelId(route.tier);
  return Task.create({
    title,
    description,
    project: directive.project,
    projectPath: directive.projectPath,
    profile,
    model: modelId,
    directiveId: directive._id,
    status: "backlog",
    source: "directive",
    executor: "agent",
    output: {
      runId: run._id,
      directivePhase: phase,
      directivePhaseFor: run.phase,
      routedTier: route.tier,
    },
  });
}

function extractTaskText(task: DirectiveRunTask): string | null {
  const out = (task.output ?? {}) as Record<string, unknown>;
  for (const key of ["summary", "result", "text"]) {
    if (typeof out[key] === "string" && out[key].trim()) return out[key].trim();
  }

  if (Array.isArray(task.turns) && task.turns.length > 0) {
    try {
      const view = deriveOutput(task.turns as unknown as Turn[]);
      if (view.headline?.text?.trim()) return view.headline.text.trim();
      if (view.resultStats?.summaryText?.trim()) return view.resultStats.summaryText.trim();
    } catch {
      // Fall through to log fallback.
    }
  }

  if (Array.isArray(task.logs) && task.logs.length > 0) {
    let text = "";
    for (let i = task.logs.length - 1; i >= 0; i--) {
      const log = task.logs[i] as Record<string, unknown>;
      if (log.type === "text" && typeof log.content === "string" && log.content.trim()) {
        text = log.content + text;
      } else if (text) {
        break;
      }
    }
    if (text.trim()) return text.trim();
  }

  return null;
}

/**
 * The planner's memory of prior episodes: last reflection + recent run
 * outcomes, so each run builds on what already happened instead of replanning
 * from a blank slate. Empty string when this is the first run.
 */
function buildRunHistoryBlock(directiveId: string, currentRunId: string): string {
  let recent: RunRow[];
  try {
    recent = getRecentTerminalRuns(directiveId, 3).filter((r) => r._id !== currentRunId);
  } catch {
    return "";
  }
  if (recent.length === 0) return "";

  const lines: string[] = ["Previous runs (newest first):"];
  for (const r of recent) {
    const outcome = r.phase === "done" ? "done" : `failed (${r.failReason ?? "unknown"})`;
    lines.push(`- ${r.startedAt}: ${outcome}${r.planSummary ? ` — planned: ${r.planSummary.slice(0, 120)}` : ""}`);
  }
  const lastReflection = recent.find((r) => r.reflectionText?.trim())?.reflectionText;
  if (lastReflection) {
    lines.push("", "Last reflection:", lastReflection.slice(0, 800));
  }
  lines.push(
    "",
    "Use this history: do not repeat an approach that already failed; build on what the last run left off.",
  );
  return `\n${lines.join("\n")}\n`;
}

function buildPlannerPrompt(
  directive: DirectiveRow,
  run: RunRow,
  criteria: Array<{ _id: string; description: string }>
): string {
  const criteriaText = criteria.length > 0
    ? criteria.map((c, index) => `${index + 1}. ${c._id}: ${c.description}`).join("\n")
    : "No explicit criteria exist yet. Plan against the directive goal.";

  // Only the self-improvement directive pulls the global feedback backlog into
  // its plan; ordinary directives must not be derailed by unrelated feedback.
  const feedbackBlock = isSelfImprovementDirective(directive.goal)
    ? (() => {
        const fragment = formatOpenFeedbackForPlanning(10);
        return fragment
          ? `\n${fragment}\nFor each feedback item you choose to address, create a task and set its "feedbackId" to that item's id (shown as the leading token) so it auto-closes when this run proves out.\n`
          : "\nNo open feedback right now — nothing to do this run.\n";
      })()
    : "";

  return [
    "You are planning a HiveMatrix Directive run.",
    "",
    `Directive goal: ${directive.goal}`,
    `Run id: ${run._id}`,
    "",
    "Unproven criteria:",
    criteriaText,
    buildRunHistoryBlock(directive._id, run._id),
    feedbackBlock,
    "Return only fenced JSON with this shape:",
    "```json",
    "{",
    '  "tasks": [',
    "    {",
    '      "title": "short task title",',
    '      "description": "self-contained task instructions",',
    '      "agentType": "developer",',
    '      "dependsOn": [0],',
    '      "criterionRefs": ["criterion id or exact description"],',
    '      "goalIndex": 0,',
    '      "feedbackId": "(optional) the feedbackId this task addresses"',
    "    }",
    "  ]",
    "}",
    "```",
    "",
    `Create at most ${MAX_TASKS_PER_RUN} tasks. Use dependsOn indexes only for earlier tasks. Do not create tasks outside this directive.`,
  ].join("\n");
}

function buildReplannerPrompt(
  directive: DirectiveRow,
  run: RunRow,
  criteria: Array<{ _id: string; description: string }>,
  tasks: Array<{ _id: string; status: string }>
): string {
  const criteriaText = criteria.length > 0
    ? criteria.map((c, index) => `${index + 1}. ${c._id}: ${c.description}`).join("\n")
    : "No explicit criteria remain.";
  const taskText = tasks.length > 0
    ? tasks.map((t, index) => `${index + 1}. ${t._id}: ${t.status}`).join("\n")
    : "No execution tasks were produced.";
  const failedText = tasks
    .filter((t) => t.status === "failed")
    .map((t) => `- ${t._id}`)
    .join("\n") || "None";

  return [
    "You are replanning a HiveMatrix Directive run after execution failures.",
    "",
    `Directive goal: ${directive.goal}`,
    `Run id: ${run._id}`,
    "",
    "Unproven criteria:",
    criteriaText,
    "",
    "Execution task statuses:",
    taskText,
    "",
    "Failed task ids:",
    failedText,
    "",
    "Return only fenced JSON with this shape:",
    "```json",
    "{",
    '  "tasks": [',
    "    {",
    '      "title": "short task title",',
    '      "description": "self-contained recovery instructions",',
    '      "agentType": "developer",',
    '      "dependsOn": [0],',
    '      "criterionRefs": ["criterion id or exact description"],',
    '      "goalIndex": 0',
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "Create only the additional tasks needed to recover from failed work. Do not repeat successful work unless it is required as context.",
  ].join("\n");
}

function buildReviewerPrompt(
  directive: DirectiveRow,
  run: RunRow,
  criteria: Array<{ _id: string; description: string }>,
  tasks: Array<{ _id: string; status: string }>
): string {
  const criteriaText = criteria.length > 0
    ? criteria.map((c, index) => `${index + 1}. ${c._id}: ${c.description}`).join("\n")
    : "No explicit criteria remain.";
  const taskText = tasks.length > 0
    ? tasks.map((t, index) => `${index + 1}. ${t._id}: ${t.status}`).join("\n")
    : "No execution tasks were produced.";

  return [
    "You are reviewing a HiveMatrix Directive run.",
    "",
    `Directive goal: ${directive.goal}`,
    `Run id: ${run._id}`,
    "",
    "Unproven criteria:",
    criteriaText,
    "",
    "Execution tasks:",
    taskText,
    "",
    "Return only fenced JSON with this shape:",
    "```json",
    "{",
    '  "status": "pass",',
    '  "findings": [{ "task": "task id or title", "assessment": "pass", "notes": "evidence summary" }],',
    '  "gaps": [],',
    '  "correctiveTasks": [',
    '    { "title": "fix title", "description": "specific correction", "agentType": "developer", "criterionRefs": ["criterion id"] }',
    "  ],",
    '  "summary": "short review summary"',
    "}",
    "```",
    "",
    'Use status "pass" only when the evidence proves the criteria. Use "partial" or "fail" when gaps remain.',
  ].join("\n");
}

function buildRetrospectivePrompt(directive: DirectiveRow, run: RunRow, done: boolean, reflection: string): string {
  return [
    "You are writing a HiveMatrix Directive retrospective.",
    "",
    `Directive goal: ${directive.goal}`,
    `Run id: ${run._id}`,
    `Directive complete: ${done ? "yes" : "no"}`,
    `Engine reflection: ${reflection}`,
    "",
    "Return only fenced JSON with this shape:",
    "```json",
    "{",
    '  "overallAssessment": "what happened and what should be remembered",',
    '  "playbookDeltas": [',
    '    { "scope": "role:coo", "rule": "operational rule to remember", "reason": "why", "confidence": "medium" }',
    "  ],",
    '  "accessLedger": [',
    '    { "system": "service name", "status": "configured", "notes": "access state or blocker" }',
    "  ],",
    '  "skills": [',
    '    { "name": "short-skill-name", "description": "one line: when to use it", "tags": ["area"],',
    '      "body": "A reusable recipe a future agent can follow for this kind of task: when it applies, the concrete steps, and the gotchas. Only include a skill if a genuinely reusable procedure worked." }',
    "  ]",
    "}",
    "```",
    "",
    "Keep entries factual and reusable. Omit arrays when there is nothing useful to record. Only emit a skill when a repeatable procedure actually worked — not for one-off work.",
  ].join("\n");
}

async function markPhaseTaskConsumed(task: DirectiveRunTask, nowIso: string): Promise<void> {
  await Task.findByIdAndUpdate(task._id.toString(), {
    output: {
      ...(task.output ?? {}),
      directivePhaseConsumedAt: nowIso,
    },
  });
}

// ---------------------------------------------------------------------------
// Phase handlers
// ---------------------------------------------------------------------------

function summarizePlan(plan: DirectivePlan): string {
  return plan.tasks.map((t) => t.title).join("; ").slice(0, 200) || "(empty plan)";
}

function completionSummary(directive: DirectiveRow): string {
  return `Completion of: ${directive.goal.slice(0, 160)}`;
}

async function planRun(directive: DirectiveRow, run: RunRow): Promise<void> {
  const criteria = getCriteria(directive._id).filter((c) => c.proven === 0);
  let useProductionPlannerTask = true;

  if (directivePlannerForTests) {
    useProductionPlannerTask = false;
    const plannerText = await directivePlannerForTests({
      directive,
      run,
      criteria: criteria.map((c) => ({ _id: c._id, description: c.description })),
    });
    if (plannerText) {
      const parsed = parseDirectivePlanOutput(plannerText, criteria.map((c) => ({ _id: c._id, description: c.description })));
      if (parsed.plan) {
        const gate = await applyCheckpoint(directive, run, "plan", summarizePlan(parsed.plan));
        if (gate === "hold") return;
        if (gate === "reject") {
          failRunRejected(run, directive, "plan", new Date().toISOString());
          return;
        }
        await createAutonomyPlanTasks(directive, run, parsed.plan);
        return;
      }
      journal(run._id, directive._id, "planning_fallback", { reason: parsed.error ?? "invalid planner output" });
    }
  }

  // Deep planning (local only): when the plan would run on the local model rather
  // than the frontier, produce it with Deep Think (test-time compute on Qwen) for a
  // stronger plan. Best-effort and synchronous — a directive plan can afford minutes,
  // and the local tokens are free. Any miss falls through to the normal planner task.
  if (useProductionPlannerTask && !getConnectivityPolicy().canUseCloud()) {
    const refs = criteria.map((c) => ({ _id: c._id, description: c.description }));
    const text = await runDeepThinkPlanner(buildPlannerPrompt(directive, run, refs));
    if (text) {
      const parsed = parseDirectivePlanOutput(text, refs);
      if (parsed.plan) {
        const gate = await applyCheckpoint(directive, run, "plan", summarizePlan(parsed.plan));
        if (gate === "hold") return;
        if (gate === "reject") { failRunRejected(run, directive, "plan", new Date().toISOString()); return; }
        journal(run._id, directive._id, "deep_planned", { planSummary: summarizePlan(parsed.plan) });
        await createAutonomyPlanTasks(directive, run, parsed.plan);
        return;
      }
      journal(run._id, directive._id, "planning_fallback", { reason: "deep-think plan unparseable" });
    }
  }

  if (useProductionPlannerTask) {
    const plannerTask = await findPhaseTask(directive._id, run._id, "planner");
    if (!plannerTask) {
      const task = await createPhaseTask(
        directive,
        run,
        "planner",
        `[directive planner] ${directive.goal.slice(0, 50)}`,
        buildPlannerPrompt(directive, run, criteria.map((c) => ({ _id: c._id, description: c.description }))),
        "coo"
      );
      journal(run._id, directive._id, "planner_task_started", { taskId: task._id.toString() });
      return;
    }

    if (!PHASE_TASK_STATUSES.has(plannerTask.status as string)) return;

    if (plannerTask.status !== "failed" && plannerTask.status !== "cancelled") {
      const plannerText = extractTaskText(plannerTask);
      if (plannerText) {
        const parsed = parseDirectivePlanOutput(plannerText, criteria.map((c) => ({ _id: c._id, description: c.description })));
        if (parsed.plan) {
          const gate = await applyCheckpoint(directive, run, "plan", summarizePlan(parsed.plan));
          if (gate === "hold") return; // leave the planner task unconsumed; re-gate next tick
          const nowIso = new Date().toISOString();
          if (gate === "reject") {
            await markPhaseTaskConsumed(plannerTask, nowIso);
            failRunRejected(run, directive, "plan", nowIso);
            return;
          }
          await markPhaseTaskConsumed(plannerTask, nowIso);
          await createAutonomyPlanTasks(directive, run, parsed.plan);
          return;
        }
        journal(run._id, directive._id, "planning_fallback", {
          reason: parsed.error ?? "invalid planner output",
          taskId: plannerTask._id.toString(),
        });
      } else {
        journal(run._id, directive._id, "planning_fallback", {
          reason: "planner task produced no text output",
          taskId: plannerTask._id.toString(),
        });
      }
    } else {
      journal(run._id, directive._id, "planning_fallback", {
        reason: `planner task ended ${plannerTask.status}`,
        taskId: plannerTask._id.toString(),
      });
    }
  }

  // Deterministic v1 planner: one task per unmet criterion (capped). If a
  // directive has no criteria yet, fall back to a single goal task.
  const targets = criteria.length > 0
    ? criteria.slice(0, MAX_TASKS_PER_RUN).map((c) => c.description)
    : [directive.goal];

  const deterministicSummary = `Plan ${targets.length} task(s): ${targets.map((t) => t.slice(0, 40)).join("; ")}`;
  const planGate = await applyCheckpoint(directive, run, "plan", deterministicSummary);
  if (planGate === "hold") return;
  if (planGate === "reject") {
    failRunRejected(run, directive, "plan", new Date().toISOString());
    return;
  }

  // Route directive work by role through the connectivity policy, then resolve
  // the tier to a concrete model ID. Directive tasks are "execute" role by
  // default (bulk work); cloud-ok → frontier, local-only → local Qwen.
  // When the default posture is cloud-only, bulk work also stays on frontier
  // (the local model is never used).
  const { getDefaultModel, CLOUD_ONLY_ID } = await import("@/lib/models/available");
  const noLocal = getDefaultModel() === CLOUD_ONLY_ID;
  const route = routeByRole("execute", getConnectivityPolicy(), { noLocal });
  const modelId = resolveModelId(route.tier);

  const createdTaskIds: string[] = [];
  for (const target of targets) {
    const task = await Task.create({
      title: `[directive] ${target.slice(0, 60)}`,
      description: target,
      project: directive.project,
      projectPath: directive.projectPath,
      profile: directive.profile,
      model: modelId,
      directiveId: directive._id,
      status: "backlog",
      executor: "agent",
      // Tag the originating run so verify can find this run's tasks.
      output: { runId: run._id, routedTier: route.tier },
    });
    createdTaskIds.push(task._id.toString());
  }

  const planSummary = `Planned ${createdTaskIds.length} task(s): ${targets.map((t) => t.slice(0, 40)).join("; ")}`;
  setRunPhase(run._id, "execute", { planSummary });
  journal(run._id, directive._id, "planned", { taskIds: createdTaskIds, planSummary });
}

async function createAutonomyPlanTasks(directive: DirectiveRow, run: RunRow, plan: DirectivePlan): Promise<void> {
  const { getDefaultModel, CLOUD_ONLY_ID } = await import("@/lib/models/available");
  const noLocal = getDefaultModel() === CLOUD_ONLY_ID;
  const route = routeByRole("execute", getConnectivityPolicy(), { noLocal });
  const modelId = resolveModelId(route.tier);

  const createdTaskIds: string[] = [];
  for (const [index, planned] of plan.tasks.entries()) {
    const task = await Task.create({
      title: `[directive] ${planned.title.slice(0, 60)}`,
      description: planned.description,
      project: directive.project,
      projectPath: directive.projectPath,
      profile: planned.agentType || directive.profile,
      model: modelId,
      directiveId: directive._id,
      status: "backlog",
      executor: "agent",
      output: {
        runId: run._id,
        routedTier: route.tier,
        directiveDagIndex: index,
        dependsOnDagIndices: planned.dependsOn,
        criterionIds: planned.criterionIds,
        goalIndex: planned.goalIndex,
        ...(planned.feedbackId ? { feedbackId: planned.feedbackId } : {}),
      },
    });
    createdTaskIds.push(task._id.toString());
  }

  const planSummary = `Planned ${createdTaskIds.length} autonomy task(s): ${plan.tasks.map((t) => t.title.slice(0, 40)).join("; ")}`;
  setRunPhase(run._id, "execute", { planSummary });
  journal(run._id, directive._id, "task_dag_planned", {
    taskIds: createdTaskIds,
    planSummary,
    tasks: plan.tasks,
  });
}

async function createReplanTasks(directive: DirectiveRow, run: RunRow, plan: DirectivePlan): Promise<string[]> {
  const { getDefaultModel, CLOUD_ONLY_ID } = await import("@/lib/models/available");
  const noLocal = getDefaultModel() === CLOUD_ONLY_ID;
  const route = routeByRole("execute", getConnectivityPolicy(), { noLocal });
  const modelId = resolveModelId(route.tier);

  const existingTasks = await collectRunTasks(directive._id, run._id);
  const createdTaskIds: string[] = [];
  for (const [index, planned] of plan.tasks.entries()) {
    const task = await Task.create({
      title: `[directive replan] ${planned.title.slice(0, 50)}`,
      description: planned.description,
      project: directive.project,
      projectPath: directive.projectPath,
      profile: planned.agentType || directive.profile,
      model: modelId,
      directiveId: directive._id,
      status: "backlog",
      executor: "agent",
      output: {
        runId: run._id,
        routedTier: route.tier,
        directiveDagIndex: existingTasks.length + index,
        dependsOnDagIndices: planned.dependsOn,
        criterionIds: planned.criterionIds,
        goalIndex: planned.goalIndex,
        ...(planned.feedbackId ? { feedbackId: planned.feedbackId } : {}),
        replan: true,
        replanIndex: index,
      },
    });
    createdTaskIds.push(task._id.toString());
  }
  return createdTaskIds;
}

async function handleExecutionFailures(
  directive: DirectiveRow,
  run: RunRow,
  tasks: Array<{ _id: string; status: string }>
): Promise<boolean> {
  const failedTaskIds = tasks.filter((t) => t.status === "failed").map((t) => t._id);
  if (failedTaskIds.length === 0) return false;

  const criteria = getCriteria(directive._id).filter((c) => c.proven === 0);
  const replannerTask = await findPhaseTask(directive._id, run._id, "replanner");
  if (!replannerTask) {
    const task = await createPhaseTask(
      directive,
      run,
      "replanner",
      `[directive replanner] ${directive.goal.slice(0, 47)}`,
      buildReplannerPrompt(directive, run, criteria.map((c) => ({ _id: c._id, description: c.description })), tasks),
      "coo"
    );
    journal(run._id, directive._id, "replan_task_started", {
      taskId: task._id.toString(),
      failedTaskIds,
    });
    return true;
  }

  if (!PHASE_TASK_STATUSES.has(replannerTask.status as string)) return true;

  if (replannerTask.status !== "failed" && replannerTask.status !== "cancelled") {
    const replannerText = extractTaskText(replannerTask);
    if (replannerText) {
      const parsed = parseDirectivePlanOutput(replannerText, criteria.map((c) => ({ _id: c._id, description: c.description })));
      if (parsed.plan) {
        await markPhaseTaskConsumed(replannerTask, new Date().toISOString());
        const taskIds = await createReplanTasks(directive, run, parsed.plan);
        journal(run._id, directive._id, "replanned", {
          taskIds,
          failedTaskIds,
          tasks: parsed.plan.tasks,
        });
        return true;
      }
      journal(run._id, directive._id, "replan_fallback", {
        reason: parsed.error ?? "invalid replanner output",
        taskId: replannerTask._id.toString(),
      });
      return false;
    }
    journal(run._id, directive._id, "replan_fallback", {
      reason: "replanner task produced no text output",
      taskId: replannerTask._id.toString(),
    });
    return false;
  }

  journal(run._id, directive._id, "replan_fallback", {
    reason: `replanner task ended ${replannerTask.status}`,
    taskId: replannerTask._id.toString(),
  });
  return false;
}

async function advanceExecuting(directive: DirectiveRow, run: RunRow): Promise<void> {
  const tasks = await collectRunTasks(directive._id, run._id);
  if (tasks.length === 0) {
    // Nothing was created (shouldn't happen) — go straight to verify.
    setRunPhase(run._id, "verify");
    journal(run._id, directive._id, "execute_empty", {});
    return;
  }
  const allTerminal = tasks.every((t) => TERMINAL_TASK_STATUSES.has(t.status));
  if (!allTerminal) return; // keep waiting; re-checked next tick

  const handledFailure = await handleExecutionFailures(directive, run, tasks);
  if (handledFailure) return;

  setRunPhase(run._id, "verify");
  journal(run._id, directive._id, "executed", {
    tasks: tasks.map((t) => ({ id: t._id, status: t.status })),
  });
}

async function verifyRun(directive: DirectiveRow, run: RunRow, nowIso: string): Promise<void> {
  const tasks = await collectRunTasks(directive._id, run._id);
  const succeeded = new Set(tasks.filter((t) => t.status === "review" || t.status === "done").map((t) => t._id));
  const criteria = getCriteria(directive._id).filter((c) => c.proven === 0);
  let useProductionReviewerTask = true;

  if (directiveReviewerForTests) {
    useProductionReviewerTask = false;
    const reviewerText = await directiveReviewerForTests({
      directive,
      run,
      criteria: criteria.map((c) => ({ _id: c._id, description: c.description })),
      tasks,
    });
    if (reviewerText) {
      const parsed = parseDirectiveReviewOutput(reviewerText, criteria.map((c) => ({ _id: c._id, description: c.description })));
      if (parsed.review) {
        if (parsed.review.status !== "pass" && parsed.review.correctiveTasks.length > 0) {
          const correctiveTaskIds = await createCorrectiveTasks(directive, run, parsed.review.correctiveTasks);
          setRunPhase(run._id, "execute");
          journal(run._id, directive._id, "reviewed", {
            status: parsed.review.status,
            findings: parsed.review.findings,
            gaps: parsed.review.gaps,
            summary: parsed.review.summary,
            correctiveTaskIds,
          });
          return;
        }

        const completion = await applyCheckpoint(directive, run, "completion", completionSummary(directive));
        if (completion === "hold") return;
        if (completion === "reject") {
          failRunRejected(run, directive, "completion", nowIso);
          return;
        }

        const proven: string[] = [];
        if (parsed.review.status === "pass" && succeeded.size > 0) {
          for (const c of criteria) {
            markCriterionProven(c._id, nowIso);
            proven.push(c._id);
          }
        }
        if (proven.length > 0) await resolveProvenFeedback(directive, run);
        setRunPhase(run._id, "reflect");
        journal(run._id, directive._id, "reviewed", {
          status: parsed.review.status,
          findings: parsed.review.findings,
          gaps: parsed.review.gaps,
          summary: parsed.review.summary,
          correctiveTaskIds: [],
          provenCriteria: proven,
          successfulTasks: succeeded.size,
        });
        return;
      }
      journal(run._id, directive._id, "review_fallback", { reason: parsed.error ?? "invalid reviewer output" });
    }
  }

  if (useProductionReviewerTask) {
    const reviewerTask = await findPhaseTask(directive._id, run._id, "reviewer");
    if (!reviewerTask) {
      const task = await createPhaseTask(
        directive,
        run,
        "reviewer",
        `[directive reviewer] ${directive.goal.slice(0, 49)}`,
        buildReviewerPrompt(directive, run, criteria.map((c) => ({ _id: c._id, description: c.description })), tasks),
        "qa"
      );
      journal(run._id, directive._id, "reviewer_task_started", { taskId: task._id.toString() });
      return;
    }

    if (!PHASE_TASK_STATUSES.has(reviewerTask.status as string)) return;

    if (reviewerTask.status !== "failed" && reviewerTask.status !== "cancelled") {
      const reviewerText = extractTaskText(reviewerTask);
      if (reviewerText) {
        const parsed = parseDirectiveReviewOutput(reviewerText, criteria.map((c) => ({ _id: c._id, description: c.description })));
        if (parsed.review) {
          if (parsed.review.status !== "pass" && parsed.review.correctiveTasks.length > 0) {
            await markPhaseTaskConsumed(reviewerTask, nowIso);
            const correctiveTaskIds = await createCorrectiveTasks(directive, run, parsed.review.correctiveTasks);
            setRunPhase(run._id, "execute");
            journal(run._id, directive._id, "reviewed", {
              status: parsed.review.status,
              findings: parsed.review.findings,
              gaps: parsed.review.gaps,
              summary: parsed.review.summary,
              correctiveTaskIds,
            });
            return;
          }

          const completion = await applyCheckpoint(directive, run, "completion", completionSummary(directive));
          if (completion === "hold") return; // leave the reviewer task unconsumed; re-gate next tick
          if (completion === "reject") {
            await markPhaseTaskConsumed(reviewerTask, nowIso);
            failRunRejected(run, directive, "completion", nowIso);
            return;
          }
          await markPhaseTaskConsumed(reviewerTask, nowIso);

          const proven: string[] = [];
          if (parsed.review.status === "pass" && succeeded.size > 0) {
            for (const c of criteria) {
              markCriterionProven(c._id, nowIso);
              proven.push(c._id);
            }
          }
          if (proven.length > 0) await resolveProvenFeedback(directive, run);
          setRunPhase(run._id, "reflect");
          journal(run._id, directive._id, "reviewed", {
            status: parsed.review.status,
            findings: parsed.review.findings,
            gaps: parsed.review.gaps,
            summary: parsed.review.summary,
            correctiveTaskIds: [],
            provenCriteria: proven,
            successfulTasks: succeeded.size,
          });
          return;
        }
        journal(run._id, directive._id, "review_fallback", {
          reason: parsed.error ?? "invalid reviewer output",
          taskId: reviewerTask._id.toString(),
        });
      } else {
        journal(run._id, directive._id, "review_fallback", {
          reason: "reviewer task produced no text output",
          taskId: reviewerTask._id.toString(),
        });
      }
    } else {
      journal(run._id, directive._id, "review_fallback", {
        reason: `reviewer task ended ${reviewerTask.status}`,
        taskId: reviewerTask._id.toString(),
      });
    }
  }

  const completion = await applyCheckpoint(directive, run, "completion", completionSummary(directive));
  if (completion === "hold") return;
  if (completion === "reject") {
    failRunRejected(run, directive, "completion", nowIso);
    return;
  }

  // v1 prover: a criterion is proven when the run produced ≥1 successful task.
  // (Richer provers — test/probe/artifact — slot in here by criterion.proverType.)
  const proven: string[] = [];
  if (succeeded.size > 0) {
    for (const c of criteria) {
      markCriterionProven(c._id, nowIso);
      proven.push(c._id);
    }
  }

  if (proven.length > 0) await resolveProvenFeedback(directive, run);
  setRunPhase(run._id, "reflect");
  journal(run._id, directive._id, "verified", { provenCriteria: proven, successfulTasks: succeeded.size });
}

async function createCorrectiveTasks(directive: DirectiveRow, run: RunRow, correctiveTasks: DirectiveCorrectiveTask[]): Promise<string[]> {
  const { getDefaultModel, CLOUD_ONLY_ID } = await import("@/lib/models/available");
  const noLocal = getDefaultModel() === CLOUD_ONLY_ID;
  const route = routeByRole("execute", getConnectivityPolicy(), { noLocal });
  const modelId = resolveModelId(route.tier);

  const createdTaskIds: string[] = [];
  for (const [index, corrective] of correctiveTasks.entries()) {
    const task = await Task.create({
      title: `[directive corrective] ${corrective.title.slice(0, 50)}`,
      description: corrective.description,
      project: directive.project,
      projectPath: directive.projectPath,
      profile: corrective.agentType || directive.profile,
      model: modelId,
      directiveId: directive._id,
      status: "backlog",
      executor: "agent",
      output: {
        runId: run._id,
        routedTier: route.tier,
        corrective: true,
        correctiveIndex: index,
        criterionIds: corrective.criterionIds,
      },
    });
    createdTaskIds.push(task._id.toString());
  }
  return createdTaskIds;
}

/**
 * Self-improvement bridge: capture a retrospective's problems + follow-ups as
 * deduped feedback so recurring issues become tracked, measurable work instead
 * of evaporating into playbook prose. Non-critical — never blocks the run.
 */
async function recordReflectionFeedback(retrospective: DirectiveRetrospective, directive: DirectiveRow, run: RunRow): Promise<void> {
  try {
    const { recordRetrospectiveFeedback } = await import("@/lib/feedback/self-improvement");
    const counts = recordRetrospectiveFeedback(retrospective, `directive:${run._id}`);
    if (counts.created > 0 || counts.skipped > 0) {
      journal(run._id, directive._id, "reflection_feedback_recorded", counts);
    }
  } catch (err) {
    journal(run._id, directive._id, "reflection_feedback_failed", { reason: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Hook B of the self-improvement loop: when a run proves out, close the feedback
 * items its feedback-linked tasks addressed (triaged → done). The forward-only
 * resolver never re-opens or downgrades. Non-critical — never blocks the run.
 */
async function resolveProvenFeedback(directive: DirectiveRow, run: RunRow): Promise<void> {
  try {
    const tasks = await collectAllRunTasks(directive._id, run._id);
    let closed = 0;
    for (const t of tasks) {
      const out = (t.output ?? {}) as Record<string, unknown>;
      const fid = typeof out.feedbackId === "string" ? out.feedbackId : null;
      if (!fid) continue;
      if (t.status !== "review" && t.status !== "done") continue;
      if (resolveFeedbackForCompletedTask(fid, "done")) closed++;
    }
    if (closed > 0) journal(run._id, directive._id, "feedback_closed_on_proof", { closed });
  } catch (err) {
    journal(run._id, directive._id, "feedback_close_failed", { reason: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Skill distillation: persist the retrospective's reusable recipes into the
 * skill library (<brain>/skills/), refining any that already exist. The
 * constructive half of self-improvement — experience becomes applicable skill.
 * Non-critical — never blocks the run.
 */
async function recordDistilledSkills(retrospective: DirectiveRetrospective, directive: DirectiveRow, run: RunRow): Promise<void> {
  if (!retrospective.skills || retrospective.skills.length === 0) return;
  try {
    const { upsertSkill } = await import("@/lib/skills/store");
    let created = 0;
    let refined = 0;
    for (const s of retrospective.skills) {
      const r = await upsertSkill({ name: s.name, description: s.description, tags: s.tags, body: s.body, source: `directive:${run._id}` });
      if (r.created) created++;
      else if (r.refined) refined++;
    }
    if (created > 0 || refined > 0) journal(run._id, directive._id, "skills_distilled", { created, refined });
  } catch (err) {
    journal(run._id, directive._id, "skills_distill_failed", { reason: err instanceof Error ? err.message : String(err) });
  }
}

async function reflectAndYield(directive: DirectiveRow, run: RunRow, nowIso: string, options: DirectiveTickOptions = {}): Promise<void> {
  const done = allCriteriaProven(directive._id);
  const reflection = done
    ? `All criteria proven; directive complete.`
    : `Run complete; criteria remain open. Re-arming per trigger policy.`;
  const brainRootDir = options.brainRootDir ?? configuredBrainRootDir() ?? defaultBrainRootDir();
  let useProductionRetrospectiveTask = true;

  if (directiveRetrospectiveForTests) {
    useProductionRetrospectiveTask = false;
    try {
      const retrospectiveText = await directiveRetrospectiveForTests({ directive, run, done, reflection });
      if (retrospectiveText) {
        const parsed = parseDirectiveRetrospectiveOutput(retrospectiveText);
        if (parsed.retrospective) {
          const result = await writeDirectiveRetrospectiveLearning(parsed.retrospective, {
            brainRootDir,
            project: directive.project,
            runId: run._id,
            directiveGoal: directive.goal,
            dateStr: nowIso.slice(0, 10),
          });
          journal(run._id, directive._id, "retrospective_recorded", { ...result });
          await recordReflectionFeedback(parsed.retrospective, directive, run);
          await recordDistilledSkills(parsed.retrospective, directive, run);
        } else {
          journal(run._id, directive._id, "retrospective_fallback", { reason: parsed.error ?? "invalid retrospective output" });
        }
      }
    } catch (err) {
      journal(run._id, directive._id, "retrospective_failed", { reason: err instanceof Error ? err.message : String(err) });
    }
  }

  if (useProductionRetrospectiveTask) {
    const retrospectiveTask = await findPhaseTask(directive._id, run._id, "retrospective");
    if (!retrospectiveTask) {
      const task = await createPhaseTask(
        directive,
        run,
        "retrospective",
        `[directive retrospective] ${directive.goal.slice(0, 45)}`,
        buildRetrospectivePrompt(directive, run, done, reflection),
        "coo"
      );
      journal(run._id, directive._id, "retrospective_task_started", { taskId: task._id.toString() });
      return;
    }

    if (!PHASE_TASK_STATUSES.has(retrospectiveTask.status as string)) return;

    if (retrospectiveTask.status !== "failed" && retrospectiveTask.status !== "cancelled") {
      const retrospectiveText = extractTaskText(retrospectiveTask);
      if (retrospectiveText) {
        try {
          const parsed = parseDirectiveRetrospectiveOutput(retrospectiveText);
          if (parsed.retrospective) {
            await markPhaseTaskConsumed(retrospectiveTask, nowIso);
            const result = await writeDirectiveRetrospectiveLearning(parsed.retrospective, {
              brainRootDir,
              project: directive.project,
              runId: run._id,
              directiveGoal: directive.goal,
              dateStr: nowIso.slice(0, 10),
            });
            journal(run._id, directive._id, "retrospective_recorded", { ...result });
            await recordReflectionFeedback(parsed.retrospective, directive, run);
            await recordDistilledSkills(parsed.retrospective, directive, run);
          } else {
            journal(run._id, directive._id, "retrospective_fallback", {
              reason: parsed.error ?? "invalid retrospective output",
              taskId: retrospectiveTask._id.toString(),
            });
          }
        } catch (err) {
          journal(run._id, directive._id, "retrospective_failed", {
            reason: err instanceof Error ? err.message : String(err),
            taskId: retrospectiveTask._id.toString(),
          });
        }
      } else {
        journal(run._id, directive._id, "retrospective_fallback", {
          reason: "retrospective task produced no text output",
          taskId: retrospectiveTask._id.toString(),
        });
      }
    } else {
      journal(run._id, directive._id, "retrospective_fallback", {
        reason: `retrospective task ended ${retrospectiveTask.status}`,
        taskId: retrospectiveTask._id.toString(),
      });
    }
  }

  setRunPhase(run._id, "done", { reflectionText: reflection, completedAt: nowIso });
  journal(run._id, directive._id, "reflected", { done, reflection });

  if (done) {
    updateDirective(directive._id, { status: "done", lastRunId: run._id, lastRunAt: nowIso, nextRunAt: null });
    journal(run._id, directive._id, "yielded", { directiveStatus: "done" });
    return;
  }

  // Re-arm: compute next run time from the trigger policy.
  const policy: TriggerPolicy | null = parseTriggerPolicy(directive.triggerPolicy);
  const nextRunAt = policy ? computeNextRunAt(policy, nowIso, new Date(nowIso)) : null;
  // Manual/one-shot triggers (no schedule) go to sleep until re-triggered.
  const nextStatus = nextRunAt ? "active" : "sleeping";
  updateDirective(directive._id, {
    status: nextStatus,
    lastRunId: run._id,
    lastRunAt: nowIso,
    nextRunAt,
  });
  journal(run._id, directive._id, "yielded", { directiveStatus: nextStatus, nextRunAt });
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/**
 * One engine tick: advance every in-flight run by one phase, then open runs
 * for any due directives that don't already have an active run.
 *
 * Idempotent and safe to call every scheduler tick.
 */
export async function directiveTick(now: Date = new Date(), options: DirectiveTickOptions = {}): Promise<void> {
  const nowIso = now.toISOString();

  // 1. Advance in-flight runs.
  const active = getActiveRuns();
  const directivesWithActiveRun = new Set(active.map((r) => r.directiveId));

  for (const run of active) {
    const directive = getDirective(run.directiveId);
    if (!directive) {
      setRunPhase(run._id, "failed", { failedAt: nowIso, failReason: "directive missing" });
      continue;
    }
    try {
      switch (run.phase) {
        case "plan":    await planRun(directive, run); break;
        case "execute": await advanceExecuting(directive, run); break;
        case "verify":  await verifyRun(directive, run, nowIso); break;
        case "reflect": await reflectAndYield(directive, run, nowIso, options); break;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setRunPhase(run._id, "failed", { failedAt: nowIso, failReason: reason });
      journal(run._id, directive._id, "run_failed", { reason });
    }
  }

  // 2. Open runs for due directives without an active run.
  for (const directive of getDueDirectives(nowIso)) {
    if (directivesWithActiveRun.has(directive._id)) continue;
    const run = createRun(directive._id);
    journal(run._id, directive._id, "run_started", { goal: directive.goal });
    updateDirective(directive._id, { lastRunId: run._id, lastRunAt: nowIso });
  }
}
