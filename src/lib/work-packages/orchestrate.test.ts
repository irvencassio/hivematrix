import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-wp-orch-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { _resetDbForTests, getDb, Task } = await import("@/lib/db");
const { createWorkPackage, getWorkPackage, updateWorkPackageItem, detectStuckState } = await import("./store");
const { planNextItems, classifyBlockers, startWorkPackage, advanceWorkPackage, tickWorkPackages, reconcileWorkPackage, acceptWorkPackageItem, reconcileStuckFlight, coordinateFlightDecisions } = await import("./orchestrate");
const { readItemBlocker } = await import("./parent-blocker");
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
    createdAt: "", updatedAt: "", taskStatus: over.taskStatus ?? null,
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

// ── Flight child autonomy: parent-decision blockers + coordinator ──

function usagePackage(title: string, description: string) {
  const items: ProposedItem[] = [
    { title: "Color the usage bar", prompt: "color the usage bar", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
  ];
  return createWorkPackage({ title, description, project: "hivematrix", projectPath: "/Users/x/coord-" + title, items });
}

function parentDecisionMarker(b: Record<string, unknown>): string {
  return [
    "I read the parent context but a value is unclear.",
    "<<<NEEDS_PARENT_DECISION",
    JSON.stringify(b),
    "NEEDS_PARENT_DECISION>>>",
    "Awaiting a decision.",
  ].join("\n");
}

test("case 3: reconcile records a needs_parent_decision blocker, not a bare operator needs_input", async () => {
  const pkg = usagePackage("C3", "For the 7-day window color the bar; day 1 at 15% red (14.3% per-day).");
  await startWorkPackage(pkg.id);
  const item = getWorkPackage(pkg.id)!.items[0];
  assert.equal(item.status, "running");

  await Task.findByIdAndUpdate(item.createdTaskId!, {
    status: "review",
    reviewState: "needs_input",
    output: { summary: parentDecisionMarker({ ambiguity: "What period are you referring to?", parentExcerpt: "", options: ["7-day", "5-hour"], recommendedDefault: "7-day", confidence: 0.3 }) },
  });
  await reconcileWorkPackage(pkg.id);

  const after = getWorkPackage(pkg.id)!.items[0];
  assert.equal(after.status, "review");
  const read = readItemBlocker(after.blocker);
  assert.ok(read && read.kind === "parent", "structured parent-decision blocker recorded, not a plain needs_input");
  assert.equal(read!.payload.ambiguity, "What period are you referring to?");
});

test("case 4: coordinator auto-resolves a 'what period?' blocker from the parent's 7-day window and requeues", async () => {
  const pkg = usagePackage("C4", "For the 7-day window color the usage bar. Day 1 at 15% → red (14.3% per-day). Day 7 at 82% → green (85.7%).");
  await startWorkPackage(pkg.id);
  const item = getWorkPackage(pkg.id)!.items[0];
  await Task.findByIdAndUpdate(item.createdTaskId!, {
    status: "review",
    reviewState: "needs_input",
    output: { summary: parentDecisionMarker({ ambiguity: "What period are you referring to?", parentExcerpt: "", options: [], recommendedDefault: "", confidence: 0.1 }) },
  });

  // advance = reconcile (record blocker) + coordinate (resolve + requeue), no operator input.
  await advanceWorkPackage(pkg.id);

  const after = getWorkPackage(pkg.id)!.items[0];
  assert.equal(after.status, "running", "item requeued to running");
  assert.equal(after.blocker, null, "blocker cleared");
  const task = await Task.findById(item.createdTaskId!);
  assert.equal(String((task as Record<string, unknown>).status), "backlog", "child task requeued for more work");
  const desc = String((task as Record<string, unknown>).description);
  assert.match(desc, /7-day/);
  assert.match(desc, /14\.3%/);
  assert.match(desc, /Flight coordinator/);
});

test("case 5: coordinator escalates a product-facing blocker to the operator", async () => {
  const pkg = usagePackage("C5", "Build a pricing page for the app.");
  await startWorkPackage(pkg.id);
  const item = getWorkPackage(pkg.id)!.items[0];
  await Task.findByIdAndUpdate(item.createdTaskId!, {
    status: "review",
    reviewState: "needs_input",
    output: { summary: parentDecisionMarker({ ambiguity: "Which pricing tiers should we show?", parentExcerpt: "", options: ["$9/$29/$99", "single $49"], recommendedDefault: "$9/$29/$99", confidence: 0.2 }) },
  });

  await advanceWorkPackage(pkg.id);

  const after = getWorkPackage(pkg.id)!.items[0];
  assert.equal(after.status, "review", "stays in review for the operator");
  const read = readItemBlocker(after.blocker);
  assert.ok(read && read.kind === "operator", "escalated to an operator decision");
  assert.match(read!.payload.question, /pricing tiers/);
  // The child task is NOT requeued — it waits for the operator.
  const task = await Task.findById(item.createdTaskId!);
  assert.equal(String((task as Record<string, unknown>).status), "review");
});

test("reconcile clears a stale structured decision blocker when an item is requeued to running", async () => {
  const pkg = usagePackage("C7", "Build a pricing page for the app.");
  await startWorkPackage(pkg.id);
  const item = getWorkPackage(pkg.id)!.items[0];
  // Escalate to the operator first.
  await Task.findByIdAndUpdate(item.createdTaskId!, {
    status: "review",
    reviewState: "needs_input",
    output: { summary: parentDecisionMarker({ ambiguity: "Which pricing tiers should we show?", parentExcerpt: "", options: ["a", "b"], recommendedDefault: "a", confidence: 0.2 }) },
  });
  await advanceWorkPackage(pkg.id);
  assert.equal(readItemBlocker(getWorkPackage(pkg.id)!.items[0].blocker)?.kind, "operator");

  // Operator replies → task requeued to backlog; reconcile must drop the sentinel.
  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "backlog", reviewState: null });
  await reconcileWorkPackage(pkg.id);
  const after = getWorkPackage(pkg.id)!.items[0];
  assert.equal(after.status, "running");
  assert.equal(after.blocker, null, "structured decision blocker cleared on requeue");
});

test("coordinateFlightDecisions ignores plain failure blockers and already-escalated items", async () => {
  const pkg = usagePackage("C6", "Make it nicer.");
  await startWorkPackage(pkg.id);
  const item = getWorkPackage(pkg.id)!.items[0];
  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "failed", error: "agent crashed" });
  await reconcileWorkPackage(pkg.id);
  const r = await coordinateFlightDecisions(pkg.id);
  assert.deepEqual(r.requeued, []);
  assert.deepEqual(r.escalated, []);
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

