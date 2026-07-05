/**
 * Flight Loop pass runner — quality profile MVP (Slice 1). Runs a single
 * bounded inspection-and-action cycle: reconcile → gather evidence → classify
 * state → create draft follow-up items → persist pass record → broadcast.
 *
 * Deterministic policy; no LLM calls.
 * See docs/superpowers/specs/2026-06-27-flight-loops-quality-passes-design.md.
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getDb } from "@/lib/db";
import { scrubSecretText } from "@/lib/workflows/runs";
import { reconcileWorkPackage } from "./orchestrate";
import { getWorkPackage } from "./store";
import { createFollowUpItems, createGateFollowUpItems, createCriterionFollowUpItems } from "./follow-up-creator";
import {
  getLoop,
  createPass,
  completePass,
  updateLoopAfterPass,
  type FlightLoop,
  type FlightLoopPass,
  type LoopStatus,
} from "./flight-loop-store";

export type PassStateClassification = "clean" | "needs_follow_up" | "blocked" | "risky" | "running";

interface ProfileStrategy {
  requiresGates: boolean;
  allowsItemCreation: boolean;
  forceDraftItems: boolean;
  forceHeldRiskyItems: boolean;
  /** personal_admin: hold medium-risk items too, not just high */
  forceHeldMediumRisk: boolean;
  stopLoopOnGateFailure: boolean;
  /** release: gather signing/artifact evidence without re-running release.mjs */
  gatherReleaseArtifacts: boolean;
  /** watch: keep loop active as long as items are running or ready */
  continueIfRunning: boolean;
}

function getProfileStrategy(profile: import("./flight-loop-store").PassProfile): ProfileStrategy {
  switch (profile) {
    case "release":
      return { requiresGates: true, allowsItemCreation: true, forceDraftItems: false, forceHeldRiskyItems: true, forceHeldMediumRisk: false, stopLoopOnGateFailure: true, gatherReleaseArtifacts: true, continueIfRunning: false };
    case "watch":
      return { requiresGates: false, allowsItemCreation: false, forceDraftItems: false, forceHeldRiskyItems: false, forceHeldMediumRisk: false, stopLoopOnGateFailure: false, gatherReleaseArtifacts: false, continueIfRunning: true };
    case "personal_admin":
      return { requiresGates: false, allowsItemCreation: true, forceDraftItems: false, forceHeldRiskyItems: true, forceHeldMediumRisk: true, stopLoopOnGateFailure: false, gatherReleaseArtifacts: false, continueIfRunning: false };
    case "goal_quality":
      return { requiresGates: false, allowsItemCreation: true, forceDraftItems: false, forceHeldRiskyItems: false, forceHeldMediumRisk: false, stopLoopOnGateFailure: false, gatherReleaseArtifacts: false, continueIfRunning: false };
    default: // quality
      return { requiresGates: false, allowsItemCreation: true, forceDraftItems: false, forceHeldRiskyItems: false, forceHeldMediumRisk: false, stopLoopOnGateFailure: false, gatherReleaseArtifacts: false, continueIfRunning: false };
  }
}

export interface ClassifyPassStateInput {
  /** Item status counts keyed by PackageStatus values. */
  counts: Record<string, number>;
  /** Count of non-terminal, non-failed, non-held items with a non-null blocker string. */
  blockedItemCount: number;
}

/**
 * Deterministic state classifier for a Flight pass. Pure function — no I/O.
 *
 * Priority (first match wins): risky > blocked > needs_follow_up > running > clean.
 * - risky: held items exist (approval required before they can run).
 * - blocked: non-terminal, non-failed, non-held items have an explicit blocker string.
 * - needs_follow_up: failed or review items require attention.
 * - running: active items are executing; nothing urgent yet.
 * - clean: all items in terminal states or nothing actionable.
 */
export function classifyPassState(input: ClassifyPassStateInput): PassStateClassification {
  const c = input.counts;
  if ((c["held"] ?? 0) > 0) return "risky";
  if (input.blockedItemCount > 0) return "blocked";
  if ((c["failed"] ?? 0) > 0 || (c["review"] ?? 0) > 0) return "needs_follow_up";
  if ((c["running"] ?? 0) > 0) return "running";
  return "clean";
}

