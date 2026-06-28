import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-wp-store-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { _resetDbForTests, getDb } = await import("@/lib/db");
const {
  createWorkPackage,
  listWorkPackages,
  getWorkPackage,
  updateWorkPackage,
  updateWorkPackageItem,
  createTaskFromItem,
  deleteWorkPackage,
  findItemByTaskId,
} = await import("./store");
const { classifyIntake } = await import("@/lib/intake/classify");

test.before(() => { _resetDbForTests(); getDb(); });
test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

function broadIntake() {
  return classifyIntake({
    description: "Fix all the lint errors across the codebase, and then deploy the release.",
    project: "hivematrix",
    projectPath: "/Users/x/hivematrix",
  });
}

test("createWorkPackage persists a draft package with its items", () => {
  const intake = broadIntake();
  const pkg = createWorkPackage({
    title: "Cleanup sweep",
    description: "Fix all the lint errors and deploy.",
    project: "hivematrix",
    projectPath: "/Users/x/hivematrix",
    intake,
    items: intake.packageCandidate!.items,
  });
  assert.ok(pkg.id);
  assert.equal(pkg.status, "draft");
  assert.ok(pkg.items.length >= 2);
  // The release item is held (final-gated) and depends on an earlier item id.
  const held = pkg.items.find((i) => i.executionMode === "hold");
  assert.ok(held, "has a held release item");
  assert.ok(held!.dependsOn.length >= 1, "held item depends on prior item ids");
  // dependsOn was resolved from proposed titles to real item ids.
  const ids = new Set(pkg.items.map((i) => i.id));
  assert.ok(held!.dependsOn.every((d) => ids.has(d)), "dependsOn holds item ids, not titles");
});

test("list + get reflect the created package with item counts", () => {
  const intake = broadIntake();
  const pkg = createWorkPackage({ title: "Sweep 2", project: "hivematrix", projectPath: "/p", intake, items: intake.packageCandidate!.items });
  const all = listWorkPackages();
  assert.ok(all.some((p) => p.id === pkg.id));
  const detail = getWorkPackage(pkg.id);
  assert.ok(detail);
  assert.equal(detail!.items.length, pkg.items.length);
  // counts sum across statuses equals the item total (held release item + drafts).
  const total = Object.values(detail!.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, pkg.items.length);
});

test("updateWorkPackage + updateWorkPackageItem change status", () => {
  const intake = broadIntake();
  const pkg = createWorkPackage({ title: "Sweep 3", project: "hivematrix", projectPath: "/p", intake, items: intake.packageCandidate!.items });
  const up = updateWorkPackage(pkg.id, { status: "ready" });
  assert.equal(up!.status, "ready");
  const item = pkg.items[0];
  const ui = updateWorkPackageItem(pkg.id, item.id, { status: "held" });
  assert.equal(ui!.status, "held");
});

test("updateWorkPackageItem edits title and prompt while redacting secrets", () => {
  const intake = broadIntake();
  const pkg = createWorkPackage({ title: "Sweep edit", project: "hivematrix", projectPath: "/p", intake, items: intake.packageCandidate!.items });
  const item = pkg.items[0];

  const ui = updateWorkPackageItem(pkg.id, item.id, {
    title: "New title with token=SUPERSECRET123",
    prompt: "Use api_key=VERYSECRET456 in the prompt",
  });

  assert.ok(ui);
  assert.match(ui!.title, /New title/);
  assert.match(ui!.prompt, /Use/);
  assert.doesNotMatch(ui!.title + ui!.prompt, /SUPERSECRET123|VERYSECRET456/);

  const refreshed = getWorkPackage(pkg.id)!.items.find((i) => i.id === item.id)!;
  assert.equal(refreshed.title, ui!.title);
  assert.equal(refreshed.prompt, ui!.prompt);
});