test("advanceWorkPackage: archiving a running item's task lands the item done and closes the package cleanly", async () => {
  const items: ProposedItem[] = [
    { title: "Only step", prompt: "do it", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
  ];
  const pkg = createWorkPackage({ title: "Archived child", project: "hivematrix", projectPath: "/Users/x/archive", items });
  await startWorkPackage(pkg.id);
  const item = getWorkPackage(pkg.id)!.items[0];

  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "archived" });
  const advanced = await advanceWorkPackage(pkg.id);

  assert.equal(advanced.package.items[0].status, "done",
    "durable repair: archiving a running task lands the item done (not archived)");
  assert.equal(advanced.package.status, "done",
    "package closes as clean done (not done_with_skips) since the item landed done");
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

// --- Archived item tests ---

test("reconcileWorkPackage: archiving a running item's task lands it done (durable runtime repair)", async () => {
  const { generateId } = await import("@/lib/db");
  const pkg = createWorkPackage({
    title: "Archived-task pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const itemA = pkg.items[0];
  const db = getDb();
  const taskId = generateId();
  db.prepare("INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'in_progress')").run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, itemA.id);
  db.prepare("UPDATE tasks SET status = 'archived' WHERE _id = ?").run(taskId);
  await reconcileWorkPackage(pkg.id);
  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.items[0].status, "done",
    "durable repair: archiving a running task lands the item done, not archived");
});

test("rollupStatus returns done_with_skips when all items terminal and at least one archived, none failed", async () => {
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Rollup-archived pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Item B", prompt: "Do B", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  db.prepare("UPDATE work_package_items SET status = 'done' WHERE _id = ?").run(pkg.items[0].id);
  db.prepare("UPDATE work_package_items SET status = 'archived' WHERE _id = ?").run(pkg.items[1].id);
  const result = await advanceWorkPackage(pkg.id);
  assert.equal(result.package.status, "done_with_skips", "done+archived → done_with_skips");
});

test("rollupStatus returns done when all items done, none archived", async () => {
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Rollup-alldone pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Item B", prompt: "Do B", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  db.prepare("UPDATE work_package_items SET status = 'done' WHERE _id = ?").run(pkg.items[0].id);
  db.prepare("UPDATE work_package_items SET status = 'done' WHERE _id = ?").run(pkg.items[1].id);
  const result = await advanceWorkPackage(pkg.id);
  assert.equal(result.package.status, "done", "all done → done (not done_with_skips)");
});

test("rollupStatus returns failed when any item failed even with archived items", async () => {
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Rollup-failed pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Item B", prompt: "Do B", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Item C", prompt: "Do C", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  db.prepare("UPDATE work_package_items SET status = 'done' WHERE _id = ?").run(pkg.items[0].id);
  db.prepare("UPDATE work_package_items SET status = 'archived' WHERE _id = ?").run(pkg.items[1].id);
  db.prepare("UPDATE work_package_items SET status = 'failed' WHERE _id = ?").run(pkg.items[2].id);
  const result = await advanceWorkPackage(pkg.id);
  assert.equal(result.package.status, "failed", "any failed → failed (even with archived)");
});

// --- Durable runtime repair: archive of a running/review item's task lands it done ---
// When an operator archives a task that was running or in review, reconciliation
// treats the archive as accepted work and lands the item as done — not as an
// intentional skip (archived). This allows Advance to unblock dependent items.
// The explicit acceptWorkPackageItem action is still the preferred path for review
// items; this repair handles the case where the task is archived directly.

test("reconcileWorkPackage: archiving a review-state task lands the item done (durable repair)", async () => {
  const { generateId } = await import("@/lib/db");
  const pkg = createWorkPackage({
    title: "Review-archived pkg",
    project: "test",
    projectPath: "/tmp/test-review-archived",
    items: [{ title: "Review Item", prompt: "Do review", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const db = getDb();
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'review')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'review', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);
  db.prepare("UPDATE tasks SET status = 'archived' WHERE _id = ?").run(taskId);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.items[0].status, "done",
    "durable repair: archiving a review task lands the item done, enabling Advance");
});

test("advanceWorkPackage: archiving a review item's task lands the package as clean done", async () => {
  const items: ProposedItem[] = [
    { title: "Only step", prompt: "do it", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
  ];
  const pkg = createWorkPackage({ title: "Archived-review-repair", project: "hivematrix", projectPath: "/Users/x/arch-rev2", items });
  await startWorkPackage(pkg.id);
  const [item1] = getWorkPackage(pkg.id)!.items;

  const db = getDb();
  await Task.findByIdAndUpdate(item1.createdTaskId!, { status: "review" });
  db.prepare("UPDATE work_package_items SET status = 'review' WHERE _id = ?").run(item1.id);

  // Operator archives the task — durable repair lands the item as done.
  await Task.findByIdAndUpdate(item1.createdTaskId!, { status: "archived" });

  const r = await advanceWorkPackage(pkg.id);

  assert.equal(r.package.items[0].status, "done",
    "durable repair: review item lands done when its task is archived");
  assert.equal(r.package.status, "done",
    "package closes as clean done (not done_with_skips) since item landed done");
});

test("advanceWorkPackage: archiving a review item's task lands it done and unblocks the dependent", async () => {
  const items: ProposedItem[] = [
    { title: "Review step", prompt: "do review", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
    { title: "Next step", prompt: "do next", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: ["Review step"] },
  ];
  const pkg = createWorkPackage({ title: "Advance-archived-dep", project: "hivematrix", projectPath: "/Users/x/arch-dep", items });
  await startWorkPackage(pkg.id);
  const [item1] = getWorkPackage(pkg.id)!.items;

  const db = getDb();
  await Task.findByIdAndUpdate(item1.createdTaskId!, { status: "review" });
  db.prepare("UPDATE work_package_items SET status = 'review' WHERE _id = ?").run(item1.id);
  await Task.findByIdAndUpdate(item1.createdTaskId!, { status: "archived" });

  const r = await advanceWorkPackage(pkg.id);

  const d = getWorkPackage(pkg.id)!;
  assert.equal(d.items[0].status, "done", "durable repair: review item lands done when its task is archived");
  assert.equal(d.items[1].status, "running", "dependent item starts (done satisfies dep resolution)");
  assert.equal(r.started.length, 1, "Advance is not stalled — one item started");
  assert.equal(d.status, "running");
});

// --- acceptWorkPackageItem: explicit Accept / Land operator action ---

test("acceptWorkPackageItem: marks review item done, archives linked task, advances package to done", async () => {
  const items: ProposedItem[] = [
    { title: "Review work", prompt: "check it", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
  ];
  const pkg = createWorkPackage({ title: "Accept-to-done", project: "hivematrix", projectPath: "/Users/x/accept-done", items });
  await startWorkPackage(pkg.id);
  const [item1] = getWorkPackage(pkg.id)!.items;

  const db = getDb();
  await Task.findByIdAndUpdate(item1.createdTaskId!, { status: "review" });
  db.prepare("UPDATE work_package_items SET status = 'review' WHERE _id = ?").run(item1.id);

  const r = await acceptWorkPackageItem(pkg.id, item1.id);

  assert.equal(r.package.items[0].status, "done", "accepted item is 'done'");
  assert.equal(r.package.status, "done", "package completes as clean 'done' — not done_with_skips");
  assert.ok(r.package.completedAt, "package has completedAt");

  const task = await Task.findById(item1.createdTaskId!);
  assert.equal(String((task as Record<string, unknown>).status), "archived", "linked task is archived (preserved on board)");
});

test("acceptWorkPackageItem: unblocks dependent item, package remains running", async () => {
  const items: ProposedItem[] = [
    { title: "Review step", prompt: "do review", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
    { title: "Next step", prompt: "do next", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: ["Review step"] },
  ];
  const pkg = createWorkPackage({ title: "Accept-unblocks-dep", project: "hivematrix", projectPath: "/Users/x/accept-dep", items });
  await startWorkPackage(pkg.id);
  const [item1] = getWorkPackage(pkg.id)!.items;

  const db = getDb();
  await Task.findByIdAndUpdate(item1.createdTaskId!, { status: "review" });
  db.prepare("UPDATE work_package_items SET status = 'review' WHERE _id = ?").run(item1.id);

  const r = await acceptWorkPackageItem(pkg.id, item1.id);

  const d = getWorkPackage(pkg.id)!;
  assert.equal(d.items[0].status, "done", "accepted item is done");
  assert.equal(d.items[1].status, "running", "dependent item starts after accept");
  assert.equal(r.started.length, 1, "Advance is not stalled — one item started");
  assert.equal(d.status, "running");
});

test("acceptWorkPackageItem: rejects non-review item with an error", async () => {
  const items: ProposedItem[] = [
    { title: "Running step", prompt: "doing work", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
  ];
  const pkg = createWorkPackage({ title: "Accept-not-review", project: "hivematrix", projectPath: "/Users/x/not-review", items });
  await startWorkPackage(pkg.id);
  const [item1] = getWorkPackage(pkg.id)!.items;

  await assert.rejects(
    () => acceptWorkPackageItem(pkg.id, item1.id),
    /not in review status/,
    "acceptWorkPackageItem must reject items that are not in review status",
  );
});

test("acceptWorkPackageItem: item with no linked task is still marked done", async () => {
  const pkg = createWorkPackage({
    title: "Accept-no-task",
    project: "test",
    projectPath: "/tmp/accept-no-task",
    items: [{ title: "Review item", prompt: "Check this", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const db = getDb();
  db.prepare("UPDATE work_package_items SET status = 'review' WHERE _id = ?").run(pkg.items[0].id);

  const r = await acceptWorkPackageItem(pkg.id, pkg.items[0].id);

  assert.equal(r.package.items[0].status, "done", "item without linked task is still marked done on accept");
});

// --- High-risk cancelled item rollup semantics ---

test("rollupStatus: high-risk cancelled item triggers done_with_skips (not done)", async () => {
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Rollup-cancelled-high pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Safe step", prompt: "Do it", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Risky deploy", prompt: "Deploy release", risk: "high", executionMode: "hold", dependsOn: [], scopeHints: [] },
    ],
  });
  db.prepare("UPDATE work_package_items SET status = 'done' WHERE _id = ?").run(pkg.items[0].id);
  // Operator intentionally skips the held high-risk item by cancelling it.
  db.prepare("UPDATE work_package_items SET status = 'cancelled', risk = 'high' WHERE _id = ?").run(pkg.items[1].id);
  const result = await advanceWorkPackage(pkg.id);
  assert.equal(result.package.status, "done_with_skips", "done + cancelled(high) → done_with_skips, not done");
});

test("rollupStatus: low-risk cancelled item does NOT trigger done_with_skips", async () => {
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Rollup-cancelled-low pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Step A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Step B", prompt: "Do B", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  db.prepare("UPDATE work_package_items SET status = 'done' WHERE _id = ?").run(pkg.items[0].id);
  db.prepare("UPDATE work_package_items SET status = 'cancelled', risk = 'low' WHERE _id = ?").run(pkg.items[1].id);
  const result = await advanceWorkPackage(pkg.id);
  assert.equal(result.package.status, "done", "done + cancelled(low) → done, no scope skip signal");
});

test("rollupStatus: medium-risk cancelled item does NOT trigger done_with_skips", async () => {
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Rollup-cancelled-medium pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Step A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Step B", prompt: "Do B", risk: "medium", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  db.prepare("UPDATE work_package_items SET status = 'done' WHERE _id = ?").run(pkg.items[0].id);
  db.prepare("UPDATE work_package_items SET status = 'cancelled', risk = 'medium' WHERE _id = ?").run(pkg.items[1].id);
  const result = await advanceWorkPackage(pkg.id);
  assert.equal(result.package.status, "done", "done + cancelled(medium) → done, only high-risk signals skip");
});

// --- Goal Flight stall diagnostics ---

test("advanceWorkPackage returns stall diagnostic for running Goal Flight with no eligible items and no scheduled pass", async () => {
  const { upsertLoop } = await import("./flight-loop-store");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Stalled Goal Flight",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate" as const,
      confidence: 0.85,
      reasons: ["broad outcome"],
      risk: "medium" as const,
      suggestedMode: "split" as const,
      goalFlight: {
        goal: "Build a marketplace",
        successCriteria: ["Users can list items"],
      },
    },
    items: [
      { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  // Set package to running, all items to held (no eligible next items, no active work)
  db.prepare("UPDATE work_packages SET status = 'running' WHERE _id = ?").run(pkg.id);
  db.prepare("UPDATE work_package_items SET status = 'held' WHERE _id = ?").run(pkg.items[0].id);
  // Create a loop with no scheduled pass
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 6, profile: "goal_quality" });

  const result = await advanceWorkPackage(pkg.id);

  assert.ok(result.stall, "stall diagnostic returned for stalled Goal Flight");
  assert.equal(typeof result.stall!.reason, "string", "stall.reason is a string");
  assert.ok(Array.isArray(result.stall!.suggestions), "stall.suggestions is an array");
});

// --- classifyBlockers (pure) ---

test("classifyBlockers: review — item in review status is a review blocker", () => {
  const items = [
    mkItem({ id: "a", status: "review" }),
    mkItem({ id: "b", status: "done" }),
  ];
  const bl = classifyBlockers(items, []);
  assert.deepEqual(bl.review, ["a"]);
  assert.deepEqual(bl.held, []);
  assert.deepEqual(bl.dependency, []);
  assert.deepEqual(bl.activeWriter, []);
  assert.equal(bl.noReadyItems, true);
});

test("classifyBlockers: held — item in held status is a held blocker", () => {
  const items = [mkItem({ id: "a", status: "held", executionMode: "hold" })];
  const bl = classifyBlockers(items, []);
  assert.deepEqual(bl.held, ["a"]);
  assert.deepEqual(bl.review, []);
  assert.equal(bl.noReadyItems, true);
});

test("classifyBlockers: dependency — ready item with unsatisfied dep is a dependency blocker", () => {
  const items = [
    mkItem({ id: "dep", status: "running" }),
    mkItem({ id: "child", status: "ready", position: 1, dependsOn: ["dep"] }),
  ];
  const bl = classifyBlockers(items, []);
  assert.deepEqual(bl.dependency, ["child"]);
  assert.deepEqual(bl.activeWriter, []);
  assert.equal(bl.noReadyItems, false);
});

test("classifyBlockers: activeWriter — ready writer blocked by same-package running writer", () => {
  const items = [
    mkItem({ id: "running", status: "running" }),
    mkItem({ id: "next", status: "ready", position: 1 }),
  ];
  const bl = classifyBlockers(items, []);
  assert.deepEqual(bl.activeWriter, ["next"]);
  assert.deepEqual(bl.dependency, []);
  assert.equal(bl.noReadyItems, false);
});

test("classifyBlockers: activeWriter — ready writer blocked by external same-project task", () => {
  const items = [mkItem({ id: "w", status: "ready" })];
  const external = [{ taskId: "ext", title: "other", worktreeName: null }];
  const bl = classifyBlockers(items, external);
  assert.deepEqual(bl.activeWriter, ["w"]);
  assert.equal(bl.noReadyItems, false);
});

test("classifyBlockers: noReadyItems — true when all items are terminal or running", () => {
  const items = [
    mkItem({ id: "a", status: "done" }),
    mkItem({ id: "b", status: "running" }),
  ];
  const bl = classifyBlockers(items, []);
  assert.equal(bl.noReadyItems, true);
  assert.deepEqual(bl.review, []);
  assert.deepEqual(bl.held, []);
  assert.deepEqual(bl.dependency, []);
  assert.deepEqual(bl.activeWriter, []);
});

test("classifyBlockers: worktree/safe items are not classified as activeWriter blockers", () => {
  const items = [
    mkItem({ id: "running", status: "running" }),
    mkItem({ id: "safe", status: "ready", position: 1, scopeHints: ["read-only"] }),
  ];
  const bl = classifyBlockers(items, []);
  assert.deepEqual(bl.activeWriter, [], "read-only item should not be an activeWriter blocker");
  assert.deepEqual(bl.dependency, [], "no dep blockers");
  assert.equal(bl.noReadyItems, false);
});

// --- advanceWorkPackage returns blockers (integration) ---

test("advanceWorkPackage returns held blocker when all items are held", async () => {
  const items: ProposedItem[] = [
    { title: "Gate", prompt: "gate it", risk: "high", executionMode: "hold", scopeHints: [], dependsOn: [] },
  ];
  const pkg = createWorkPackage({ title: "Held gate", project: "test", projectPath: "/tmp/bl-held", items });
  const r = await startWorkPackage(pkg.id);
  assert.equal(r.started.length, 0, "held item cannot auto-start");
  assert.ok(r.blockers, "blockers returned when nothing started");
  assert.ok(r.blockers!.held.length > 0, "held blocker present");
  assert.equal(r.blockers!.noReadyItems, true);
});

test("advanceWorkPackage returns dependency blocker when dep not yet done", async () => {
  const pkg = twoWriterSequentialPackage("BlockerDep");
  const r = await startWorkPackage(pkg.id);
  assert.equal(r.started.length, 1, "first item starts");
  // Advance again immediately — dep still running, second item is dep-blocked.
  const r2 = await advanceWorkPackage(pkg.id);
  assert.equal(r2.started.length, 0);
  assert.ok(r2.blockers, "blockers returned on second advance");
  assert.ok(r2.blockers!.dependency.length > 0, "dependency blocker for second item");
});

test("advanceWorkPackage returns blockers=undefined when items do start", async () => {
  const items: ProposedItem[] = [
    { title: "Solo", prompt: "do it", risk: "low", executionMode: "sequential", scopeHints: [], dependsOn: [] },
  ];
  const pkg = createWorkPackage({ title: "Started ok", project: "test", projectPath: "/tmp/bl-ok", items });
  const r = await startWorkPackage(pkg.id);
  assert.equal(r.started.length, 1);
  assert.equal(r.blockers, undefined, "no blockers when items started");
});

// ── Failed item retry / resurrection semantics (RED — currently failing) ──────

test("reconcileWorkPackage: failed item is restored to 'running' when linked task moves to in_progress", async () => {
  const pkg = twoWriterSequentialPackage("RetryInProgress");
  await startWorkPackage(pkg.id);
  const item = getWorkPackage(pkg.id)!.items[0];

  // Fail the task so the item reconciles to failed.
  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "failed", error: "build error" });
  await reconcileWorkPackage(pkg.id);
  assert.equal(getWorkPackage(pkg.id)!.items[0].status, "failed", "precondition: item is failed");

  // Operator retries: task moves back to in_progress.
  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "in_progress" });
  await reconcileWorkPackage(pkg.id);

  // FAILS today: reconcileWorkPackage skips items whose status is not running/review,
  // so a failed item is never restored even when its task is retried.
  assert.equal(getWorkPackage(pkg.id)!.items[0].status, "running",
    "failed item must be restored to running when its linked task is retried to in_progress");
});

test("reconcileWorkPackage: failed item is restored to 'running' when linked task moves to backlog", async () => {
  const pkg = twoWriterSequentialPackage("RetryBacklog");
  await startWorkPackage(pkg.id);
  const item = getWorkPackage(pkg.id)!.items[0];

  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "failed" });
  await reconcileWorkPackage(pkg.id);
  assert.equal(getWorkPackage(pkg.id)!.items[0].status, "failed", "precondition: item is failed");

  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "backlog" });
  await reconcileWorkPackage(pkg.id);

  assert.equal(getWorkPackage(pkg.id)!.items[0].status, "running",
    "failed item must be restored to running when its linked task is queued back to backlog");
});

