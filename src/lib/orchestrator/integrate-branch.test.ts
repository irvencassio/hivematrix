import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveVerifyCommand,
  integrateTaskBranch,
  needsOperatorAttention,
  _resetIntegrationQueuesForTests,
  type IntegrateDeps,
} from "./integrate-branch";

const REPO = "/repo";

/**
 * Fake git. `counts` supplies rev-list answers as [ahead, behind]; `dirty`
 * drives `status --porcelain`. Records every subcommand so tests can assert
 * that a refusal never reached `checkout`/`merge`.
 */
function fakeDeps(over: {
  ahead?: number;
  behind?: number;
  dirty?: string;
  branchExists?: boolean;
  verifyOk?: boolean;
  verifyOutput?: string;
  gitThrowsOn?: string;
  /** `git remote` output — "" models a repo with no remote configured. */
  remotes?: string;
  /** Make `git push` fail, to prove a verified merge is NOT rolled back. */
  pushThrows?: boolean;
} = {}): { deps: IntegrateDeps; calls: string[][] } {
  const calls: string[][] = [];
  const {
    ahead = 2, behind = 0, dirty = "", branchExists = true,
    verifyOk = true, verifyOutput = "", gitThrowsOn,
    remotes = "origin", pushThrows = false,
  } = over;

  const deps: IntegrateDeps = {
    git: async (_repo, args) => {
      calls.push(args);
      if (gitThrowsOn && args[0] === gitThrowsOn) throw new Error(`git ${gitThrowsOn} exploded`);
      if (args[0] === "rev-parse") {
        // `rev-parse HEAD` captures the pre-merge commit for rollback; the
        // other form is the branch-exists probe.
        if (args[1] === "HEAD") return "PRIOR_MAIN_SHA";
        if (!branchExists) throw new Error("unknown revision");
        return "abc123";
      }
      if (args[0] === "status") return dirty;
      if (args[0] === "rev-list") return String(args[2].includes("main..") ? ahead : behind);
      if (args[0] === "remote") return remotes;
      if (args[0] === "push") { if (pushThrows) throw new Error("push rejected by remote"); return ""; }
      return "";
    },
    verify: async () => ({ ok: verifyOk, output: verifyOutput }),
  };
  return { deps, calls };
}

const ran = (calls: string[][], sub: string) => calls.some((c) => c[0] === sub);

test.beforeEach(() => _resetIntegrationQueuesForTests());

test("integrated: a clean, ahead-only branch fast-forwards main", async () => {
  const { deps, calls } = fakeDeps({ ahead: 3, behind: 0 });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "integrated");
  assert.equal(r.ahead, 3);
  assert.ok(calls.some((c) => c[0] === "merge" && c[1] === "--ff-only"), "must merge with --ff-only");
});

test("no_branch: a task with no worktree branch is a normal outcome, not an error", async () => {
  const { deps, calls } = fakeDeps();
  const r = await integrateTaskBranch(REPO, null, deps);
  assert.equal(r.status, "no_branch");
  assert.equal(calls.length, 0, "must not shell out at all");
});

test("no_branch: an already-deleted branch does not read as a failure", async () => {
  const { deps } = fakeDeps({ branchExists: false });
  const r = await integrateTaskBranch(REPO, "hive/task-gone", deps);
  assert.equal(r.status, "no_branch");
  assert.match(r.detail ?? "", /already integrated or deleted/);
});

test("dirty_tree: refuses without touching main — another task's work may be uncommitted", async () => {
  const { deps, calls } = fakeDeps({ dirty: " M src/foo.ts" });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "dirty_tree");
  assert.equal(ran(calls, "checkout"), false);
  assert.equal(ran(calls, "merge"), false);
});

test("not_fast_forward: a diverged branch stops and hands the decision back, never rebases", async () => {
  const { deps, calls } = fakeDeps({ ahead: 2, behind: 5 });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "not_fast_forward");
  assert.equal(r.behind, 5);
  assert.equal(ran(calls, "rebase"), false, "must never rebase on its own");
  assert.equal(ran(calls, "merge"), false);
});

test("nothing_to_integrate: a branch with no new commits is not merged", async () => {
  const { deps, calls } = fakeDeps({ ahead: 0 });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "nothing_to_integrate");
  assert.equal(ran(calls, "merge"), false);
});

test("verify_failed: a branch that does not typecheck is rolled back out of main", async () => {
  const { deps, calls } = fakeDeps({ verifyOk: false, verifyOutput: "error TS2345: nope" });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "verify_failed");
  assert.match(r.detail ?? "", /TS2345/);
  const reset = calls.find((c) => c[0] === "reset");
  assert.ok(reset, "a failed verification must reset main");
  assert.deepEqual(reset, ["reset", "--hard", "PRIOR_MAIN_SHA"], "must reset to the exact pre-merge commit");
});

