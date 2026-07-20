/**
 * Integrate a task branch into a repo's default branch — the deterministic
 * counterpart to scripts/integrate-task-branch.sh, callable from the console.
 *
 * Same discipline as that script, on purpose: fast-forward ONLY, or refuse.
 * A merge needs the intent of BOTH sides and an agent authored only one, so
 * integration here is mechanical — it either fast-forwards cleanly or stops
 * and hands the decision back to the operator. There is deliberately no
 * conflict resolution, no rebase, no -X strategy. The one thing this adds over
 * the shell script is an optional `git push origin <base>` after a clean
 * fast-forward, so the operator can take a branch all the way to remote main
 * from one guarded, confirmed click.
 *
 * Every mutation is guarded: refuse a dirty working tree (it may hold another
 * task's uncommitted work — the exact way work got clobbered on 2026-07-18),
 * refuse a branch that is behind (not fast-forwardable), refuse a branch with
 * nothing to integrate.
 */

import { execFileSync } from "child_process";

/** Only offer/act on branches that look like task/feature work, never main itself. */
const BRANCH_PREFIXES = /^(hive\/|fix\/|feat\/)/;

interface GitError extends Error {
  stdout?: string;
  stderr?: string;
}

function git(cwd: string, args: string[], timeoutMs = 30_000): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** Truthy git output when the ref exists; throws (nonzero exit) when it doesn't. */
function refExists(cwd: string, ref: string): boolean {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

function gitErrorText(err: unknown): string {
  const e = err as GitError;
  const stderr = (e?.stderr ?? "").toString().trim();
  return stderr || (e instanceof Error ? e.message : String(err));
}

/** The repo's integration target: main if present, else master, else main. */
export function defaultBranch(cwd: string): string {
  if (refExists(cwd, "main")) return "main";
  if (refExists(cwd, "master")) return "master";
  return "main";
}

export interface IntegratableBranch {
  branch: string;
  ahead: number;
  behind: number;
  /** ahead > 0 and behind === 0 — a clean fast-forward is possible. */
  ffOk: boolean;
  subject: string;
}

export interface BranchListing {
  base: string;
  branches: IntegratableBranch[];
}

/**
 * List local hive/*, fix/*, feat/* branches that are ahead of the repo's
 * default branch, with ahead/behind counts. Read-only. Branches that are
 * behind (not fast-forwardable) are still listed, tagged ffOk:false, so the UI
 * can show them greyed with a "needs rebase (operator)" note. Throws only if
 * `cwd` is not a git repo.
 */
export function listIntegratableBranches(cwd: string): BranchListing {
  const base = defaultBranch(cwd);
  const raw = git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  const branches: IntegratableBranch[] = [];
  for (const b of raw.split("\n").map((s) => s.trim()).filter(Boolean)) {
    if (b === base) continue;
    if (!BRANCH_PREFIXES.test(b)) continue;
    let ahead: number;
    let behind: number;
    try {
      // `base...b` with --left-right --count → "<behind> <ahead>": left =
      // commits in base not b (behind), right = commits in b not base (ahead).
      const counts = git(cwd, ["rev-list", "--left-right", "--count", `${base}...${b}`]).trim();
      const [bh, ah] = counts.split(/\s+/).map((n) => parseInt(n, 10) || 0);
      behind = bh;
      ahead = ah;
    } catch {
      continue; // unrelated history / missing base — skip rather than crash the list
    }
    if (ahead <= 0) continue;
    let subject = "";
    try {
      subject = git(cwd, ["log", "-1", "--format=%s", b]).trim();
    } catch {
      /* best-effort */
    }
    branches.push({ branch: b, ahead, behind, ffOk: behind === 0, subject });
  }
  // Fast-forwardable first (the ones a click can actually integrate), then name.
  branches.sort((a, b) => Number(b.ffOk) - Number(a.ffOk) || a.branch.localeCompare(b.branch));
  return { base, branches };
}

export interface IntegrateResult {
  ok: boolean;
  ffOk: boolean;
  pushed: boolean;
  base: string;
  branch: string;
  output: string;
  error?: string;
}

/**
 * Fast-forward `branch` into the repo's default branch, then (optionally) push
 * that branch to origin. Refuses a dirty tree, a non-existent branch, a branch
 * with nothing to integrate, or a branch that is behind (not fast-forwardable)
 * — each with a plain-English reason. A push failure after a clean local
 * fast-forward returns ok:true, pushed:false with the push error, so the
 * operator knows the merge landed locally and only the remote step needs a
 * retry. Never throws.
 */
export function integrateBranch(
  cwd: string,
  branch: string,
  opts: { push: boolean },
): IntegrateResult {
  const base = defaultBranch(cwd);
  const fail = (error: string, output = ""): IntegrateResult => ({
    ok: false, ffOk: false, pushed: false, base, branch, output, error,
  });

  if (!BRANCH_PREFIXES.test(branch)) {
    return fail(`refusing to integrate "${branch}": only hive/*, fix/*, feat/* branches`);
  }
  if (branch === base) return fail(`refusing to integrate ${base} into itself`);
  if (!refExists(cwd, branch)) return fail(`no such branch: ${branch}`);

  let dirty: string;
  try {
    dirty = git(cwd, ["status", "--porcelain"]).trim();
  } catch (err) {
    return fail(`not a git repo or git failed: ${gitErrorText(err)}`);
  }
  if (dirty) {
    return fail("working tree is dirty — commit or stash first (it may hold another task's work)");
  }

  let ahead: number;
  let behind: number;
  try {
    ahead = parseInt(git(cwd, ["rev-list", "--count", `${base}..${branch}`]).trim(), 10) || 0;
    behind = parseInt(git(cwd, ["rev-list", "--count", `${branch}..${base}`]).trim(), 10) || 0;
  } catch (err) {
    return fail(`could not compare ${branch} to ${base}: ${gitErrorText(err)}`);
  }
  if (ahead <= 0) return fail(`nothing to integrate: ${branch} has no commits ahead of ${base}`);
  if (behind > 0) {
    return fail(
      `not fast-forwardable: ${branch} is ${behind} commit(s) behind ${base}. ` +
      `Rebasing is the operator's call — this will not rebase or resolve conflicts.`,
    );
  }

  const log: string[] = [];
  try {
    log.push(git(cwd, ["checkout", base]));
    log.push(git(cwd, ["merge", "--ff-only", branch]));
  } catch (err) {
    return fail(`fast-forward merge failed: ${gitErrorText(err)}`, log.join("\n").trim());
  }

  let pushed = false;
  if (opts.push) {
    try {
      log.push(git(cwd, ["push", "origin", base], 90_000));
      pushed = true;
    } catch (err) {
      return {
        ok: true, ffOk: true, pushed: false, base, branch,
        output: log.join("\n").trim(),
        error: `integrated ${branch} into ${base} locally, but push failed: ${gitErrorText(err)}`,
      };
    }
  }

  return { ok: true, ffOk: true, pushed, base, branch, output: log.join("\n").trim() };
}