export type CriterionStatus = "met" | "in_progress" | "unmet";

export interface CriterionResult {
  criterion: string;
  status: CriterionStatus;
}

/**
 * Maps each success criterion to a status by inspecting existing items.
 * A criterion is matched when its text (case-insensitive) appears in an item
 * title or prompt. "met" = a matching item is done; "in_progress" = matching
 * item exists but isn't done; "unmet" = no matching item found.
 */
export function classifyCriteria(
  criteria: string[],
  items: Array<{ title: string; prompt: string; status: string }>,
): CriterionResult[] {
  return criteria.map((criterion) => {
    const lc = criterion.toLowerCase();
    const matching = items.filter(
      (i) => i.title.toLowerCase().includes(lc) || i.prompt.toLowerCase().includes(lc),
    );
    if (matching.length === 0) return { criterion, status: "unmet" as const };
    if (matching.some((i) => i.status === "done")) return { criterion, status: "met" as const };
    return { criterion, status: "in_progress" as const };
  });
}

export interface RunPassResult {
  loop: FlightLoop;
  pass: FlightLoopPass;
  createdItemIds: string[];
}

function buildSummary(
  counts: Record<string, number>,
  createdCount: number,
  stopReason: string | null,
  archivedCount = 0,
  cancelledHighRiskCount = 0,
  criteriaStatus?: CriterionResult[] | null,
): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const parts = [`${counts.done ?? 0}/${total} items done`];
  if (archivedCount > 0) parts.push(`${archivedCount} archived`);
  if (cancelledHighRiskCount > 0) parts.push(`${cancelledHighRiskCount} high-risk skipped`);
  if ((counts.failed ?? 0) > 0) parts.push(`${counts.failed} failed`);
  if ((counts.review ?? 0) > 0) parts.push(`${counts.review} in review`);
  if (criteriaStatus && criteriaStatus.length > 0) {
    const metCount = criteriaStatus.filter((c) => c.status === "met").length;
    parts.push(`${metCount}/${criteriaStatus.length} criteria met`);
  }
  if (createdCount > 0) parts.push(`${createdCount} follow-up item${createdCount === 1 ? "" : "s"} created`);
  if (stopReason) parts.push(`stopped: ${stopReason}`);
  return parts.join("; ");
}

function computeNextRunAt(loop: FlightLoop, stopped: boolean): string | null {
  if (stopped || loop.mode !== "fixed" || !loop.cadenceSeconds) return null;
  return new Date(Date.now() + loop.cadenceSeconds * 1000).toISOString();
}

export interface RepoGate {
  name: string;
  command: string;
  args: string[];
}

export interface RepoGateResult {
  name: string;
  passed: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
}

/**
 * Discovers which repo gates are available by inspecting the project directory.
 * Pure function except for filesystem reads. Does not run any commands.
 *
 * Discovers:
 *   - "typecheck" when package.json contains scripts.typecheck
 *   - "tests"     when package.json contains scripts.test
 *   - "scope-wall" when scripts/scope-wall.mjs exists
 */
export function discoverRepoGates(projectPath: string): RepoGate[] {
  if (!projectPath) return [];
  const gates: RepoGate[] = [];

  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, "utf8");
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      const scripts = pkg.scripts as Record<string, string> | undefined;
      if (scripts?.typecheck) {
        gates.push({ name: "typecheck", command: "npm", args: ["run", "typecheck"] });
      }
      if (scripts?.test) {
        gates.push({ name: "tests", command: "npm", args: ["test"] });
      }
    } catch { /* malformed package.json — skip */ }
  }

  if (existsSync(join(projectPath, "scripts", "scope-wall.mjs"))) {
    gates.push({ name: "scope-wall", command: "node", args: ["scripts/scope-wall.mjs"] });
  }

  return gates;
}

/**
 * Runs each gate in the project directory and returns results. Blocks
 * synchronously per gate (spawnSync). Each gate is bounded by timeoutMs.
 */
