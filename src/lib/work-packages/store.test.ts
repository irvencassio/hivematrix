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
