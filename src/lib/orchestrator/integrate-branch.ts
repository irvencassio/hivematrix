/**
 * Integrating a finished task's worktree branch back into main.
 *
 * Per-task worktrees (worktree.ts) isolate a task's edits onto
 * `hive/task-<id>` so concurrent agents cannot destroy each other's work in the
 * shared checkout. The cost is that every finished task leaves a branch behind:
 * `removeTaskWorktree` drops the checkout directory but deliberately keeps the
 * commits. Before this module the only way back was running
 * `scripts/integrate-task-branch.sh` by hand, which nothing called.
 *
 * Three deliberate constraints, each of which exists because the obvious
 * alternative is how agent-authored merges go wrong:
 *
 *  1. FAST-FORWARD ONLY. A real merge needs the intent of both sides and an
 *     agent authored one. A diverged branch stops and asks. No rebase, no
 *     conflict resolution, no -X strategy. Same contract as the shell script.
 *
 *  2. SERIALIZED per repo. Integration does `git checkout main`, which mutates
 *     the shared checkout. Two tasks finishing together would race and corrupt
 *     each other — the exact failure worktrees exist to prevent. Runs queue.
 *
 *  3. TYPECHECKED FIRST. The verification badge on the board is decorative:
 *     `nextStatus` never consults it, and the smoke gate is Python-only, so for
 *     TypeScript work every task reads "unverified". Merging on the agent's own
 *     say-so is worse than the manual step it replaces, so the branch must
 *     typecheck against its own tree before it lands.
 *
 * A refusal is not an error. Every non-integrated outcome leaves the branch and
 * the task exactly as they were, so the operator can look and decide.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const execFileAsync = promisify(execFile);

/** Wall-clock ceiling for the pre-merge typecheck. */
const VERIFY_TIMEOUT_MS = 180_000;
const GIT_TIMEOUT_MS = 30_000;

export type IntegrationStatus =
  | "integrated"
  | "no_branch"
  | "nothing_to_integrate"
  | "dirty_tree"
  | "not_fast_forward"
  | "verify_failed"
  | "error";

export interface IntegrationResult {
  status: IntegrationStatus;
  branch: string | null;
  /** Commits the branch is ahead of main. */
  ahead?: number;
  /** Commits main is ahead of the branch (why a fast-forward is impossible). */
  behind?: number;
  /** Operator-facing explanation. Always set for a non-integrated outcome. */
  detail?: string;
}

export interface IntegrateDeps {
  /** Run a git subcommand in `repoPath`, resolving with stdout. */
  git: (repoPath: string, args: string[]) => Promise<string>;
  /** Typecheck the repo; resolve `{ ok, output }` rather than throwing. */
  verify: (repoPath: string) => Promise<{ ok: boolean; output: string }>;
}

async function realGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Pick the pre-merge check for THIS repo.
 *
 * This used to be hardcoded to `npm run typecheck`, which baked a HiveMatrix
 * shape into a general mechanism: any repo that isn't a Node project — a Swift
 * app, a static site — could never pass, so auto-integration failed and rolled
 * back on every single merge. The repo has to say what verifies it.
 *
 * Discovery, most specific first. Returns null when the repo declares nothing.
 */
export function resolveVerifyCommand(
  repoPath: string,
  deps: { exists: (p: string) => boolean; readJson: (p: string) => Record<string, unknown> | null } = {
    exists: existsSync,
    readJson: (p) => { try { return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>; } catch { return null; } },
  },
): { cmd: string; args: string[]; label: string } | null {
  const pkgPath = join(repoPath, "package.json");
  if (deps.exists(pkgPath)) {
    const pkg = deps.readJson(pkgPath);
    const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>;
    // An explicit `typecheck` script is the repo saying "this is how you check me".
    if (typeof scripts.typecheck === "string") return { cmd: "npm", args: ["run", "typecheck"], label: "npm run typecheck" };
    // `build` is the next-best honest signal that the tree compiles.
    if (typeof scripts.build === "string") return { cmd: "npm", args: ["run", "build"], label: "npm run build" };
  }
  // Swift package (e.g. a lane app) — `swift build` is a real compile check.
  if (deps.exists(join(repoPath, "Package.swift"))) {
    return { cmd: "swift", args: ["build"], label: "swift build" };
  }
  return null;
}