/**
 * Regression: verification must observe the BRANCH's tree, not main's.
 *
 * The natural ordering — verify, then merge — silently passes broken branches,
 * because before the merge the working tree is still main's, so the typecheck
 * examines the wrong code entirely. Found by running this against a real repo;
 * a faked verify reports whatever it is told and cannot catch it.
 */
test("verify runs AFTER the fast-forward, so it inspects the branch's tree and not main's", async () => {
  const order: string[] = [];
  const deps: IntegrateDeps = {
    git: async (_r, args) => {
      order.push("git:" + args[0]);
      if (args[0] === "rev-parse") return args[1] === "HEAD" ? "PRIOR" : "abc";
      if (args[0] === "status") return "";
      if (args[0] === "rev-list") return args[2].includes("main..") ? "1" : "0";
      return "";
    },
    verify: async () => { order.push("verify"); return { ok: true, output: "" }; },
  };
  await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.ok(order.indexOf("git:merge") < order.indexOf("verify"), "merge must precede verify");
  assert.ok(order.indexOf("verify") > -1, "verify must actually run");
});

test("error: a failed ROLLBACK is reported as such — main may hold code that does not compile", async () => {
  const { deps } = fakeDeps({ verifyOk: false, gitThrowsOn: "reset" });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "error");
  assert.match(r.detail ?? "", /could not be rolled back/);
  assert.match(r.detail ?? "", /PRIOR_MAIN_SHA/, "must name the commit to reset to by hand");
});

test("error: a git failure is returned, never thrown — the caller must not 500", async () => {
  const { deps } = fakeDeps({ gitThrowsOn: "merge" });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "error");
  assert.match(r.detail ?? "", /exploded/);
});

test("serialized: concurrent integrations in one repo never interleave", async () => {
  // Each job records enter/exit. Interleaving would produce E1,E2,X1,X2.
  const events: string[] = [];
  const mkDeps = (id: string): IntegrateDeps => ({
    git: async (_r, args) => {
      // Only the branch-exists probe marks entry; `rev-parse HEAD` is the
      // separate pre-merge rollback capture and would double-count.
      if (args[0] === "rev-parse" && args[1] !== "HEAD") { events.push("enter" + id); return "abc"; }
      if (args[0] === "rev-parse") return "PRIOR";
      if (args[0] === "status") { await new Promise((r) => setTimeout(r, 10)); return ""; }
      if (args[0] === "rev-list") return args[2].includes("main..") ? "1" : "0";
      if (args[0] === "merge") events.push("exit" + id);
      return "";
    },
    verify: async () => ({ ok: true, output: "" }),
  });

  await Promise.all([
    integrateTaskBranch(REPO, "hive/task-A", mkDeps("A")),
    integrateTaskBranch(REPO, "hive/task-B", mkDeps("B")),
  ]);

  assert.equal(events.length, 4);
  assert.equal(events[1].startsWith("exit"), true, `expected enter/exit pairs, got ${events.join(",")}`);
  assert.equal(events[3].startsWith("exit"), true, `expected enter/exit pairs, got ${events.join(",")}`);
});

test("serialized: a failed integration does not poison the queue for the next one", async () => {
  const bad = fakeDeps({ gitThrowsOn: "status" });
  const good = fakeDeps({ ahead: 1 });
  const [first, second] = await Promise.all([
    integrateTaskBranch(REPO, "hive/task-A", bad.deps),
    integrateTaskBranch(REPO, "hive/task-B", good.deps),
  ]);
  assert.equal(first.status, "error");
  assert.equal(second.status, "integrated", "a prior failure must not block later integrations");
});

test("different repos integrate independently", async () => {
  const a = fakeDeps({ ahead: 1 });
  const b = fakeDeps({ ahead: 1 });
  const [r1, r2] = await Promise.all([
    integrateTaskBranch("/repo-a", "hive/task-A", a.deps),
    integrateTaskBranch("/repo-b", "hive/task-B", b.deps),
  ]);
  assert.equal(r1.status, "integrated");
  assert.equal(r2.status, "integrated");
});

test("needsOperatorAttention: only the outcomes with a decision left to make", () => {
  assert.equal(needsOperatorAttention("not_fast_forward"), true);
  assert.equal(needsOperatorAttention("verify_failed"), true);
  assert.equal(needsOperatorAttention("dirty_tree"), true);
  assert.equal(needsOperatorAttention("error"), true);
  assert.equal(needsOperatorAttention("integrated"), false);
  assert.equal(needsOperatorAttention("no_branch"), false);
  assert.equal(needsOperatorAttention("nothing_to_integrate"), false);
});