export function runRepoGates(
  projectPath: string,
  gates: RepoGate[],
  timeoutMs = 60_000,
): RepoGateResult[] {
  return gates.map((gate) => {
    const start = Date.now();
    try {
      const r = spawnSync(gate.command, gate.args, {
        cwd: projectPath,
        encoding: "utf8",
        timeout: timeoutMs,
      });
      const combined = [r.stdout ?? "", r.stderr ?? ""].filter(Boolean).join("\n");
      return {
        name: gate.name,
        passed: r.status === 0,
        exitCode: r.status,
        output: scrubSecretText(combined.slice(0, 2000)),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        name: gate.name,
        passed: false,
        exitCode: null,
        output: scrubSecretText(err instanceof Error ? err.message.slice(0, 500) : "unknown error"),
        durationMs: Date.now() - start,
      };
    }
  });
}

function gatherGitEvidence(projectPath: string): { status: string; diffStat: string } | null {
  if (!projectPath) return null;
  try {
    const statusResult = spawnSync("git", ["status", "--short"], {
      cwd: projectPath,
      encoding: "utf8",
      timeout: 5000,
    });
    const diffResult = spawnSync("git", ["diff", "--stat", "HEAD"], {
      cwd: projectPath,
      encoding: "utf8",
      timeout: 5000,
    });
    if (statusResult.status !== 0) return null;
    const status = (statusResult.stdout ?? "").slice(0, 2000);
    const diffStat = (diffResult.stdout ?? "").slice(0, 2000);
    return { status, diffStat };
  } catch {
    return null;
  }
}

export interface ReleaseArtifactEvidence {
  /** A canonical release script is present (developer-id-release.sh, or legacy release.mjs). */
  releaseScriptExists: boolean;
  packageVersion: string | null;
  /** Git tag pointing at HEAD, e.g. "v0.1.102"; null if no tag or git unavailable. */
  gitTagAtHead: string | null;
}

function gatherReleaseArtifactEvidence(projectPath: string): ReleaseArtifactEvidence {
  const releaseScriptExists =
    existsSync(join(projectPath, "scripts", "developer-id-release.sh")) ||
    existsSync(join(projectPath, "scripts", "release.mjs"));
  let packageVersion: string | null = null;
  let gitTagAtHead: string | null = null;

  const pkgPath = join(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const raw = readFileSync(pkgPath, "utf8");
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      packageVersion = typeof pkg.version === "string" ? pkg.version : null;
    } catch { /* malformed */ }
  }

  try {
    const r = spawnSync("git", ["tag", "--points-at", "HEAD"], {
      cwd: projectPath,
      encoding: "utf8",
      timeout: 5000,
    });
    const tags = (r.stdout ?? "").trim().split("\n").filter(Boolean);
    gitTagAtHead = tags.length > 0 ? tags[0] : null;
  } catch { /* no git */ }

  return { releaseScriptExists, packageVersion, gitTagAtHead };
}

function gatherTaskOutputs(
  items: Array<{ id: string; createdTaskId: string | null }>,
): Record<string, string> {
  const db = getDb();
  const outputs: Record<string, string> = {};
  for (const item of items) {
    if (!item.createdTaskId) continue;
    const row = db
      .prepare("SELECT output FROM tasks WHERE _id = ? LIMIT 1")
      .get(item.createdTaskId) as { output: string } | undefined;
    if (!row?.output) continue;
    try {
      const parsed = JSON.parse(row.output) as Record<string, unknown>;
      const summary = typeof parsed.summary === "string" ? parsed.summary
        : typeof parsed.result === "string" ? parsed.result
        : null;
      if (summary) outputs[item.id] = scrubSecretText(summary.slice(0, 500));
    } catch { /* non-JSON output — skip */ }
  }
  return outputs;
}