test("reconcileWorkPackage: failed item is restored to 'review' when linked task advances to review", async () => {
  const pkg = twoWriterSequentialPackage("RetryToReview");
  await startWorkPackage(pkg.id);
  const item = getWorkPackage(pkg.id)!.items[0];

  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "failed" });
  await reconcileWorkPackage(pkg.id);
  assert.equal(getWorkPackage(pkg.id)!.items[0].status, "failed", "precondition: item is failed");

  // Task was salvaged and moved straight to review without re-running.
  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "review" });
  await reconcileWorkPackage(pkg.id);

  assert.equal(getWorkPackage(pkg.id)!.items[0].status, "review",
    "failed item must advance to review when its linked task is moved to review state");
});

test("advanceWorkPackage: dependent item starts after failed predecessor is retried and completes", async () => {
  const pkg = twoWriterSequentialPackage("RetryAndUnblockDep");
  await startWorkPackage(pkg.id);
  const [itemA, itemB] = getWorkPackage(pkg.id)!.items;

  // Step A fails.
  await Task.findByIdAndUpdate(itemA.createdTaskId!, { status: "failed", error: "compilation error" });
  await advanceWorkPackage(pkg.id);
  assert.equal(getWorkPackage(pkg.id)!.items[0].status, "failed", "precondition: A is failed");
  assert.equal(getWorkPackage(pkg.id)!.items[1].status, "ready", "B is still ready while A failed");

  // Operator retries A's task (moves it back to in_progress).
  await Task.findByIdAndUpdate(itemA.createdTaskId!, { status: "in_progress" });
  await reconcileWorkPackage(pkg.id);
  // FAILS today: reconcile does not update failed items, so A stays failed.
  assert.equal(getWorkPackage(pkg.id)!.items[0].status, "running",
    "A must be restored to running after the retry — the gating condition for B to eventually proceed");

  // A completes successfully.
  await Task.findByIdAndUpdate(itemA.createdTaskId!, { status: "done" });
  const adv = await advanceWorkPackage(pkg.id);

  assert.equal(getWorkPackage(pkg.id)!.items[0].status, "done", "A is now done");
  assert.ok(adv.started.includes(itemB.id), "B must start once A reaches done after retry");
  assert.equal(getWorkPackage(pkg.id)!.items[1].status, "running", "B is now running");
});