test("integrated: a verified merge is pushed to origin/main, not just landed locally", async () => {
  // A branch that "merged to main" but only locally is a trap — the work reads
  // as shipped while living on exactly one disk. Auto-integration has to push.
  const { deps, calls } = fakeDeps({ ahead: 2 });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "integrated");
  assert.ok(calls.some((c) => c[0] === "push" && c[1] === "origin" && c[2] === "main"), "must push origin main");
  assert.match(r.detail ?? "", /Pushed to origin\/main/);
  // Order matters: never push something that hasn't merged.
  const mergeAt = calls.findIndex((c) => c[0] === "merge");
  const pushAt = calls.findIndex((c) => c[0] === "push");
  assert.ok(mergeAt !== -1 && pushAt > mergeAt, "push must come after the fast-forward");
});

test("a FAILED push does not roll back an already-verified merge — it reports main is unpushed", async () => {
  // The merge passed typecheck; the network did not. Rolling main back here
  // would throw away good, verified work for a transient failure. Report loudly
  // instead, so the operator knows main is ahead of origin.
  const { deps, calls } = fakeDeps({ ahead: 2, pushThrows: true });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "integrated", "still integrated — the merge itself was good");
  assert.match(r.detail ?? "", /PUSH FAILED/);
  assert.match(r.detail ?? "", /not on the remote/);
  assert.ok(!calls.some((c) => c[0] === "reset"), "must NOT roll the verified merge back");
});

test("a repo with no remote integrates and says nothing was pushed, rather than erroring", async () => {
  const { deps, calls } = fakeDeps({ ahead: 1, remotes: "" });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "integrated");
  assert.ok(!calls.some((c) => c[0] === "push"), "nothing to push to");
  assert.match(r.detail ?? "", /No git remote/);
});

test("a failed typecheck still rolls back and never pushes", async () => {
  // Guard the interaction: the push must sit behind the verify gate, so broken
  // code can never reach origin.
  const { deps, calls } = fakeDeps({ ahead: 2, verifyOk: false, verifyOutput: "TS1005" });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "verify_failed");
  assert.ok(calls.some((c) => c[0] === "reset"), "rolls main back");
  assert.ok(!calls.some((c) => c[0] === "push"), "must never push unverified code");
});


// --- verifier discovery ------------------------------------------------------
// Regression 2026-07-22: the pre-merge check was hardcoded to `npm run
// typecheck`, which baked a HiveMatrix shape into a general mechanism. Any repo
// that isn't a Node project — a Swift app, an Xcode project, a static site —
// could never pass, so auto-integration failed and rolled back on EVERY merge
// there. The repo has to declare what verifies it.

const fakeFs = (files: Record<string, unknown>) => ({
  exists: (p: string) => p in files,
  readJson: (p: string) => (files[p] ?? null) as Record<string, unknown> | null,
});

test("verifier discovery: an explicit typecheck script wins", () => {
  const v = resolveVerifyCommand("/r", fakeFs({ "/r/package.json": { scripts: { typecheck: "tsc", build: "vite" } } }));
  assert.equal(v?.label, "npm run typecheck");
});

test("verifier discovery: falls back to build, then to a Swift package", () => {
  assert.equal(
    resolveVerifyCommand("/r", fakeFs({ "/r/package.json": { scripts: { build: "vite" } } }))?.label,
    "npm run build",
  );
  assert.equal(
    resolveVerifyCommand("/r", fakeFs({ "/r/Package.swift": true }))?.label,
    "swift build",
    "a Swift app must be verifiable — it could never merge before",
  );
});

test("verifier discovery: a repo declaring nothing returns null, it does not pretend npm works", () => {
  assert.equal(resolveVerifyCommand("/r", fakeFs({})), null);
  // package.json with no usable script is still nothing to run.
  assert.equal(resolveVerifyCommand("/r", fakeFs({ "/r/package.json": { scripts: { test: "node --test" } } })), null);
});

test("a repo with no verifier INTEGRATES, and the detail says it was not verified", async () => {
  // Refusing forever would make auto-integration useless for every non-Node repo
  // and just move the merge to the operator, where it has no gate either. But it
  // must never read as a pass that happened.
  const { deps, calls } = fakeDeps({ ahead: 2 });
  const noVerifier: IntegrateDeps = {
    git: deps.git,
    verify: async () => ({ ok: true, output: "NO VERIFIER: this repo declares no typecheck/build script and is not a Swift package, so the merge was NOT verified." }),
  };
  const r = await integrateTaskBranch(REPO, "hive/task-1", noVerifier);
  assert.equal(r.status, "integrated");
  assert.ok(!calls.some((c) => c[0] === "reset"), "must not roll back for lack of a verifier");
});