export async function runPass(packageId: string): Promise<RunPassResult> {
  const loop = getLoop(packageId);
  if (!loop) throw new Error(`no loop configured for package "${packageId}"`);
  if (loop.status === "stopped") throw new Error("loop is stopped");
  if (loop.status === "paused") throw new Error("loop is paused; resume it first");
  if (loop.passCount >= loop.maxPasses) {
    updateLoopAfterPass(loop.id, loop.passCount, "stopped", "max_passes_reached", null);
    throw new Error("max passes reached");
  }
  if (loop.expiresAt && new Date(loop.expiresAt) < new Date()) {
    updateLoopAfterPass(loop.id, loop.passCount, "stopped", "expired", null);
    throw new Error("loop has expired");
  }

  // Check Flight readiness — skip (don't consume a pass count) if Flight can't run yet.
  const pkgForStatus = getWorkPackage(packageId);
  if (!pkgForStatus) throw new Error(`package "${packageId}" not found`);
  if (pkgForStatus.status === "held" || pkgForStatus.status === "review") {
    const skippedPassNum = loop.passCount + 1;
    const skippedPass = createPass(loop.id, packageId, loop.profile, skippedPassNum);
    const completedSkipped = completePass(skippedPass.id, {
      status: "skipped",
      summary: null,
      evidence: {},
      createdItemIds: [],
      stopReason: "skipped_flight_not_ready",
    });
    // Loop passCount stays unchanged (no increment), loop status stays idle/active
    return { loop: getLoop(packageId)!, pass: completedSkipped, createdItemIds: [] };
  }

  // Atomic lock: flip idle/active → running in one statement.
  // SQLite serializes writes; exactly one concurrent caller gets changes=1.
  const lockResult = getDb()
    .prepare(
      "UPDATE flight_loops SET status = 'running', updatedAt = ? WHERE _id = ? AND status IN ('idle', 'active')",
    )
    .run(new Date().toISOString(), loop.id);
  if (lockResult.changes === 0) {
    throw new Error("a pass is already running for this loop");
  }

  const newPassCount = loop.passCount + 1;
  const pass = createPass(loop.id, packageId, loop.profile, newPassCount);
  const strategy = getProfileStrategy(loop.profile);

  try {
    await reconcileWorkPackage(packageId);
    const detail = getWorkPackage(packageId);
    if (!detail) throw new Error(`package "${packageId}" not found after reconcile`);

    const counts = detail.counts;
    const projectPath = detail.projectPath ?? "";
    const discoveredGates = projectPath ? discoverRepoGates(projectPath) : [];
    const gatesDiscovered = discoveredGates.map((g) => g.name);

    // Watch profile: observe state only — no item creation, no gate execution.
    if (!strategy.allowsItemCreation) {
      const runningItems = detail.items.filter((i) => i.status === "running");
      const runningCount = runningItems.length;
      // Items in running state with no linked task cannot make progress — flag as stuck.
      const stuckItems = runningItems
        .filter((i) => i.createdTaskId === null)
        .map((i) => ({ id: i.id, title: i.title, reason: "no_task_linked" as const }));
      const watchState = classifyPassState({ counts, blockedItemCount: 0 });
      const watchEvidence: Record<string, unknown> = {
        counts,
        state: watchState,
        externalChecks: [],
        loopMode: loop.mode,
        passIndex: newPassCount,
        gatesDiscovered,
        archivedCount: detail.items.filter((i) => i.status === "archived").length,
        archivedItems: detail.items.filter((i) => i.status === "archived").map((i) => ({ id: i.id, title: i.title })),
        runningCount,
        blockedItemCount: 0,
        failedItems: detail.items.filter((i) => i.status === "failed").map((i) => ({ id: i.id, title: i.title, blocker: i.blocker })),
        reviewItems: detail.items.filter((i) => i.status === "review").map((i) => ({ id: i.id, title: i.title })),
        stuckItems,
      };
      // Keep watching while there is active work; stop only when nothing to observe.
      const hasActiveWork = strategy.continueIfRunning && (runningCount > 0 || (counts.ready ?? 0) > 0);
      const watchStop = hasActiveWork ? null : "no_active_items_to_watch";
      const watchSummary = buildSummary(counts, 0, watchStop);
      const completedWatchPass = completePass(pass.id, {
        status: "completed",
        summary: watchSummary,
        evidence: watchEvidence,
        createdItemIds: [],
        stopReason: watchStop,
      });
      const watchStopped = watchStop !== null;
      const nextWatchStatus: LoopStatus = watchStopped
        ? "stopped"
        : loop.mode === "fixed" ? "active" : "idle";
      const nextWatchRunAt = computeNextRunAt(loop, watchStopped);
      updateLoopAfterPass(loop.id, newPassCount, nextWatchStatus, watchStop, nextWatchRunAt);
      return { loop: getLoop(packageId)!, pass: completedWatchPass, createdItemIds: [] };
    }

    // Release profile: require gates to be present.
    if (strategy.requiresGates && discoveredGates.length === 0) {
      const releaseStop = "release_gate_missing";
      const completedReleaseFail = completePass(pass.id, {
        status: "failed",
        summary: null,
        evidence: { counts, gatesDiscovered, loopMode: loop.mode, passIndex: newPassCount },
        createdItemIds: [],
        stopReason: releaseStop,
      });
      updateLoopAfterPass(loop.id, newPassCount, "stopped", releaseStop, null);
      return { loop: getLoop(packageId)!, pass: completedReleaseFail, createdItemIds: [] };
    }

    const failedItems = detail.items.filter((i) => i.status === "failed");
    const reviewItems = detail.items.filter((i) => i.status === "review");
    const runningItems = detail.items.filter((i) => i.status === "running");
    const archivedItems = detail.items.filter((i) => i.status === "archived");
    const archivedCount = archivedItems.length;
    const cancelledHighRisk = detail.items.filter((i) => i.status === "cancelled" && i.risk === "high");
    const blockedItemCount = detail.items.filter(
      (i) => !["done", "cancelled", "failed", "held", "archived"].includes(i.status) && i.blocker !== null,
    ).length;
    const state = classifyPassState({ counts, blockedItemCount });

    const taskOutputs = gatherTaskOutputs([...failedItems, ...reviewItems]);
    const gitEvidence = gatherGitEvidence(projectPath);
    const releaseArtifacts = strategy.gatherReleaseArtifacts && projectPath
      ? gatherReleaseArtifactEvidence(projectPath)
      : null;

    const gates = projectPath ? runRepoGates(projectPath, discoveredGates) : [];
    const failedGates = gates.filter((g) => !g.passed);

    // personal_admin: count pending approvals (held items in this flight)
    const pendingApprovals = loop.profile === "personal_admin"
      ? detail.items.filter((i) => i.status === "held").length
      : undefined;

    const goalFlight = loop.profile === "goal_quality"
      ? (detail.intake?.goalFlight as { goal?: string; successCriteria?: string[] } | undefined) ?? null
      : null;
    const criteriaStatus =
      goalFlight?.successCriteria?.length
        ? classifyCriteria(goalFlight.successCriteria, detail.items)
        : null;

    const evidence: Record<string, unknown> = {
      counts,
      state,
      failedItems: failedItems.map((i) => ({
        id: i.id,
        title: i.title,
        blocker: i.blocker,
        taskOutput: taskOutputs[i.id] ?? null,
      })),
      reviewItems: reviewItems.map((i) => ({
        id: i.id,
        title: i.title,
        taskOutput: taskOutputs[i.id] ?? null,
      })),
      archivedCount,
      archivedItems: archivedItems.map((i) => ({ id: i.id, title: i.title })),
      cancelledHighRiskCount: cancelledHighRisk.length,
      cancelledHighRiskItems: cancelledHighRisk.map((i) => ({ id: i.id, title: i.title })),
      runningCount: runningItems.length,
      blockedItemCount,
      loopMode: loop.mode,
      passIndex: newPassCount,
      gatesDiscovered,
      ...(pendingApprovals !== undefined ? { pendingApprovals } : {}),
      ...(goalFlight ? { goal: goalFlight.goal, successCriteria: goalFlight.successCriteria ?? [] } : {}),
      ...(criteriaStatus ? { criteriaStatus } : {}),
      ...(releaseArtifacts ? { releaseArtifacts } : {}),
      ...(gitEvidence ? { git: gitEvidence } : {}),
      ...(gates.length > 0 ? { gates } : {}),
    };

    const createdItemIds: string[] = [];
    const maxPos = detail.items.reduce((m, i) => Math.max(m, i.position), -1);
    let nextPos = maxPos + 1;

    if (loop.autoCreateItems && (failedItems.length > 0 || reviewItems.length > 0)) {
      const sources = [...failedItems, ...reviewItems].map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status as "failed" | "review",
        risk: item.risk,
        blocker: item.blocker,
        taskOutput: taskOutputs[item.id] ?? null,
      }));
      const created = createFollowUpItems({
        packageId,
        sources,
        startPosition: nextPos,
        autoReadySafeItems: loop.autoReadySafeItems,
        forceDraft: strategy.forceDraftItems || undefined,
        forceHeld: strategy.forceHeldRiskyItems || undefined,
        forceHeldMediumRisk: strategy.forceHeldMediumRisk || undefined,
      });
      createdItemIds.push(...created.map((c) => c.id));
      nextPos += created.length;
    }

    if (loop.autoCreateItems && failedGates.length > 0) {
      const gateItems = createGateFollowUpItems({
        packageId,
        failedGates: failedGates.map((g) => ({
          name: g.name,
          exitCode: g.exitCode,
          output: g.output,
        })),
        startPosition: nextPos,
        autoReadySafeItems: loop.autoReadySafeItems,
      });
      createdItemIds.push(...gateItems.map((c) => c.id));
      nextPos += gateItems.length;
    }

    if (loop.autoCreateItems && criteriaStatus) {
      const unmetCriteria = criteriaStatus
        .filter((c) => c.status === "unmet")
        .map((c) => c.criterion);
      if (unmetCriteria.length > 0) {
        const criterionItems = createCriterionFollowUpItems({
          packageId,
          unmetCriteria,
          startPosition: nextPos,
          autoReadySafeItems: loop.autoReadySafeItems,
        });
        createdItemIds.push(...criterionItems.map((c) => c.id));
        nextPos += criterionItems.length;
      }
    }

    // all_checks_clean requires items all done, all gates passing, AND no new follow-ups created.
    const allItemsDone = detail.items.every((i) => ["done", "cancelled", "archived"].includes(i.status));
    const allTerminal = allItemsDone && failedGates.length === 0 && createdItemIds.length === 0;
    let stopReason: string | null = null;

    if (allTerminal) {
      stopReason = "all_checks_clean";
    } else if (state === "risky") {
      stopReason = "risky_action_held";
    } else if (state === "blocked") {
      stopReason = "waiting_for_approval";
    } else if (newPassCount >= loop.maxPasses) {
      stopReason = "max_passes_reached";
    } else if (state === "clean" && createdItemIds.length === 0) {
      stopReason = "no_actionable_follow_up";
    }

    const summary = buildSummary(counts, createdItemIds.length, stopReason, archivedCount, cancelledHighRisk.length, criteriaStatus);
    const completedPass = completePass(pass.id, {
      status: "completed",
      summary,
      evidence,
      createdItemIds,
      stopReason,
    });

    const stopped = stopReason !== null;
    const nextStatus: LoopStatus = stopped
      ? "stopped"
      : loop.mode === "fixed"
        ? "active"
        : "idle";
    const nextRunAt = computeNextRunAt(loop, stopped);
    updateLoopAfterPass(loop.id, newPassCount, nextStatus, stopReason, nextRunAt);

    return { loop: getLoop(packageId)!, pass: completedPass, createdItemIds };
  } catch (err) {
    completePass(pass.id, {
      status: "failed",
      summary: null,
      evidence: {},
      createdItemIds: [],
      stopReason: null,
      error: err instanceof Error ? err.message : String(err),
    });
    getDb()
      .prepare("UPDATE flight_loops SET status = 'idle', updatedAt = ? WHERE _id = ?")
      .run(new Date().toISOString(), loop.id);
    throw err;
  }
}