// --- Blocker clearing on retry ---

test("reconcileWorkPackage: stale blocker is cleared when failed item is restored to running", async () => {
  const pkg = twoWriterSequentialPackage("BlockerClear");
  await startWorkPackage(pkg.id);
  const item = getWorkPackage(pkg.id)!.items[0];

  // Fail the task with an error message — blocker should be set.
  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "failed", error: "network timeout" });
  await reconcileWorkPackage(pkg.id);
  const failedItem = getWorkPackage(pkg.id)!.items[0];
  assert.equal(failedItem.status, "failed", "precondition: item is failed");
  assert.equal(failedItem.blocker, "network timeout", "precondition: blocker is set from task error");

  // Operator retries: task goes back to backlog.
  await Task.findByIdAndUpdate(item.createdTaskId!, { status: "backlog", error: null });
  await reconcileWorkPackage(pkg.id);

  const retried = getWorkPackage(pkg.id)!.items[0];
  assert.equal(retried.status, "running", "item restored to running");
  assert.equal(retried.blocker, null, "stale blocker must be cleared when item leaves failed state");
});

// --- Terminal safety: cancelled/archived items are never re-synced ---

test("reconcileWorkPackage: cancelled item is not resurrected even when linked task is active", async () => {
  const { generateId } = await import("@/lib/db");
  const pkg = createWorkPackage({
    title: "Terminal-cancel pkg",
    project: "test",
    projectPath: "/tmp/test-terminal",
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const db = getDb();
  const taskId = generateId();
  db.prepare("INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'in_progress')").run(taskId);
  // Manually wire up a cancelled item to a still-active task (operator cancelled the item, not the task).
  db.prepare("UPDATE work_package_items SET status = 'cancelled', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.items[0].status, "cancelled",
    "cancelled item must not be resurrected by reconcile even when linked task is active");
});

test("reconcileWorkPackage: archived item is not resurrected even when linked task is active", async () => {
  const { generateId } = await import("@/lib/db");
  const pkg = createWorkPackage({
    title: "Terminal-archived pkg",
    project: "test",
    projectPath: "/tmp/test-terminal-arch",
    items: [{ title: "Item B", prompt: "Do B", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const db = getDb();
  const taskId = generateId();
  db.prepare("INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'in_progress')").run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'archived', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.items[0].status, "archived",
    "archived item must not be resurrected by reconcile even when linked task is active");
});

// ── detectStuckState (pure unit tests) ───────────────────────────

test("detectStuckState: null when no items have terminal linked tasks", () => {
  const items = [
    mkItem({ id: "a", status: "running", createdTaskId: "t1", taskStatus: "in_progress" }),
    mkItem({ id: "b", status: "ready", position: 1, dependsOn: ["a"] }),
  ];
  assert.equal(detectStuckState(items), null);
});

test("detectStuckState: null when stuck item has no ready dependents", () => {
  const items = [
    mkItem({ id: "a", status: "running", createdTaskId: "t1", taskStatus: "archived" }),
    mkItem({ id: "b", status: "done", position: 1, dependsOn: ["a"] }),
  ];
  assert.equal(detectStuckState(items), null, "dep already done — not stuck");
});

test("detectStuckState: null when no items at all", () => {
  assert.equal(detectStuckState([]), null);
});

test("detectStuckState: detects stuck when running item has archived task and ready dependent", () => {
  const items = [
    mkItem({ id: "a", status: "running", createdTaskId: "t1", taskStatus: "archived" }),
    mkItem({ id: "b", status: "ready", position: 1, dependsOn: ["a"] }),
  ];
  const stuck = detectStuckState(items);
  assert.ok(stuck, "stuck state must be detected");
  assert.equal(stuck!.stuckItems.length, 1);
  assert.equal(stuck!.stuckItems[0].itemId, "a");
  assert.equal(stuck!.stuckItems[0].itemStatus, "running");
  assert.equal(stuck!.stuckItems[0].taskStatus, "archived");
  assert.deepEqual(stuck!.readyDependentIds, ["b"]);
  assert.equal(stuck!.canAutoRepair, true, "archived task is the unambiguous auto-repair case");
  assert.equal(typeof stuck!.reason, "string");
  assert.equal(typeof stuck!.suggestedAction, "string");
});

test("detectStuckState: detects stuck when review item has done task and ready dependent", () => {
  const items = [
    mkItem({ id: "a", status: "review", createdTaskId: "t1", taskStatus: "done" }),
    mkItem({ id: "b", status: "ready", position: 1, dependsOn: ["a"] }),
  ];
  const stuck = detectStuckState(items);
  assert.ok(stuck, "review item with done task and ready dep is stuck");
  assert.equal(stuck!.stuckItems[0].itemStatus, "review");
  assert.equal(stuck!.canAutoRepair, false, "done task is not the unambiguous archived case");
});

test("detectStuckState: canAutoRepair false when any stuck item has non-archived terminal task", () => {
  const items = [
    mkItem({ id: "a", status: "running", createdTaskId: "t1", taskStatus: "archived" }),
    mkItem({ id: "b", status: "running", createdTaskId: "t2", taskStatus: "failed" }),
    mkItem({ id: "c", status: "ready", position: 2, dependsOn: ["a", "b"] }),
  ];
  const stuck = detectStuckState(items);
  assert.ok(stuck);
  assert.equal(stuck!.stuckItems.length, 2);
  assert.equal(stuck!.canAutoRepair, false, "mixed archived+failed: not all archived, so no auto-repair");
});

test("detectStuckState: multiple ready dependents all appear in readyDependentIds", () => {
  const items = [
    mkItem({ id: "a", status: "running", createdTaskId: "t1", taskStatus: "archived" }),
    mkItem({ id: "b", status: "ready", position: 1, dependsOn: ["a"] }),
    mkItem({ id: "c", status: "ready", position: 2, dependsOn: ["a"] }),
  ];
  const stuck = detectStuckState(items);
  assert.ok(stuck);
  assert.deepEqual(stuck!.readyDependentIds.sort(), ["b", "c"]);
});

// ── stuckState in getWorkPackage (DB integration) ────────────────

test("getWorkPackage: stuckState is non-null for running Flight with stuck item and ready dependent", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Stuck-state DB test",
    project: "test",
    projectPath: "/tmp/stuck-db",
    items: [
      { title: "Step A", prompt: "do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Step B", prompt: "do B", risk: "low", executionMode: "sequential", dependsOn: ["Step A"], scopeHints: [] },
    ],
  });
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'archived')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, pkg.items[0].id);
  db.prepare("UPDATE work_package_items SET status = 'ready' WHERE _id = ?").run(pkg.items[1].id);
  db.prepare("UPDATE work_packages SET status = 'running' WHERE _id = ?").run(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.ok(detail.stuckState, "stuckState must be non-null for stuck running Flight");
  assert.equal(detail.stuckState!.stuckItems[0].itemId, pkg.items[0].id);
  assert.equal(detail.stuckState!.canAutoRepair, true);
  assert.deepEqual(detail.stuckState!.readyDependentIds, [pkg.items[1].id]);
});

test("getWorkPackage: stuckState is null for non-running Flight (done)", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Done-flight stuckState",
    project: "test",
    projectPath: "/tmp/done-stuck",
    items: [
      { title: "Only step", prompt: "do it", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'archived')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, pkg.items[0].id);
  db.prepare("UPDATE work_packages SET status = 'done' WHERE _id = ?").run(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.stuckState, null, "stuckState must be null for non-running (done) Flight");
});