test("deleteWorkPackage removes a non-running package and its items", () => {
  const intake = broadIntake();
  const pkg = createWorkPackage({ title: "Delete me", project: "hivematrix", projectPath: "/p", intake, items: intake.packageCandidate!.items });
  const beforeItems = (getDb().prepare("SELECT COUNT(*) AS n FROM work_package_items WHERE packageId = ?").get(pkg.id) as { n: number }).n;
  assert.ok(beforeItems > 0);

  const result = deleteWorkPackage(pkg.id);

  assert.deepEqual(result, { deleted: true });
  assert.equal(getWorkPackage(pkg.id), null);
  const afterItems = (getDb().prepare("SELECT COUNT(*) AS n FROM work_package_items WHERE packageId = ?").get(pkg.id) as { n: number }).n;
  assert.equal(afterItems, 0);
});

test("deleteWorkPackage refuses a package with running items", () => {
  const intake = broadIntake();
  const pkg = createWorkPackage({ title: "Do not delete", project: "hivematrix", projectPath: "/p", intake, items: intake.packageCandidate!.items });
  const item = pkg.items[0];
  updateWorkPackageItem(pkg.id, item.id, { status: "running" });

  const result = deleteWorkPackage(pkg.id);

  assert.ok(result);
  assert.equal(result.deleted, false);
  assert.match(result.reason || "", /running/i);
  assert.ok(getWorkPackage(pkg.id));
});

