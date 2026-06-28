/**
 * Task Intake — a pure, deterministic preflight that classifies every new task
 * before it becomes a board task. No IO, no LLM, no DB. Models advise (later);
 * deterministic HiveMatrix policy decides (here).
 *
 * Most small tasks stay `normal_task` and run as they do today. Broad / multi-step
 * prompts become a `work_package_candidate` with proposed child items. Active
 * same-project work yields a conservative collision recommendation (default:
 * one non-worktree writer per repo → hold).
 *
 * See docs/superpowers/specs/2026-06-27-work-packages-task-intake-design.md.
 */

import { deriveTaskTitle } from "@/lib/tasks/derive-title";

export type IntakeKind =
  | "normal_task"
  | "workflow"
  | "lane_task"
  | "work_package_candidate"
  | "held";

export type IntakeRisk = "low" | "medium" | "high";

export type IntakeMode =
  | "run_now"
  | "hold"
  | "split"
  | "sequential"
  | "safe_parallel"
  | "worktree_parallel";

export interface IntakeActiveTask {
  taskId: string;
  title: string;
  worktreeName?: string | null;
}

export interface IntakeInput {
  title?: string;
  description: string;
  project?: string;
  projectPath?: string;
  model?: string;
  source?: string;
  executor?: string;
  attachments?: { count: number; kinds?: string[] };
  /** Active non-terminal tasks in the same project, supplied by the caller. */
  activeSameProject?: IntakeActiveTask[];
}

export interface ProposedItem {
  title: string;
  prompt: string;
  risk: IntakeRisk;
  executionMode: IntakeMode;
  scopeHints: string[];
  /** Proposed item titles this item depends on (resolved to ids on persist). */
  dependsOn: string[];
}

export interface IntakeProjectCollision {
  active: boolean;
  activeTaskIds: string[];
  recommendation: "hold" | "worktree_parallel" | "safe_parallel";
}

export interface GoalFlightMetadata {
  goal: string;
  successCriteria: string[];
  constraints?: string[];
}

export interface IntakeResult {
  kind: IntakeKind;
  confidence: number;
  reasons: string[];
  risk: IntakeRisk;
  suggestedMode: IntakeMode;
  projectCollision?: IntakeProjectCollision;
  packageCandidate?: { title: string; items: ProposedItem[] };
  goalFlight?: GoalFlightMetadata;
}

// ── Signal regexes ────────────────────────────────────────────────
const RELEASE_RE = /\b(release|deploy|publish|ship it|push to prod(uction)?|npm publish)\b|build and deploy/i;
const DESTRUCTIVE_RE = /\b(delete|drop table|rm -rf|force[- ]push|wipe|destroy)\b/i;
const CREDENTIALED_RE = /\b(send (an? )?(email|sms|message)|charge|transfer|api[_-]?keys?|credentials?|password)\b/i;

const WORKTREE_RE = /\bwork[- ]?tree\b/i;
const READONLY_RE = /\b(review|summari[sz]e|audit|read|report|inspect|analy[sz]e|list|show|explain)\b/i;
const WRITE_RE = /\b(fix|refactor|rename|update|edit|delete|build|deploy|add|remove|create|implement|write|migrate|change|patch|bump|install|upgrade|configure)\b/i;

const BROAD_KEYWORD_RE = /\bfix all\b|\ball (the|of the|of)\b|\bevery(thing|where)?\b|\bacross the (codebase|repo(sitory)?|project)\b|\b(the whole|entire)\b|\bmigrate\b|\band then\b/i;

/**
 * Goal Flight signal: broad outcome-based prompt that reads like a product objective
 * rather than a checklist. Matches prompts like "create a site that does X" or
 * "build me a platform for X with features Y and Z". Intentionally does NOT match
 * enumerated step-by-step prompts (those remain checklist Work Packages).
 */
const GOAL_FLIGHT_VERB_RE = /\b(create|build|make|develop|set up|launch|ship|design)\b/i;
const GOAL_FLIGHT_SCOPE_RE = /\b(a|an)\s+(?:\w+\s+)?(web\s*site|website|app|application|service|api|platform|dashboard|tool|system|bot|integration|marketplace|store|portal)\b/i;
const GOAL_FLIGHT_CRITERIA_RE = /\b(with|that|so\s+that|including|featuring|to\s+support|which\s+(allows?|lets?|enables?))\b/i;