// ── reconcileStuckFlight (integration) ───────────────────────────

test("reconcileStuckFlight: repairs archived-task stuck item and starts ready dependent", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Reconcile-stuck repair",
    project: "test",
    projectPath: "/tmp/reconcile-stuck",
    items: [
      { title: "Step A", prompt: "do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Step B", prompt: "do B", risk: "low", executionMode: "sequential", dependsOn: ["Step A"], scopeHints: [] },
    ],
  });
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'archived')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, pkg.items[0].id);
  db.prepare("UPDATE work_package_items SET status = 'ready' WHERE _id = ?").run(pkg.items[1].id);
  db.prepare("UPDATE work_packages SET status = 'running' WHERE _id = ?").run(pkg.id);

  // Pre-condition: stuckState is non-null before repair.
  assert.ok(getWorkPackage(pkg.id)!.stuckState, "pre-condition: stuckState is non-null");

  const result = await reconcileStuckFlight(pkg.id);

  assert.equal(result.package.items[0].status, "done",
    "stuck running item with archived task is repaired to done");
  assert.equal(result.package.items[1].status, "running",
    "ready dependent starts after repair");
  assert.equal(result.started.length, 1, "one item started");

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.stuckState, null, "stuckState is null after successful repair");
});

test("reconcileStuckFlight: throws for unknown package id", async () => {
  await assert.rejects(
    () => reconcileStuckFlight("nonexistent-id"),
    /unknown work package/,
  );
});

