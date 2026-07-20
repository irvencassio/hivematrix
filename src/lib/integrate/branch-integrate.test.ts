/**
 * Exercises the integrate guards against REAL temp git repos (no mocks) — the
 * whole point of this module is that it refuses the unsafe cases, so the tests
 * drive git into each state and assert the refusal/allow.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listIntegratableBranches, integrateBranch, defaultBranch } from "./branch-integrate";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

/** A fresh repo with an initial commit on `main`, plus a bare "origin" remote. */
function makeRepo(): { dir: string; origin: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "integ-"));
  const origin = mkdtempSync(join(tmpdir(), "integ-origin-"));
  git(origin, ["init", "--bare", "-b", "main"]);
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "t@t.t"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["remote", "add", "origin", origin]);
  writeFileSync(join(dir, "a.txt"), "1\n");
  git(dir, ["add", "a.txt"]);
  git(dir, ["commit", "-m", "init"]);
  git(dir, ["push", "-u", "origin", "main"]);
  return {
    dir, origin,
    cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(origin, { recursive: true, force: true }); },
  };
}

/** Add a commit on a new branch off main, then return to main. */
function branchWithCommit(dir: string, branch: string, file = branch.replace(/\W/g, "_")): void {
  git(dir, ["checkout", "-b", branch]);
  writeFileSync(join(dir, `${file}.txt`), "x\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", `work on ${branch}`]);
  git(dir, ["checkout", "main"]);
}

test("defaultBranch resolves to main when present", () => {
  const r = makeRepo();
  try { assert.equal(defaultBranch(r.dir), "main"); } finally { r.cleanup(); }
});

test("listIntegratableBranches: shows hive/fix/feat ahead, hides main and non-prefixed", () => {
  const r = makeRepo();
  try {
    branchWithCommit(r.dir, "hive/task-1");
    branchWithCommit(r.dir, "feat/thing");
    branchWithCommit(r.dir, "random-branch"); // wrong prefix — excluded
    const { base, branches } = listIntegratableBranches(r.dir);
    assert.equal(base, "main");
    const names = branches.map((b) => b.branch).sort();
    assert.deepEqual(names, ["feat/thing", "hive/task-1"]);
    assert.ok(branches.every((b) => b.ahead === 1 && b.behind === 0 && b.ffOk));
  } finally { r.cleanup(); }
});

test("listIntegratableBranches: a behind branch is listed but flagged ffOk:false", () => {
  const r = makeRepo();
  try {
    branchWithCommit(r.dir, "hive/behind");
    // advance main so the branch is now behind
    writeFileSync(join(r.dir, "a.txt"), "2\n");
    git(r.dir, ["commit", "-am", "advance main"]);
    const { branches } = listIntegratableBranches(r.dir);
    const b = branches.find((x) => x.branch === "hive/behind");
    assert.ok(b, "branch present");
    assert.equal(b!.behind, 1);
    assert.equal(b!.ffOk, false);
  } finally { r.cleanup(); }
});

test("integrateBranch: clean fast-forward + push advances local and origin main", () => {
  const r = makeRepo();
  try {
    branchWithCommit(r.dir, "hive/task-1");
    const before = git(r.dir, ["rev-parse", "main"]).trim();
    const res = integrateBranch(r.dir, "hive/task-1", { push: true });
    assert.equal(res.ok, true);
    assert.equal(res.ffOk, true);
    assert.equal(res.pushed, true);
    const afterLocal = git(r.dir, ["rev-parse", "main"]).trim();
    const afterOrigin = git(r.origin, ["rev-parse", "main"]).trim();
    assert.notEqual(afterLocal, before);
    assert.equal(afterLocal, afterOrigin, "origin/main fast-forwarded to the same commit");
  } finally { r.cleanup(); }
});

test("integrateBranch: push:false integrates locally, leaves origin untouched", () => {
  const r = makeRepo();
  try {
    branchWithCommit(r.dir, "hive/task-1");
    const originBefore = git(r.origin, ["rev-parse", "main"]).trim();
    const res = integrateBranch(r.dir, "hive/task-1", { push: false });
    assert.equal(res.ok, true);
    assert.equal(res.pushed, false);
    assert.equal(git(r.origin, ["rev-parse", "main"]).trim(), originBefore, "origin unchanged");
  } finally { r.cleanup(); }
});

test("integrateBranch: refuses a dirty working tree (does not clobber uncommitted work)", () => {
  const r = makeRepo();
  try {
    branchWithCommit(r.dir, "hive/task-1");
    writeFileSync(join(r.dir, "a.txt"), "uncommitted edit\n"); // dirty
    const res = integrateBranch(r.dir, "hive/task-1", { push: true });
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /dirty/);
    // the dirty edit is still there, untouched
    assert.equal(git(r.dir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(), "main");
  } finally { r.cleanup(); }
});

test("integrateBranch: refuses a branch that is behind (not fast-forwardable)", () => {
  const r = makeRepo();
  try {
    branchWithCommit(r.dir, "hive/behind");
    writeFileSync(join(r.dir, "a.txt"), "2\n");
    git(r.dir, ["commit", "-am", "advance main"]);
    const res = integrateBranch(r.dir, "hive/behind", { push: true });
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /not fast-forwardable/);
  } finally { r.cleanup(); }
});

test("integrateBranch: refuses a non-task-prefixed branch even if it exists and is ahead", () => {
  const r = makeRepo();
  try {
    branchWithCommit(r.dir, "random-branch");
    const res = integrateBranch(r.dir, "random-branch", { push: true });
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /only hive/);
  } finally { r.cleanup(); }
});

test("integrateBranch: refuses a nonexistent branch", () => {
  const r = makeRepo();
  try {
    const res = integrateBranch(r.dir, "hive/nope", { push: true });
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /no such branch/);
  } finally { r.cleanup(); }
});

test("integrateBranch: refuses when there is nothing to integrate (branch even with main)", () => {
  const r = makeRepo();
  try {
    git(r.dir, ["branch", "hive/empty"]); // points at main, 0 ahead
    const res = integrateBranch(r.dir, "hive/empty", { push: true });
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /nothing to integrate/);
  } finally { r.cleanup(); }
});
