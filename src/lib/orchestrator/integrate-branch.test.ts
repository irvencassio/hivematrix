import test from "node:test";
import assert from "node:assert/strict";

import {
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
} = {}): { deps: IntegrateDeps; calls: string[][] } {
  const calls: string[][] = [];
  const {
    ahead = 2, behind = 0, dirty = "", branchExists = true,
    verifyOk = true, verifyOutput = "", gitThrowsOn,
  } = over;

  const deps: IntegrateDeps = {
    git: async (_repo, args) => {
      calls.push(args);
      if (gitThrowsOn && args[0] === gitThrowsOn) throw new Error(`git ${gitThrowsOn} exploded`);
      if (args[0] === "rev-parse") {
        if (!branchExists) throw new Error("unknown revision");
        return "abc123";
      }
      if (args[0] === "status") return dirty;
      if (args[0] === "rev-list") return String(args[2].includes("main..") ? ahead : behind);
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

test("verify_failed: a branch that does not typecheck never reaches main", async () => {
  const { deps, calls } = fakeDeps({ verifyOk: false, verifyOutput: "error TS2345: nope" });
  const r = await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.equal(r.status, "verify_failed");
  assert.match(r.detail ?? "", /TS2345/);
  assert.equal(ran(calls, "checkout"), false, "must not touch main when verification fails");
  assert.equal(ran(calls, "merge"), false);
});

test("verify runs BEFORE checkout, so a failing branch cannot leave main checked out", async () => {
  const order: string[] = [];
  const deps: IntegrateDeps = {
    git: async (_r, args) => {
      order.push("git:" + args[0]);
      if (args[0] === "rev-parse") return "abc";
      if (args[0] === "status") return "";
      if (args[0] === "rev-list") return args[2].includes("main..") ? "1" : "0";
      return "";
    },
    verify: async () => { order.push("verify"); return { ok: true, output: "" }; },
  };
  await integrateTaskBranch(REPO, "hive/task-1", deps);
  assert.ok(order.indexOf("verify") < order.indexOf("git:checkout"), "verify must precede checkout");
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
      if (args[0] === "rev-parse") { events.push("enter" + id); return "abc"; }
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