test("reconcileStuckFlight: idempotent on a clean running Flight (no stuck items)", async () => {
  const pkg = twoWriterSequentialPackage("ReconcileClean");
  await startWorkPackage(pkg.id);

  const result = await reconcileStuckFlight(pkg.id);

  assert.equal(result.started.length, 0, "no new items started on a clean flight");
  assert.equal(result.package.stuckState, null, "no stuckState on clean flight");
});

// ── shouldAutoLand (pure predicate) ─────────────────────────────────────────
// RED until orchestrate.ts exports shouldAutoLand (Task 6 in the auto-land plan).
// shouldAutoLand is captured here from the module object; it will be `undefined`
// until implemented. Tests that call it throw TypeError → expected RED state.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shouldAutoLand = ((await import("./orchestrate")) as any).shouldAutoLand as
  | ((
      item: { risk: string; blocker: string | null; executionMode: string },
      actualTaskStatus: string | null,
      loop: { profile: string } | null,
      taskReviewState?: string | null,
    ) => { autoLand: boolean; reason: string })
  | undefined;

function mkLoop(profile: string): { profile: string } {
  return { profile };
}

test("shouldAutoLand: low risk + task=review + no blocker + no loop → autoLand true (clean micro-task)", () => {
  const r = shouldAutoLand!({ risk: "low", blocker: null, executionMode: "sequential" }, "review", null);
  assert.equal(r.autoLand, true);
  assert.equal(typeof r.reason, "string");
});