function isGoalFlightPrompt(text: string): boolean {
  return GOAL_FLIGHT_VERB_RE.test(text)
    && GOAL_FLIGHT_SCOPE_RE.test(text)
    && (GOAL_FLIGHT_CRITERIA_RE.test(text) || text.length > 80);
}

function extractGoalFlightMetadata(text: string, title: string): GoalFlightMetadata {
  // The goal is the full prompt trimmed to a reasonable sentence.
  const goal = title || text.split(/[.,;]/)[0].trim().slice(0, 200);
  // Extract features/criteria as comma or "and"-separated requirements after connecting words.
  const criteriaMatch = text.match(/\b(?:with|that|including|featuring)\b(.+)$/i);
  let successCriteria: string[] = [];
  if (criteriaMatch) {
    successCriteria = criteriaMatch[1]
      .split(/,\s*(?:and\s+)?|\s+and\s+/)
      .map((s) => s.replace(/[.,;!?]+$/, "").trim())
      .filter((s) => s.length > 2 && s.length < 120);
  }
  if (successCriteria.length === 0) {
    successCriteria = ["Goal delivered as described"];
  }
  return { goal, successCriteria };
}

// Lane / workflow executors own their own routing — intake never re-promotes them.
const WORKFLOW_EXECUTORS = new Set(["workflow"]);
const LANE_EXECUTORS = new Set(["terminal-lane", "browser-lane", "video-review", "desktopbee"]);

/** True when the text is plausibly read-only (no strong write verb present). */
function isReadOnly(text: string): boolean {
  return READONLY_RE.test(text) && !WRITE_RE.test(text);
}

function riskOf(text: string): IntakeRisk {
  if (RELEASE_RE.test(text) || DESTRUCTIVE_RE.test(text) || CREDENTIALED_RE.test(text)) return "high";
  return "low";
}

/** Layered splitter: first splitter to yield >=2 substantive fragments wins. */
function splitFragments(text: string): string[] {
  const t = text.trim();
  const splitters: RegExp[] = [
    /\s*\d+[.)]\s+/, // numbered: "1. ", "2) "
    /\n+|\s*[-*]\s+/, // newlines / bullets
    /\s+and then\s+/i, // sequential conjunction
    /;\s*/, // semicolon list
    /,\s*(?:and\s+)?/i, // comma list, optional "and"
  ];
  for (const re of splitters) {
    const parts = t
      .split(re)
      .map((p) => p.replace(/[.!?,;]+$/, "").trim())
      .filter((p) => p.length > 2);
    if (parts.length >= 2) return parts;
  }
  return [t];
}

function numberedCount(text: string): number {
  return (text.match(/(?:^|\s)\d+[.)]\s+/g) ?? []).length;
}

