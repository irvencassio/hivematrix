import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  taskWorktreesEnabled,
  createTaskWorktree,
  removeTaskWorktree,
  isTaskWorktreeDir,
} from "./worktree";

function initTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hive-wt-test-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "test@hivematrix.local"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "Hive Test"]);
  writeFileSync(join(dir, "README.md"), "test repo\n");
  execFileSync("git", ["-C", dir, "add", "README.md"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
  return dir;
}

test("taskWorktreesEnabled defaults to false with no env override and no config flag set", () => {
  const prev = process.env.HIVEMATRIX_TASK_WORKTREES;
  const prevHome = process.env.HOME;
  delete process.env.HIVEMATRIX_TASK_WORKTREES;
  // Isolate HOME so this reads an EMPTY config dir rather than the developer's
  // real ~/.hivematrix/config.json. It used to read the real one, on the
  // assumption that "no machine in the wild has ever set features.taskWorktrees"
  // — which stopped being true the moment the flag was legitimately turned on,
  // and then failed on the operator's own machine for doing the intended thing.
  // A default-value test must not depend on local state it does not control.
  const tmpHome = mkdtempSync(join(tmpdir(), "hive-wt-home-"));
  process.env.HOME = tmpHome;
  try {
    assert.equal(taskWorktreesEnabled(), false);
  } finally {
    if (prev !== undefined) process.env.HIVEMATRIX_TASK_WORKTREES = prev;
    if (prevHome !== undefined) process.env.HOME = prevHome;
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("taskWorktreesEnabled reads the env var override", () => {
  const prev = process.env.HIVEMATRIX_TASK_WORKTREES;
  process.env.HIVEMATRIX_TASK_WORKTREES = "1";
  try {
    assert.equal(taskWorktreesEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.HIVEMATRIX_TASK_WORKTREES;
    else process.env.HIVEMATRIX_TASK_WORKTREES = prev;
  }
});

test("taskWorktreesEnabled never throws even with a garbage env value", () => {
  const prev = process.env.HIVEMATRIX_TASK_WORKTREES;
  const prevHome = process.env.HOME;
  process.env.HIVEMATRIX_TASK_WORKTREES = "yes-please"; // not the literal "1"
  // Isolated for the same reason as the default test above: a non-"1" env value
  // falls through to the config file, so without this the assertion is really
  // about the developer's own config rather than the garbage-value handling.
  const tmpHome = mkdtempSync(join(tmpdir(), "hive-wt-home-"));
  process.env.HOME = tmpHome;
  try {
    assert.equal(taskWorktreesEnabled(), false);
  } finally {
    if (prevHome !== undefined) process.env.HOME = prevHome;
    rmSync(tmpHome, { recursive: true, force: true });
    if (prev === undefined) delete process.env.HIVEMATRIX_TASK_WORKTREES;
    else process.env.HIVEMATRIX_TASK_WORKTREES = prev;
  }
});

test("isTaskWorktreeDir recognizes worktree paths", () => {
  assert.equal(isTaskWorktreeDir("/repo/.hive-worktrees/abc123"), true);
  assert.equal(isTaskWorktreeDir("/repo/src/lib"), false);
  assert.equal(isTaskWorktreeDir(""), false);
});

test("createTaskWorktree returns null for a non-git directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-wt-nongit-"));
  try {
    const wt = createTaskWorktree(dir, "not-a-repo-task");
    assert.equal(wt, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createTaskWorktree returns null for missing repoPath/taskId", () => {
  assert.equal(createTaskWorktree("", "task-1"), null);
  assert.equal(createTaskWorktree("/tmp/whatever", ""), null);
});

test("createTaskWorktree + removeTaskWorktree round-trip in a real temp git repo", () => {
  const repo = initTempRepo();
  try {
    const taskId = "test1234567890abcdef0001";
    const wt = createTaskWorktree(repo, taskId);
    assert.ok(wt, "createTaskWorktree should succeed in a real git repo");
    assert.ok(existsSync(wt!.dir), "worktree dir should exist on disk");
    assert.equal(wt!.branch, `hive/task-${taskId}`);
    assert.ok(isTaskWorktreeDir(wt!.dir));

    const list = execFileSync("git", ["-C", repo, "worktree", "list"], { encoding: "utf-8" });
    assert.ok(list.includes(wt!.dir), "git worktree list should include the created dir");

    const branchOut = execFileSync("git", ["-C", repo, "branch", "--list", wt!.branch], { encoding: "utf-8" });
    assert.ok(branchOut.includes(wt!.branch), "branch should exist after create");

    removeTaskWorktree(repo, wt!.dir);
    assert.equal(existsSync(wt!.dir), false, "worktree dir should be gone after remove");

    const listAfter = execFileSync("git", ["-C", repo, "worktree", "list"], { encoding: "utf-8" });
    assert.ok(!listAfter.includes(wt!.dir), "git worktree list should no longer include the removed dir");

    // Branch must survive removal — it holds the task's commits.
    const branchAfter = execFileSync("git", ["-C", repo, "branch", "--list", wt!.branch], { encoding: "utf-8" });
    assert.ok(branchAfter.includes(wt!.branch), "branch should still exist after worktree removal");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("createTaskWorktree falls back to a distinct branch+dir when called twice for the same taskId", () => {
  const repo = initTempRepo();
  try {
    const taskId = "dup-task-id";
    const wt1 = createTaskWorktree(repo, taskId);
    assert.ok(wt1);
    const wt2 = createTaskWorktree(repo, taskId);
    assert.ok(wt2, "second create for the same taskId should still succeed (not clobber the first)");
    assert.notEqual(wt2!.dir, wt1!.dir);
    assert.notEqual(wt2!.branch, wt1!.branch);
    assert.ok(existsSync(wt1!.dir));
    assert.ok(existsSync(wt2!.dir));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("removeTaskWorktree is best-effort and never throws for a bogus dir", () => {
  const repo = initTempRepo();
  try {
    assert.doesNotThrow(() => removeTaskWorktree(repo, join(repo, ".hive-worktrees", "never-created")));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