test("shouldAutoLand: medium risk → autoLand false (human judgment required)", () => {
  const r = shouldAutoLand!({ risk: "medium", blocker: null, executionMode: "sequential" }, "review", null);
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /medium/);
});

test("shouldAutoLand: high risk → autoLand false (human judgment required)", () => {
  const r = shouldAutoLand!({ risk: "high", blocker: null, executionMode: "sequential" }, "review", null);
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /high/);
});

test("shouldAutoLand: task=needs_input → autoLand false (agent waiting for operator data)", () => {
  const r = shouldAutoLand!({ risk: "low", blocker: null, executionMode: "sequential" }, "needs_input", null);
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /input/);
});

test("shouldAutoLand: task reviewState=needs_input → autoLand false (review is waiting for operator input)", () => {
  const r = shouldAutoLand!({ risk: "low", blocker: null, executionMode: "sequential" }, "review", null, "needs_input");
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /review state|input/i);
});

test("shouldAutoLand: has open blocker → autoLand false (unanswered question)", () => {
  const r = shouldAutoLand!({ risk: "low", blocker: "some error", executionMode: "sequential" }, "review", null);
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /blocker/i);
});

test("shouldAutoLand: executionMode=hold → autoLand false (final-gated item)", () => {
  const r = shouldAutoLand!({ risk: "low", blocker: null, executionMode: "hold" }, "review", null);
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /hold|gat/i);
});

test("shouldAutoLand: release loop → autoLand false (sign-off required on every release item)", () => {
  const r = shouldAutoLand!({ risk: "low", blocker: null, executionMode: "sequential" }, "review", mkLoop("release"));
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /release/i);
});

test("shouldAutoLand: quality loop → autoLand true (quality loop creates follow-ups but does not gate acceptance)", () => {
  const r = shouldAutoLand!({ risk: "low", blocker: null, executionMode: "sequential" }, "review", mkLoop("quality"));
  assert.equal(r.autoLand, true);
});

// ── reconcileWorkPackage — auto-land, positive cases (integration) ────────────
// RED until reconcileWorkPackage calls shouldAutoLand internally (Task 6).

test("reconcileWorkPackage auto-land: low-risk task=review with no blocker lands to done without operator action", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Auto-land clean item",
    project: "test",
    projectPath: "/tmp/auto-land-clean",
    items: [{ title: "Micro step", prompt: "do micro", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'review')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(
    detail.items[0].status,
    "done",
    "low-risk review item with no blocker must auto-land to done — no operator action required",
  );
  const task = await Task.findById(taskId);
  assert.equal(
    String((task as Record<string, unknown>).status),
    "archived",
    "auto-land archives the linked task (same behaviour as acceptWorkPackageItem)",
  );
});

test("reconcileWorkPackage auto-land: ready_for_review state still lands clean low-risk item", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Auto-land ready_for_review item",
    project: "test",
    projectPath: "/tmp/auto-land-ready-for-review",
    items: [{ title: "Micro step", prompt: "do micro", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status, reviewState) VALUES (?, 'T', 'D', 'test', '/tmp', 'review', 'ready_for_review')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(
    detail.items[0].status,
    "done",
    "ready_for_review is a clean completion marker and must not block low-risk auto-land",
  );
  const task = await Task.findById(taskId);
  assert.equal(String((task as Record<string, unknown>).status), "archived");
});

test("reconcileWorkPackage auto-land: existing review item with ready_for_review state is repaired to done", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Auto-land existing review item",
    project: "test",
    projectPath: "/tmp/auto-land-existing-review",
    items: [{ title: "Micro step", prompt: "do micro", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status, reviewState) VALUES (?, 'T', 'D', 'test', '/tmp', 'review', 'ready_for_review')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'review', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(
    detail.items[0].status,
    "done",
    "already-review clean low-risk items should be repairable without manual landing",
  );
  const task = await Task.findById(taskId);
  assert.equal(String((task as Record<string, unknown>).status), "archived");
});

test("reconcileWorkPackage auto-land: auto-landed item advances package to done via advanceWorkPackage", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "Auto-land advance to done",
    project: "test",
    projectPath: "/tmp/auto-land-advance",
    items: [{ title: "Only step", prompt: "do it", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'review')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);
  db.prepare("UPDATE work_packages SET status = 'running' WHERE _id = ?").run(pkg.id);

  // advanceWorkPackage calls reconcile internally; after auto-land the item is done
  // and rollup closes the package cleanly.
  const result = await advanceWorkPackage(pkg.id);

  assert.equal(result.package.items[0].status, "done", "auto-landed item is done");
  assert.equal(result.package.status, "done", "package closes as clean done once only item auto-lands");
  assert.ok(result.package.completedAt, "package has completedAt");
});

// ── shouldAutoLand — additional negative predicate cases (Task 5) ────────────
// Boundary tests: conditions that MUST block auto-land.
// All are RED until orchestrate.ts exports shouldAutoLand (Task 6).
// The mkLoop helper and shouldAutoLand capture are defined in the block above.

test("shouldAutoLand: structured NEEDS_PARENT_DECISION blocker → false (open child question must not auto-land)", () => {
  const parentBlocker = "NEEDS_PARENT_DECISION:" + JSON.stringify({
    ambiguity: "Which endpoint to call?",
    parentExcerpt: "",
    options: ["/api/v1", "/api/v2"],
    recommendedDefault: "/api/v1",
    confidence: 0.5,
  });
  const r = shouldAutoLand!({ risk: "low", blocker: parentBlocker, executionMode: "sequential" }, "review", null);
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /blocker/i);
});

test("shouldAutoLand: structured NEEDS_OPERATOR_DECISION blocker → false (escalated decision requires operator before landing)", () => {
  const operatorBlocker = "NEEDS_OPERATOR_DECISION:" + JSON.stringify({
    question: "Which payment provider?",
    options: ["Stripe", "PayPal"],
    recommendedDefault: "Stripe",
    ambiguity: "Product decision outside parent context",
  });
  const r = shouldAutoLand!({ risk: "low", blocker: operatorBlocker, executionMode: "sequential" }, "review", null);
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /blocker/i);
});

test("shouldAutoLand: medium risk + quality loop → false (risk overrides loop permissiveness)", () => {
  const r = shouldAutoLand!({ risk: "medium", blocker: null, executionMode: "sequential" }, "review", mkLoop("quality"));
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /medium/);
});

test("shouldAutoLand: high risk + quality loop → false (risk overrides loop permissiveness)", () => {
  const r = shouldAutoLand!({ risk: "high", blocker: null, executionMode: "sequential" }, "review", mkLoop("quality"));
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /high/);
});