export function classifyIntake(input: IntakeInput): IntakeResult {
  const description = (input.description ?? "").trim();
  const executor = (input.executor ?? "").trim();
  const source = (input.source ?? "").trim();

  // 1. Passthrough — already routed to a lane/workflow by the caller.
  if (WORKFLOW_EXECUTORS.has(executor) || source === "workflow") {
    return { kind: "workflow", confidence: 0.95, reasons: ["routed to a workflow executor"], risk: "low", suggestedMode: "run_now" };
  }
  if (LANE_EXECUTORS.has(executor) || source === "terminal-lane" || source === "browser-lane") {
    return { kind: "lane_task", confidence: 0.95, reasons: ["routed to a lane executor"], risk: riskOf(description), suggestedMode: "run_now" };
  }

  const reasons: string[] = [];
  const overallRisk = riskOf(description);

  // 2. Breadth detection.
  const fragments = splitFragments(description);
  const keywordBroad = BROAD_KEYWORD_RE.test(description);
  const enumerated = numberedCount(description) >= 2;
  const manySteps = fragments.length >= 3;
  const broad = keywordBroad || enumerated || manySteps;

  // 3. Collision detection (independent of breadth).
  const active = (input.activeSameProject ?? []).filter((a) => a && a.taskId);
  let collision: IntakeProjectCollision | undefined;
  if (active.length > 0) {
    const wantsWorktree = WORKTREE_RE.test(description) || active.every((a) => a.worktreeName);
    let recommendation: IntakeProjectCollision["recommendation"];
    if (wantsWorktree) recommendation = "worktree_parallel";
    else if (isReadOnly(description)) recommendation = "safe_parallel";
    else recommendation = "hold"; // default: one non-worktree writer per repo.
    collision = { active: true, activeTaskIds: active.map((a) => a.taskId), recommendation };
    reasons.push(`active same-project work (${active.length}) → ${recommendation}`);
  }

  // 4a. Goal Flight detection: broad outcome-based prompt (not an enumerated list).
  //     Returns a work_package_candidate with goalFlight metadata attached.
  if (!enumerated && isGoalFlightPrompt(description)) {
    const title = input.title?.trim() || deriveTaskTitle(description);
    const goalMeta = extractGoalFlightMetadata(description, title);
    reasons.push("broad outcome-based goal prompt");
    const items = fragments.length >= 2 ? proposedItemsFromFragments(fragments) : [{
      title: "Plan and execute goal",
      prompt: description,
      risk: "low" as IntakeRisk,
      executionMode: "sequential" as IntakeMode,
      scopeHints: [],
      dependsOn: [],
    }];
    return {
      kind: "work_package_candidate",
      confidence: 0.82,
      reasons,
      risk: items.some((it) => it.risk === "high") ? "high" : "medium",
      suggestedMode: "split",
      projectCollision: collision,
      packageCandidate: { title, items },
      goalFlight: goalMeta,
    };
  }

  // 4b. Promote to a Work Package when broad AND it decomposes into >=2 items.
  if (broad && fragments.length >= 2) {
    if (keywordBroad) reasons.push("broad-scope wording");
    if (enumerated) reasons.push("explicit multi-step enumeration");
    if (manySteps) reasons.push(`${fragments.length} sub-steps detected`);

    const items = proposedItemsFromFragments(fragments);

    return {
      kind: "work_package_candidate",
      confidence: 0.72,
      reasons,
      risk: items.some((it) => it.risk === "high") ? "high" : "medium",
      suggestedMode: "split",
      projectCollision: collision,
      packageCandidate: { title: input.title?.trim() || deriveTaskTitle(description), items },
    };
  }

  // 5. Not a package — normal task, possibly held by collision or high risk.
  let kind: IntakeKind = "normal_task";
  let suggestedMode: IntakeMode = "run_now";
  if (collision) {
    suggestedMode = collision.recommendation;
    if (collision.recommendation === "hold") kind = "held";
  } else if (overallRisk === "high") {
    suggestedMode = "hold";
    reasons.push("high-risk action requires a gate");
  }
  if (reasons.length === 0) reasons.push("single-step, low-risk request");

  return {
    kind,
    confidence: 0.9,
    reasons,
    risk: overallRisk,
    suggestedMode,
    projectCollision: collision,
  };
}

/**
 * Is the prompt broad enough to be worth a multi-step breakdown? Shared by the
 * sync classifier's promotion rule and by classifyIntakeAsync's decision to
 * consult the model even when the regex splitter found only one fragment.
 */
export function isBroadPrompt(description: string): boolean {
  const text = (description ?? "").trim();
  if (!text) return false;
  return BROAD_KEYWORD_RE.test(text) || numberedCount(text) >= 2 || splitFragments(text).length >= 3;
}

/** Expose the deterministic regex splitter (always returns ≥1 fragment). */
export function deterministicFragments(description: string): string[] {
  return splitFragments(description ?? "");
}

/**
 * Force a Work Package candidate even when the prompt isn't "broad" — used by the
 * explicit `route: "work_package"` selector. Prefers model/deterministic
 * decomposition (via classifyIntakeAsync); otherwise builds items from the regex
 * split, falling back to a single item = the whole prompt. Always ≥1 item, and
 * the same deterministic policy stamps risk/gate/concurrency.
 */
export async function forceWorkPackage(
  input: IntakeInput,
  deps?: import("./decompose").DecomposeDeps,
): Promise<{ title: string; items: ProposedItem[] }> {
  const enriched = await classifyIntakeAsync(input, deps);
  if (enriched.kind === "work_package_candidate" && enriched.packageCandidate) {
    return enriched.packageCandidate;
  }
  const frags = deterministicFragments(input.description).filter((f) => f.trim().length > 0);
  const items = proposedItemsFromFragments(frags.length >= 1 ? frags : [input.description]);
  return { title: input.title?.trim() || deriveTaskTitle(input.description), items };
}