test("createTaskFromItem creates exactly one task and is idempotent", async () => {
  const intake = broadIntake();
  const pkg = createWorkPackage({ title: "Sweep 4", project: "hivematrix", projectPath: "/Users/x/hivematrix", intake, items: intake.packageCandidate!.items });
  const item = pkg.items[0];

  const before = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
  const r1 = await createTaskFromItem(pkg.id, item.id);
  assert.ok(r1.taskId, "returns a task id");
  const after = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
  assert.equal(after - before, 1, "creates exactly one task");

  // Idempotent: a second call returns the same task, creates no new one.
  const r2 = await createTaskFromItem(pkg.id, item.id);
  assert.equal(r2.taskId, r1.taskId);
  const after2 = (getDb().prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
  assert.equal(after2, after, "no second task is created");

  const refreshed = getWorkPackage(pkg.id)!.items.find((i) => i.id === item.id)!;
  assert.equal(refreshed.createdTaskId, r1.taskId);
});

test("findItemByTaskId maps a created task back to its package + item", async () => {
  const intake = broadIntake();
  const pkg = createWorkPackage({ title: "Sweep 5", project: "hivematrix", projectPath: "/Users/x/hivematrix", intake, items: intake.packageCandidate!.items });
  const item = pkg.items[0];
  const r = await createTaskFromItem(pkg.id, item.id);
  const found = findItemByTaskId(r.taskId);
  assert.ok(found);
  assert.equal(found!.packageId, pkg.id);
  assert.equal(found!.itemId, item.id);
  assert.equal(findItemByTaskId("nope-does-not-exist"), null);
});

// ── readyWorkPackage ──────────────────────────────────────────────────────────

test("readyWorkPackage auto-creates a self_paced quality loop when none exists", async () => {
  const { readyWorkPackage } = await import("./store");
  const { getLoop } = await import("./flight-loop-store");
  const pkg = createWorkPackage({
    title: "Auto-loop pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  assert.equal(pkg.status, "draft");
  assert.equal(getLoop(pkg.id), null, "no loop yet");

  const result = await readyWorkPackage(pkg.id);

  assert.ok(result, "readyWorkPackage returns the updated package");
  assert.equal(result!.status, "ready", "package status is ready");
  const loop = getLoop(pkg.id);
  assert.ok(loop, "loop was auto-created");
  assert.equal(loop!.mode, "self_paced");
  assert.equal(loop!.profile, "quality");
  assert.equal(loop!.maxPasses, 3);
  assert.equal(loop!.status, "idle");
  assert.equal(loop!.nextRunAt, null, "nextRunAt is null (event-driven, not immediate)");
  assert.equal(loop!.autoCreateItems, true);
  assert.equal(loop!.autoReadySafeItems, false);
});

test("readyWorkPackage does not create a second loop if one already exists", async () => {
  const { readyWorkPackage } = await import("./store");
  const { getLoop, upsertLoop } = await import("./flight-loop-store");
  const pkg = createWorkPackage({
    title: "Pre-loop pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  upsertLoop(pkg.id, { mode: "manual", profile: "quality", maxPasses: 5 });

  await readyWorkPackage(pkg.id);

  const loop = getLoop(pkg.id);
  assert.ok(loop, "loop still exists");
  assert.equal(loop!.mode, "manual", "existing loop is unchanged");
  assert.equal(loop!.maxPasses, 5, "existing loop maxPasses unchanged");
});

test("readyWorkPackage transitions package from draft to ready", async () => {
  const { readyWorkPackage } = await import("./store");
  const pkg = createWorkPackage({
    title: "Draft-to-ready pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  assert.equal(pkg.status, "draft");
  const result = await readyWorkPackage(pkg.id);
  assert.equal(result!.status, "ready");
});

test("readyWorkPackage sets expiresAt ~7 days from now (bounded loop)", async () => {
  const { readyWorkPackage } = await import("./store");
  const { getLoop } = await import("./flight-loop-store");
  const before = Date.now();
  const pkg = createWorkPackage({
    title: "Bounded-loop pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  await readyWorkPackage(pkg.id);
  const after = Date.now();
  const loop = getLoop(pkg.id)!;
  assert.ok(loop.expiresAt, "expiresAt must be set (loop is bounded)");
  const expiryMs = new Date(loop.expiresAt!).getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  assert.ok(expiryMs >= before + sevenDaysMs - 2000, "expiresAt is at least ~7 days from now");
  assert.ok(expiryMs <= after + sevenDaysMs + 2000, "expiresAt is at most ~7 days from now");
});

test("readyWorkPackage Goal Flight loop is also bounded with expiresAt ~7 days", async () => {
  const { readyWorkPackage } = await import("./store");
  const { getLoop } = await import("./flight-loop-store");
  const before = Date.now();
  const pkg = createWorkPackage({
    title: "Goal bounded-loop pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate",
      confidence: 0.85,
      reasons: ["broad outcome"],
      risk: "medium",
      suggestedMode: "split",
      goalFlight: { goal: "Build a thing", successCriteria: ["Thing is built"] },
    } as import("./store").GoalFlightIntake,
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  await readyWorkPackage(pkg.id);
  const after = Date.now();
  const loop = getLoop(pkg.id)!;
  assert.ok(loop.expiresAt, "Goal Flight loop must have expiresAt (bounded)");
  const expiryMs = new Date(loop.expiresAt!).getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  assert.ok(expiryMs >= before + sevenDaysMs - 2000, "expiresAt at least ~7 days out");
  assert.ok(expiryMs <= after + sevenDaysMs + 2000, "expiresAt at most ~7 days out");
});

test("readyWorkPackage is idempotent: calling twice creates exactly one loop with stable id", async () => {
  const { readyWorkPackage } = await import("./store");
  const { getLoop } = await import("./flight-loop-store");
  const pkg = createWorkPackage({
    title: "Double-ready pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  await readyWorkPackage(pkg.id);
  const loop1 = getLoop(pkg.id)!;
  assert.ok(loop1, "loop created on first call");
  await readyWorkPackage(pkg.id);
  const loop2 = getLoop(pkg.id)!;
  assert.equal(loop2.id, loop1.id, "second call preserves the same loop id");
  assert.equal(loop2.mode, loop1.mode, "mode unchanged");
  assert.equal(loop2.profile, loop1.profile, "profile unchanged");
  assert.equal(loop2.maxPasses, loop1.maxPasses, "maxPasses unchanged");
});

// ── Goal Flight metadata ──────────────────────────────────────────────────────

test("createWorkPackage preserves intake.goalFlight metadata through create/detail round-trip", () => {
  const pkg = createWorkPackage({
    title: "Goal Flight metadata pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate",
      confidence: 0.85,
      reasons: ["broad outcome prompt"],
      risk: "medium",
      suggestedMode: "split",
      goalFlight: {
        goal: "Build a web site to sell handmade goods online",
        successCriteria: ["Products are listed", "Checkout works", "Orders are stored"],
      },
    } as import("./store").GoalFlightIntake,
    items: [{ title: "Set up project", prompt: "scaffold the project", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });

  const detail = getWorkPackage(pkg.id)!;
  assert.ok(detail.intake.goalFlight, "goalFlight preserved in intake");
  const gf = detail.intake.goalFlight as Record<string, unknown>;
  assert.equal(gf.goal, "Build a web site to sell handmade goods online");
  assert.deepEqual(gf.successCriteria, ["Products are listed", "Checkout works", "Orders are stored"]);
});

test("readyWorkPackage uses goal_quality profile and 6 maxPasses when intake.goalFlight exists", async () => {
  const { readyWorkPackage } = await import("./store");
  const { getLoop } = await import("./flight-loop-store");
  const pkg = createWorkPackage({
    title: "Goal Flight auto-loop pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate",
      confidence: 0.85,
      reasons: ["broad outcome"],
      risk: "medium",
      suggestedMode: "split",
      goalFlight: {
        goal: "Create a marketplace",
        successCriteria: ["User can list items", "User can buy items"],
      },
    } as import("./store").GoalFlightIntake,
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });

  await readyWorkPackage(pkg.id);

  const loop = getLoop(pkg.id)!;
  assert.ok(loop, "loop was created");
  assert.equal(loop.profile, "goal_quality", "Goal Flight gets goal_quality profile");
  assert.equal(loop.maxPasses, 6, "Goal Flight gets 6 maxPasses");
  assert.equal(loop.mode, "self_paced");
  assert.equal(loop.autoCreateItems, true);
});

test("createWorkPackage with real classifyIntake goal flight result persists goalFlight end-to-end", () => {
  const intake = classifyIntake({
    title: "Online Handmade Goods Store",
    description: "Create a web site that lets artisans sell handmade goods, with product listings, cart, and Stripe checkout.",
    project: "hivematrix",
    projectPath: "/Users/x/hivematrix",
  });
  assert.ok(intake.goalFlight, "classifyIntake produces goalFlight for this prompt");

  const pkg = createWorkPackage({
    title: intake.packageCandidate?.title ?? "Online Handmade Goods Store",
    project: "hivematrix",
    projectPath: "/Users/x/hivematrix",
    intake,
    items: intake.packageCandidate!.items,
  });

  const detail = getWorkPackage(pkg.id)!;
  assert.ok(detail.intake.goalFlight, "goalFlight persisted via real classifyIntake");
  const gf = detail.intake.goalFlight as Record<string, unknown>;
  assert.equal(typeof gf.goal, "string", "goal is a string");
  assert.equal(gf.goal, "Online Handmade Goods Store", "goal equals the provided title");
  assert.ok(Array.isArray(gf.successCriteria), "successCriteria is an array");
  assert.ok((gf.successCriteria as string[]).length >= 1, "at least one criterion extracted");
});

test("readyWorkPackage on real classifyIntake goal flight package uses goal_quality profile", async () => {
  const { readyWorkPackage } = await import("./store");
  const { getLoop } = await import("./flight-loop-store");
  const intake = classifyIntake({
    description: "Build a SaaS platform for managing team schedules, with user auth, calendar views, and Slack notifications.",
    project: "hivematrix",
    projectPath: "/Users/x/hivematrix",
  });
  assert.ok(intake.goalFlight, "prompt classified as goal flight");

  const pkg = createWorkPackage({
    title: intake.packageCandidate?.title ?? "Team Schedule SaaS",
    project: "hivematrix",
    projectPath: "/Users/x/hivematrix",
    intake,
    items: intake.packageCandidate!.items,
  });

  await readyWorkPackage(pkg.id);

  const loop = getLoop(pkg.id)!;
  assert.ok(loop, "loop auto-created");
  assert.equal(loop.profile, "goal_quality", "real goal flight intake → goal_quality profile");
  assert.equal(loop.maxPasses, 6, "real goal flight → 6 maxPasses");
});

test("serialized package JSON carries no secrets", () => {
  const intake = classifyIntake({
    description: "Fix all the configs and update the api_key=SUPERSECRET123 everywhere, then deploy.",
    project: "hivematrix",
    projectPath: "/p",
  });
  const pkg = createWorkPackage({
    title: "Secrety sweep",
    description: "password=hunter2 should not survive",
    project: "hivematrix",
    projectPath: "/p",
    intake,
    items: intake.packageCandidate!.items,
  });
  const detail = getWorkPackage(pkg.id)!;
  const blob = JSON.stringify(detail) + JSON.stringify(listWorkPackages());
  assert.doesNotMatch(blob, /SUPERSECRET123|hunter2/);
});

// ── skippedCount semantics ────────────────────────────────────────────────────

test("getWorkPackage: skippedCount is 0 when all items are done", () => {
  const pkg = createWorkPackage({
    title: "All-done pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "B", prompt: "Do B", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  getDb().prepare("UPDATE work_package_items SET status = 'done' WHERE packageId = ?").run(pkg.id);
  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.skippedCount, 0, "no skips when all done");
});

test("getWorkPackage: skippedCount includes archived items", () => {
  const pkg = createWorkPackage({
    title: "Archived-skip pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "B", prompt: "Do B", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  getDb().prepare("UPDATE work_package_items SET status = 'done' WHERE _id = ?").run(pkg.items[0].id);
  getDb().prepare("UPDATE work_package_items SET status = 'archived' WHERE _id = ?").run(pkg.items[1].id);
  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.skippedCount, 1, "archived item counts as skipped");
});

test("getWorkPackage: skippedCount includes high-risk cancelled items", () => {
  const pkg = createWorkPackage({
    title: "HighRisk-cancel-skip pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "B", prompt: "Deploy", risk: "high", executionMode: "hold", dependsOn: [], scopeHints: [] },
    ],
  });
  getDb().prepare("UPDATE work_package_items SET status = 'done' WHERE _id = ?").run(pkg.items[0].id);
  getDb().prepare("UPDATE work_package_items SET status = 'cancelled', risk = 'high' WHERE _id = ?").run(pkg.items[1].id);
  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.skippedCount, 1, "high-risk cancelled item counts as skipped");
});

test("getWorkPackage: skippedCount excludes low-risk and medium-risk cancelled items", () => {
  const pkg = createWorkPackage({
    title: "LowMed-cancel pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "B", prompt: "Do B", risk: "medium", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  getDb().prepare("UPDATE work_package_items SET status = 'cancelled', risk = 'low' WHERE _id = ?").run(pkg.items[0].id);
  getDb().prepare("UPDATE work_package_items SET status = 'cancelled', risk = 'medium' WHERE _id = ?").run(pkg.items[1].id);
  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.skippedCount, 0, "low/medium cancelled items are not skipped scope");
});

// ── getWorkPackage diagnostic fields ─────────────────────────────────────────

test("getWorkPackage: items have taskStatus=null when no task linked", () => {
  const pkg = createWorkPackage({
    title: "TaskStatus-null pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.items[0].createdTaskId, null, "no linked task");
  assert.equal(detail.items[0].taskStatus, null, "taskStatus is null when no task linked");
});

test("getWorkPackage: items hydrate taskStatus from linked board task", async () => {
  const { createTaskFromItem } = await import("./store");
  const pkg = createWorkPackage({
    title: "TaskStatus-hydrate pkg",
    project: "test",
    projectPath: "/Users/x/hivematrix",
    items: [
      { title: "A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  const item = pkg.items[0];
  const { taskId } = await createTaskFromItem(pkg.id, item.id);
  // Linked task is created in assigned status; set it to in_progress to test hydration.
  getDb().prepare("UPDATE tasks SET status = 'in_progress' WHERE _id = ?").run(taskId);
  const detail = getWorkPackage(pkg.id)!;
  const refreshed = detail.items.find((i) => i.id === item.id)!;
  assert.equal(refreshed.createdTaskId, taskId, "createdTaskId still set");
  assert.equal(refreshed.taskStatus, "in_progress", "taskStatus reflects board task status");
});

test("getWorkPackage: failedCount and reviewCount match item statuses", () => {
  const pkg = createWorkPackage({
    title: "Count-check pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "B", prompt: "Do B", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "C", prompt: "Do C", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  getDb().prepare("UPDATE work_package_items SET status = 'failed' WHERE _id = ?").run(pkg.items[0].id);
  getDb().prepare("UPDATE work_package_items SET status = 'review' WHERE _id = ?").run(pkg.items[1].id);
  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.failedCount, 1, "failedCount matches items with status=failed");
  assert.equal(detail.reviewCount, 1, "reviewCount matches items with status=review");
  assert.equal(detail.counts.failed, 1, "counts.failed also set");
  assert.equal(detail.counts.review, 1, "counts.review also set");
});

test("getWorkPackage: loop is null when no loop configured", () => {
  const pkg = createWorkPackage({
    title: "No-loop pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.loop, null, "loop is null with no loop configured");
  assert.deepEqual(detail.recentPasses, [], "recentPasses is empty with no loop");
});

test("getWorkPackage: loop is inlined when loop exists", async () => {
  const { upsertLoop } = await import("./flight-loop-store");
  const pkg = createWorkPackage({
    title: "With-loop pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  upsertLoop(pkg.id, { mode: "manual", profile: "quality", maxPasses: 5 });
  const detail = getWorkPackage(pkg.id)!;
  assert.ok(detail.loop, "loop is present");
  assert.equal(detail.loop!.mode, "manual");
  assert.equal(detail.loop!.profile, "quality");
  assert.equal(detail.loop!.maxPasses, 5);
  assert.equal(detail.loop!.packageId, pkg.id);
  assert.deepEqual(detail.recentPasses, [], "no passes yet");
});

test("getWorkPackage: recentPasses summarises completed passes (newest-first)", async () => {
  const { upsertLoop, createPass, completePass } = await import("./flight-loop-store");
  const pkg = createWorkPackage({
    title: "With-passes pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const loop = upsertLoop(pkg.id, { mode: "manual", profile: "quality", maxPasses: 5 });
  const p1 = createPass(loop.id, pkg.id, "quality", 1);
  completePass(p1.id, {
    status: "completed",
    summary: "first pass summary",
    evidence: { state: "needs_follow_up", counts: { done: 0, failed: 1 } },
    createdItemIds: ["item-x"],
    stopReason: "no_actionable_follow_up",
  });
  const p2 = createPass(loop.id, pkg.id, "quality", 2);
  completePass(p2.id, {
    status: "completed",
    summary: "second pass summary",
    evidence: { state: "clean" },
    createdItemIds: [],
    stopReason: "all_checks_clean",
  });

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.recentPasses.length, 2, "both passes included");
  // Newest-first (passNumber 2 first).
  assert.equal(detail.recentPasses[0].passNumber, 2);
  assert.equal(detail.recentPasses[0].evidenceState, "clean");
  assert.equal(detail.recentPasses[0].stopReason, "all_checks_clean");
  assert.equal(detail.recentPasses[0].createdItemCount, 0);
  assert.equal(detail.recentPasses[1].passNumber, 1);
  assert.equal(detail.recentPasses[1].evidenceState, "needs_follow_up");
  assert.equal(detail.recentPasses[1].createdItemCount, 1);
  assert.equal(detail.recentPasses[1].summary, "first pass summary");
});

test("getWorkPackage: recentPasses exposes error on failed pass", async () => {
  const { upsertLoop, createPass, completePass } = await import("./flight-loop-store");
  const pkg = createWorkPackage({
    title: "Failed-pass pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  const loop = upsertLoop(pkg.id, { mode: "manual", profile: "quality", maxPasses: 3 });
  const p1 = createPass(loop.id, pkg.id, "quality", 1);
  completePass(p1.id, {
    status: "failed",
    summary: null,
    evidence: {},
    createdItemIds: [],
    stopReason: null,
    error: "typecheck crashed: exit 1",
  });

  const detail = getWorkPackage(pkg.id)!;
  assert.equal(detail.recentPasses.length, 1);
  assert.equal(detail.recentPasses[0].status, "failed");
  assert.equal(detail.recentPasses[0].error, "typecheck crashed: exit 1");
  assert.equal(detail.recentPasses[0].evidenceState, null, "no evidenceState on failed pass with empty evidence");
});