test("shouldAutoLand: null actualTaskStatus → false (cannot confirm clean completion without task status)", () => {
  const r = shouldAutoLand!({ risk: "low", blocker: null, executionMode: "sequential" }, null, null);
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /status|task|complet/i);
});

test("shouldAutoLand: watch loop → false (watch profile monitors state for human interpretation, not auto-acceptance)", () => {
  const r = shouldAutoLand!({ risk: "low", blocker: null, executionMode: "sequential" }, "review", mkLoop("watch"));
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /watch|loop/i);
});

test("shouldAutoLand: personal_admin loop → false (admin decisions require explicit operator sign-off)", () => {
  const r = shouldAutoLand!({ risk: "low", blocker: null, executionMode: "sequential" }, "review", mkLoop("personal_admin"));
  assert.equal(r.autoLand, false);
  assert.match(r.reason, /admin|loop|sign/i);
});

// ── reconcileWorkPackage — manual-review retention guard tests (Task 5) ──────
// These integration tests define the BOUNDARY of auto-land: items that must
// NOT be auto-landed. Currently green (nothing auto-lands yet). Must stay green
// after Task 6's auto-land is implemented — they are the safety contract.

test("reconcileWorkPackage no-auto-land: medium-risk review item stays in review", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "No-auto-land medium risk",
    project: "test",
    projectPath: "/tmp/nal-medium",
    items: [{ title: "Medium step", prompt: "do it", risk: "medium", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'review')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(
    detail.items[0].status,
    "review",
    "medium-risk item must stay in review — operator judgment required for risky changes",
  );
});

test("reconcileWorkPackage no-auto-land: high-risk review item stays in review", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "No-auto-land high risk",
    project: "test",
    projectPath: "/tmp/nal-high",
    items: [{ title: "High-risk step", prompt: "do it", risk: "high", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'review')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(
    detail.items[0].status,
    "review",
    "high-risk item must stay in review — destructive/sensitive changes require explicit approval",
  );
});

test("reconcileWorkPackage no-auto-land: low-risk item with plain blocker stays in review", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "No-auto-land plain blocker",
    project: "test",
    projectPath: "/tmp/nal-plain-blocker",
    items: [{ title: "Blocked step", prompt: "do it", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'review')",
  ).run(taskId);
  db.prepare(
    "UPDATE work_package_items SET status = 'running', createdTaskId = ?, blocker = 'missing test coverage' WHERE _id = ?",
  ).run(taskId, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(
    detail.items[0].status,
    "review",
    "item with open blocker must stay in review — operator must resolve the issue before acceptance",
  );
});

test("reconcileWorkPackage no-auto-land: low-risk item with parent-decision blocker stays in review", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "No-auto-land parent-decision blocker",
    project: "test",
    projectPath: "/tmp/nal-parent-blocker",
    items: [{ title: "Ambiguous step", prompt: "do it", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  const parentBlocker = "NEEDS_PARENT_DECISION:" + JSON.stringify({
    ambiguity: "Which config file to update?",
    parentExcerpt: "",
    options: ["config.json", "config.ts"],
    recommendedDefault: "config.json",
    confidence: 0.4,
  });
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'review')",
  ).run(taskId);
  db.prepare(
    "UPDATE work_package_items SET status = 'running', createdTaskId = ?, blocker = ? WHERE _id = ?",
  ).run(taskId, parentBlocker, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(
    detail.items[0].status,
    "review",
    "item with parent-decision blocker must stay in review — unanswered question must be resolved first",
  );
});

test("reconcileWorkPackage no-auto-land: hold-mode item with review task stays in review", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "No-auto-land hold mode",
    project: "test",
    projectPath: "/tmp/nal-hold",
    items: [{ title: "Gated step", prompt: "do it", risk: "low", executionMode: "hold", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'review')",
  ).run(taskId);
  db.prepare(
    "UPDATE work_package_items SET status = 'running', createdTaskId = ?, executionMode = 'hold' WHERE _id = ?",
  ).run(taskId, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(
    detail.items[0].status,
    "review",
    "hold-mode (final-gated) item must stay in review — always requires explicit operator go-ahead",
  );
});

test("reconcileWorkPackage no-auto-land: needs_input task stays in review", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "No-auto-land needs_input",
    project: "test",
    projectPath: "/tmp/nal-needs-input",
    items: [{ title: "Waiting step", prompt: "do it", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'needs_input')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(
    detail.items[0].status,
    "review",
    "needs_input item must stay in review — agent is waiting for operator-supplied data",
  );
});

test("reconcileWorkPackage no-auto-land: review task with needs_input reviewState stays in review", async () => {
  const { generateId } = await import("@/lib/db");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "No-auto-land reviewState needs_input",
    project: "test",
    projectPath: "/tmp/nal-review-state-needs-input",
    items: [{ title: "Waiting approval step", prompt: "do it", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status, reviewState, output) VALUES (?, 'T', 'D', 'test', '/tmp', 'review', 'needs_input', ?)",
  ).run(taskId, JSON.stringify({ summary: "❓ Awaiting your reply:\n\nDoes this design look correct?" }));
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(
    detail.items[0].status,
    "review",
    "reviewState needs_input means the child is waiting for a reply and must not auto-land",
  );
  const task = await Task.findById(taskId);
  assert.equal(
    String((task as Record<string, unknown>).status),
    "review",
    "no-auto-land must leave the linked task in review instead of archiving it",
  );
  assert.equal(
    String((task as Record<string, unknown>).reviewState),
    "needs_input",
    "the operator-input review state is preserved",
  );
});

test("reconcileWorkPackage no-auto-land: release loop blocks auto-land for otherwise-clean low-risk item", async () => {
  const { generateId } = await import("@/lib/db");
  const { upsertLoop } = await import("./flight-loop-store");
  const db = getDb();
  const pkg = createWorkPackage({
    title: "No-auto-land release loop",
    project: "test",
    projectPath: "/tmp/nal-release-loop",
    items: [{ title: "Release step", prompt: "do it", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const item = pkg.items[0];
  const taskId = generateId();
  db.prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status) VALUES (?, 'T', 'D', 'test', '/tmp', 'review')",
  ).run(taskId);
  db.prepare("UPDATE work_package_items SET status = 'running', createdTaskId = ? WHERE _id = ?").run(taskId, item.id);
  upsertLoop(pkg.id, { mode: "manual", profile: "release", maxPasses: 3 });

  await reconcileWorkPackage(pkg.id);

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(
    detail.items[0].status,
    "review",
    "release loop must block auto-land — release items require explicit operator sign-off before landing",
  );
});