/**
 * Build proposed work-package items from step fragments — the single policy
 * builder shared by the deterministic regex split AND model-advised
 * decomposition. ALL safety policy lives here: per-item risk, the held
 * release/deploy/destructive final-gate, and its dependency on every prior item.
 * The model only supplies fragment text; it can never escalate risk or skip a gate.
 */
export function proposedItemsFromFragments(fragments: string[]): ProposedItem[] {
  const baseTitles = fragments.map((f) => deriveTaskTitle(f, 70));
  return fragments.map((frag, i) => {
    const itemRisk = riskOf(frag);
    const isGated = RELEASE_RE.test(frag) || DESTRUCTIVE_RE.test(frag);
    const scopeHints: string[] = [];
    if (WORKTREE_RE.test(frag)) scopeHints.push("worktree");
    if (isReadOnly(frag)) scopeHints.push("read-only");
    return {
      title: baseTitles[i],
      prompt: frag,
      risk: isGated ? "high" : itemRisk,
      // Release/deploy/destructive steps are held (final-gated) and ordered last
      // via a dependency on every earlier item.
      executionMode: isGated ? "hold" : "sequential",
      scopeHints,
      dependsOn: isGated ? baseTitles.slice(0, i) : [],
    };
  });
}

// Test-injected decomposition deps (mirrors youtube-summary's pattern) so server
// tests stay deterministic and never hit a real model.
let _testDecomposeDeps: import("./decompose").DecomposeDeps | null = null;
export function _setIntakeDecomposeDepsForTests(deps: import("./decompose").DecomposeDeps | null): void {
  _testDecomposeDeps = deps;
}

/**
 * Async intake: runs the deterministic classifier, then — only for a broad
 * `work_package_candidate`, and only when enabled — asks the keyless local/CLI
 * model for a cleaner step breakdown. Falls back to the deterministic split on
 * any failure. Small/normal tasks never call a model (cost + latency stay zero).
 *
 * Enabled when: explicit `deps` passed, a test dep is injected, or the
 * `taskIntakeModelDecomposition` feature flag is on.
 */
export async function classifyIntakeAsync(
  input: IntakeInput,
  deps?: import("./decompose").DecomposeDeps,
): Promise<IntakeResult> {
  const base = classifyIntake(input);
  // Lane/workflow routes own themselves — never consult a model for them.
  if (base.kind === "workflow" || base.kind === "lane_task") return base;

  const alreadyCandidate = base.kind === "work_package_candidate" && !!base.packageCandidate;
  // Consult the model when the prompt is already a candidate (to IMPROVE the
  // split) OR when it's broad but the regex couldn't split it (to PROMOTE it).
  // Small/normal, non-broad prompts never reach the model.
  if (!alreadyCandidate && !isBroadPrompt(input.description)) return base;

  const effective = deps ?? _testDecomposeDeps ?? undefined;
  let enabled = effective != null;
  if (!enabled) {
    try {
      const { isFeatureEnabled } = await import("@/lib/config/features");
      enabled = isFeatureEnabled("taskIntakeModelDecomposition");
    } catch { enabled = false; }
  }
  if (!enabled) return base;

  try {
    const { decompose } = await import("./decompose");
    const fragments = await decompose(input, effective ?? {});
    if (!fragments || fragments.length < 2) return base;
    const items = proposedItemsFromFragments(fragments);
    if (items.length < 2) return base;
    const title = base.packageCandidate?.title || input.title?.trim() || deriveTaskTitle(input.description);
    return {
      kind: "work_package_candidate",
      confidence: alreadyCandidate ? base.confidence : 0.7,
      reasons: [...base.reasons, "model-advised decomposition"],
      risk: items.some((it) => it.risk === "high") ? "high" : (alreadyCandidate ? base.risk : "medium"),
      suggestedMode: "split",
      projectCollision: base.projectCollision,
      packageCandidate: { title, items },
      goalFlight: base.goalFlight,
    };
  } catch {
    return base;
  }
}
