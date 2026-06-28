import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-wp-orch-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { _resetDbForTests, getDb, Task } = await import("@/lib/db");
const { createWorkPackage, getWorkPackage, updateWorkPackageItem } = await import("./store");
const { planNextItems, startWorkPackage, advanceWorkPackage, tickWorkPackages } = await import("./orchestrate");
import type { WorkPackageItem } from "./store";
import type { ProposedItem } from "@/lib/intake/classify";

test.before(() => { _resetDbForTests(); getDb(); });
test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

function mkItem(over: Partial<WorkPackageItem>): WorkPackageItem {
  return {
    id: over.id ?? "i" + Math.floor(Math.random() * 1e9),
    packageId: "p1", position: over.position ?? 0, title: over.title ?? "t", prompt: over.prompt ?? "p",
    status: over.status ?? "ready", risk: over.risk ?? "low", dependsOn: over.dependsOn ?? [],
    scopeHints: over.scopeHints ?? [], executionMode: over.executionMode ?? "sequential",
    createdTaskId: over.createdTaskId ?? null, resultTaskId: null, commitHash: null, blocker: null,
    createdAt: "", updatedAt: "",
  };
}

// ── planNextItems (pure) ──────────────────────────────────────────

test("planNextItems: a ready item with no deps and no active work is eligible", () => {
  const items = [mkItem({ id: "a", status: "ready" })];
  assert.deepEqual(planNextItems(items, []), ["a"]);
});

test("planNextItems: a dependency that is not done blocks the item", () => {
  const blocked = [mkItem({ id: "a", status: "running" }), mkItem({ id: "b", status: "ready", position: 1, dependsOn: ["a"] })];
  assert.deepEqual(planNextItems(blocked, []), []);
  const ok = [mkItem({ id: "a", status: "done" }), mkItem({ id: "b", status: "ready", position: 1, dependsOn: ["a"] })];
  assert.deepEqual(planNextItems(ok, []), ["b"]);
});

test("planNextItems: held items are never eligible", () => {
  const items = [mkItem({ id: "a", status: "held", executionMode: "hold" })];
  assert.deepEqual(planNextItems(items, []), []);
});

test("planNextItems: only one writer starts at a time (concurrency 1)", () => {
  const items = [mkItem({ id: "a", status: "ready", position: 0 }), mkItem({ id: "b", status: "ready", position: 1 })];
  assert.deepEqual(planNextItems(items, []), ["a"]);
});

test("planNextItems: worktree/safe items run in parallel", () => {
  const items = [
    mkItem({ id: "a", status: "ready", position: 0, executionMode: "worktree_parallel" }),
    mkItem({ id: "b", status: "ready", position: 1, scopeHints: ["read-only"] }),
  ];
  assert.deepEqual(planNextItems(items, []).sort(), ["a", "b"]);
});

test("planNextItems: an external active same-project task blocks a writer but not a safe item", () => {
  const items = [
    mkItem({ id: "w", status: "ready", position: 0 }),
    mkItem({ id: "s", status: "ready", position: 1, scopeHints: ["read-only"] }),
  ];
  const active = [{ taskId: "ext", title: "other", worktreeName: null }];
  assert.deepEqual(planNextItems(items, active), ["s"]);
});

// ── DB-backed: start / advance / tick ─────────────────────────────

function twoWriterSequentialPackage(title: string) {
  const items: ProposedItem[] = [
    { title: "Step one", prompt: "do step one", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
    { title: "Step two", prompt: "do step two", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: ["Step one"] },
  ];
  return createWorkPackage({ title, project: "hivematrix", projectPath: "/Users/x/seq-" + title, items });
}

test("startWorkPackage promotes draft items to ready, starts only the first writer, package runs", async () => {
  const pkg = twoWriterSequentialPackage("A");
  const r = await startWorkPackage(pkg.id);
  assert.equal(r.package.status, "running");
  assert.equal(r.started.length, 1, "only the first writer starts");
  const detail = getWorkPackage(pkg.id)!;
  const [one, two] = detail.items;
  assert.equal(one.status, "running");
  assert.ok(one.createdTaskId);
  assert.equal(two.status, "ready", "second item is ready but waiting on dep + concurrency");
  assert.equal(two.createdTaskId, null);
});

test("advanceWorkPackage starts the dependent item after the first completes, then finishes", async () => {
  const pkg = twoWriterSequentialPackage("B");
  const started = await startWorkPackage(pkg.id);
  const firstItem = getWorkPackage(pkg.id)!.items[0];

  // First child completes.
  await Task.findByIdAndUpdate(firstItem.createdTaskId!, { status: "done" });
  const adv = await advanceWorkPackage(pkg.id);
  assert.equal(adv.started.length, 1, "the dependent item now starts");
  const d2 = getWorkPackage(pkg.id)!;
  assert.equal(d2.items[0].status, "done");
  assert.equal(d2.items[1].status, "running");
  assert.ok(d2.items[1].createdTaskId);

  // Second child completes → package done.
  await Task.findByIdAndUpdate(d2.items[1].createdTaskId!, { status: "done" });
  const adv2 = await advanceWorkPackage(pkg.id);
  assert.equal(adv2.package.status, "done");
  assert.ok(adv2.package.completedAt);
  void started;
});

test("advanceWorkPackage treats archived linked tasks as landed", async () => {
  const items: ProposedItem[] = [
    { title: "Only step", prompt: "do it", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
  ];
  const pkg = createWorkPackage({ title: "Archived child", project: "hivematrix", projectPath: "/Users/x/archive", items });
  await startWorkPackage(pkg.id);
  const item = getWorkPackage(pkg.id)!.items[0];

  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "archived" });
  const advanced = await advanceWorkPackage(pkg.id);

  assert.equal(advanced.package.status, "done");
  assert.equal(advanced.package.items[0].status, "done");
  assert.ok(advanced.package.completedAt);
});

test("tickWorkPackages advances a running package whose child has completed", async () => {
  const pkg = twoWriterSequentialPackage("C");
  await startWorkPackage(pkg.id);
  const firstItem = getWorkPackage(pkg.id)!.items[0];
  await Task.findByIdAndUpdate(firstItem.createdTaskId!, { status: "done" });

  await tickWorkPackages();

  const d = getWorkPackage(pkg.id)!;
  assert.equal(d.items[0].status, "done");
  assert.equal(d.items[1].status, "running", "the loop advanced the package");
});

test("a held release item is never auto-started by start or advance", async () => {
  const items: ProposedItem[] = [
    { title: "Build", prompt: "build it", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
    { title: "Deploy release", prompt: "deploy the release", risk: "high", executionMode: "hold", scopeHints: [], dependsOn: ["Build"] },
  ];
  const pkg = createWorkPackage({ title: "Gated", project: "hivematrix", projectPath: "/Users/x/gated", items });
  await startWorkPackage(pkg.id);
  const build = getWorkPackage(pkg.id)!.items[0];
  await Task.findByIdAndUpdate(build.createdTaskId!, { status: "done" });
  await advanceWorkPackage(pkg.id);

  const d = getWorkPackage(pkg.id)!;
  assert.equal(d.items[0].status, "done");
  assert.equal(d.items[1].status, "held", "release stays held — final gate");
  assert.equal(d.items[1].createdTaskId, null, "no task auto-created for the held release");
});