async function realVerify(repoPath: string): Promise<{ ok: boolean; output: string }> {
  const verifier = resolveVerifyCommand(repoPath);
  if (!verifier) {
    // Nothing to run. Refusing forever would make auto-integration useless for
    // every non-Node repo and just move the merge to the operator's hands, where
    // it has no gate either — so integrate, but say plainly that nothing was
    // checked rather than reporting a pass that never happened.
    return { ok: true, output: "NO VERIFIER: this repo declares no typecheck/build script and is not a Swift package, so the merge was NOT verified. Add a `typecheck` script to gate it." };
  }
  try {
    const { stdout, stderr } = await execFileAsync(verifier.cmd, verifier.args, {
      cwd: repoPath,
      timeout: VERIFY_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, output: `${verifier.label}\n${stdout}${stderr}`.trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string; code?: string };
    // A missing toolchain is an environment gap, not broken code — do not fail
    // someone's merge because `swift` isn't on this machine's PATH.
    if (err.code === "ENOENT") {
      return { ok: true, output: `NO VERIFIER: \`${verifier.cmd}\` is not installed, so the merge was NOT verified.` };
    }
    return { ok: false, output: `${verifier.label} failed:\n${`${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || (err.message ?? "verification failed")}` };
  }
}

export const defaultIntegrateDeps: IntegrateDeps = { git: realGit, verify: realVerify };

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * One promise chain per repo path. Integration mutates the shared checkout, so
 * concurrent runs must not interleave. Keyed by repo rather than global so two
 * unrelated projects still integrate in parallel.
 */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(repoPath: string, job: () => Promise<T>): Promise<T> {
  const prior = queues.get(repoPath) ?? Promise.resolve();
  // `.catch` so one failed integration cannot poison the queue for the next.
  const next = prior.catch(() => undefined).then(job);
  queues.set(repoPath, next.catch(() => undefined));
  return next;
}

/** Test seam: drop queued chains so one test's job can't leak into the next. */
export function _resetIntegrationQueuesForTests(): void {
  queues.clear();
}

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

async function runIntegration(
  repoPath: string,
  branch: string | null | undefined,
  deps: IntegrateDeps,
): Promise<IntegrationResult> {
  if (!branch) {
    return { status: "no_branch", branch: null, detail: "This task has no worktree branch — its work went straight to the checked-out branch." };
  }

  try {
    // Branch must exist. A task whose branch was already merged and deleted is
    // a normal, non-alarming outcome, not a failure.
    try {
      await deps.git(repoPath, ["rev-parse", "--verify", "--quiet", branch]);
    } catch {
      return { status: "no_branch", branch, detail: `Branch ${branch} no longer exists — already integrated or deleted.` };
    }

    // Refuse a dirty tree. The shared checkout may hold another task's
    // uncommitted work, and checking out main over it is how that is destroyed.
    const dirty = await deps.git(repoPath, ["status", "--porcelain"]);
    if (dirty) {
      return {
        status: "dirty_tree",
        branch,
        detail: "Working tree has uncommitted changes. Integration was skipped rather than risk overwriting them — commit or stash, then retry.",
      };
    }

    const ahead = Number(await deps.git(repoPath, ["rev-list", "--count", `main..${branch}`])) || 0;
    const behind = Number(await deps.git(repoPath, ["rev-list", "--count", `${branch}..main`])) || 0;

    if (ahead === 0) {
      return { status: "nothing_to_integrate", branch, ahead, behind, detail: `${branch} has no commits that aren't already in main.` };
    }

    if (behind > 0) {
      return {
        status: "not_fast_forward",
        branch,
        ahead,
        behind,
        detail: `${branch} is ${behind} commit(s) behind main, so it cannot fast-forward. This is a human decision: rebase it yourself (git rebase main ${branch}) or merge manually.`,
      };
    }

    // Fast-forward FIRST, then verify, then roll back if it fails.
    //
    // The obvious order — verify, then merge — is wrong and silently so: the
    // verifier runs against the repo's working tree, and before the merge that
    // tree is still main's. It therefore typechecks the wrong code and passes a
    // branch that does not compile. (Caught only by running this against a real
    // repo; a faked `verify` cannot expose it.)
    //
    // Verifying a temporary worktree of the branch is no good either — it has no
    // node_modules, so the typecheck fails for the wrong reason. So: land it,
    // check it, and undo if it is bad. Safe precisely because the merge is
    // fast-forward only, which makes the pre-merge commit an exact ancestor and
    // `reset --hard` an exact inverse. Nothing else can be running concurrently
    // in this repo (see the queue above), so the window is not observable.
    await deps.git(repoPath, ["checkout", "main"]);
    const priorMain = await deps.git(repoPath, ["rev-parse", "HEAD"]);
    await deps.git(repoPath, ["merge", "--ff-only", branch]);

    const verified = await deps.verify(repoPath);
    if (!verified.ok) {
      try {
        await deps.git(repoPath, ["reset", "--hard", priorMain]);
      } catch (e) {
        // A failed rollback is the one genuinely dangerous state here: main is
        // left holding code that does not compile. Say so explicitly rather
        // than reporting a plain verification failure.
        return {
          status: "error",
          branch,
          ahead,
          behind,
          detail: `${branch} failed typecheck AND could not be rolled back — main may be left at the merged commit. Reset it manually to ${priorMain}. Rollback error: ${e instanceof Error ? e.message : e}`,
        };
      }
      return {
        status: "verify_failed",
        branch,
        ahead,
        behind,
        detail: `Typecheck failed, so ${branch} was not merged (main rolled back to ${priorMain.slice(0, 8)}):\n${verified.output.slice(-2000)}`,
      };
    }

    // Land it on the remote too. A branch that "merged to main" but only locally
    // is a trap: the work reads as shipped while existing on exactly one disk.
    // The merge already passed typecheck, so a FAILED PUSH IS NOT A REASON TO
    // ROLL BACK — main is legitimately ahead; we just say so loudly instead of
    // reporting success and leaving the operator to discover it later.
    let pushNote = "";
    try {
      const remotes = (await deps.git(repoPath, ["remote"])).trim();
      if (remotes) {
        await deps.git(repoPath, ["push", "origin", "main"]);
        pushNote = " Pushed to origin/main.";
      } else {
        pushNote = " No git remote is configured, so nothing was pushed.";
      }
    } catch (e) {
      pushNote = ` NOTE: merged into main locally but the PUSH FAILED — main is ahead of origin and the work is not on the remote yet. Push it manually. (${e instanceof Error ? e.message : e})`;
    }

    return { status: "integrated", branch, ahead, behind, detail: `Fast-forwarded main by ${ahead} commit(s) from ${branch}.${pushNote}` };
  } catch (e) {
    return { status: "error", branch, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Integrate `branch` into main, serialized against other integrations in the
 * same repo. Never throws — every failure mode is a returned status so the
 * caller can surface it on the task instead of losing it in a 500.
 */
export function integrateTaskBranch(
  repoPath: string,
  branch: string | null | undefined,
  deps: IntegrateDeps = defaultIntegrateDeps,
): Promise<IntegrationResult> {
  if (!repoPath) return Promise.resolve({ status: "error", branch: branch ?? null, detail: "No project path on this task." });
  return enqueue(repoPath, () => runIntegration(repoPath, branch, deps));
}

/** True for outcomes where the operator still has a decision to make. */
export function needsOperatorAttention(status: IntegrationStatus): boolean {
  return status === "not_fast_forward" || status === "verify_failed" || status === "dirty_tree" || status === "error";
}
