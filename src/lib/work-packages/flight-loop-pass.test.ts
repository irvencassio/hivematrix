import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "hivematrix-loop-pass-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { _resetDbForTests, getDb, generateId } = await import("@/lib/db");
const { createWorkPackage, getWorkPackage, updateWorkPackageItem } = await import("./store");
const { upsertLoop, getLoop, getLoopPasses, pauseLoop } = await import("./flight-loop-store");
const { runPass, classifyPassState, discoverRepoGates, runRepoGates } = await import("./flight-loop-pass");

test.before(() => { _resetDbForTests(); getDb(); });
test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

function makePackage(title: string) {
  return createWorkPackage({
    title,
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Item B", prompt: "Do B", risk: "medium", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
}

test("runPass rejects when no loop is configured", async () => {
  const pkg = makePackage("No-loop package");
  await assert.rejects(() => runPass(pkg.id), /no loop configured/);
});

test("runPass rejects when loop is stopped", async () => {
  const pkg = makePackage("Stopped-loop package");
  const loop = upsertLoop(pkg.id, { maxPasses: 1 });
  getDb().prepare("UPDATE flight_loops SET status = 'stopped', passCount = 1 WHERE _id = ?").run(loop.id);
  await assert.rejects(() => runPass(pkg.id), /loop is stopped/);
});

test("runPass rejects when loop is paused", async () => {
  const pkg = makePackage("Paused-loop package");
  upsertLoop(pkg.id, {});
  pauseLoop(pkg.id);
  await assert.rejects(() => runPass(pkg.id), /loop is paused/);
});

test("runPass rejects when max passes already reached", async () => {
  const pkg = makePackage("Max-pass package");
  const loop = upsertLoop(pkg.id, { maxPasses: 1 });
  getDb().prepare("UPDATE flight_loops SET passCount = 1 WHERE _id = ?").run(loop.id);
  await assert.rejects(() => runPass(pkg.id), /max passes reached/);
});

test("runPass rejects when loop has expired", async () => {
  const pkg = makePackage("Expired-loop package");
  const past = new Date(Date.now() - 1000).toISOString();
  upsertLoop(pkg.id, { expiresAt: past });
  await assert.rejects(() => runPass(pkg.id), /expired/);
});

test("runPass rejects concurrent second call while first is running", async () => {
  const pkg = makePackage("Concurrent package");
  upsertLoop(pkg.id, { maxPasses: 5 });
  // Mark loop as running to simulate an in-flight pass
  const loop = getLoop(pkg.id)!;
  getDb().prepare("UPDATE flight_loops SET status = 'running' WHERE _id = ?").run(loop.id);
  await assert.rejects(() => runPass(pkg.id), /already running/);
  // reset for future tests
  getDb().prepare("UPDATE flight_loops SET status = 'idle' WHERE _id = ?").run(loop.id);
});

test("runPass on all-draft package completes with no_actionable_follow_up stop", async () => {
  const pkg = makePackage("All-draft package");
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: true });

  const result = await runPass(pkg.id);

  assert.equal(result.pass.status, "completed");
  assert.equal(result.createdItemIds.length, 0, "draft items don't trigger follow-up");
  // No running/failed/review items → nothing actionable → loop stops
  assert.equal(result.pass.stopReason, "no_actionable_follow_up");
  assert.equal(result.loop.status, "stopped");
  assert.equal(result.loop.passCount, 1);
});

test("runPass creates draft follow-up items for failed items", async () => {
  const pkg = makePackage("Failed-item package");
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: true });

  // Force one item to failed status directly
  const itemA = pkg.items[0];
  updateWorkPackageItem(pkg.id, itemA.id, { status: "failed", blocker: "compile error" });

  const result = await runPass(pkg.id);

  assert.equal(result.pass.status, "completed");
  assert.equal(result.createdItemIds.length, 1, "one follow-up for the failed item");

  // The follow-up item must exist in the package with status 'draft'
  const detail = getWorkPackage(pkg.id)!;
  const followUp = detail.items.find((i) => result.createdItemIds.includes(i.id));
  assert.ok(followUp, "follow-up item exists in package");
  assert.equal(followUp!.status, "draft");
  assert.ok(followUp!.title.includes("Re-examine"), "title references re-examination");
  assert.ok(followUp!.prompt.includes("compile error"), "prompt includes blocker detail");

  // Evidence should list the failed item
  const evidence = result.pass.evidence as Record<string, unknown>;
  assert.ok(Array.isArray(evidence.failedItems));
  assert.equal((evidence.failedItems as unknown[]).length, 1);
});

test("runPass creates follow-up items for review items", async () => {
  const pkg = makePackage("Review-item package");
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: true });

  updateWorkPackageItem(pkg.id, pkg.items[1].id, { status: "review" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 1);
  const detail = getWorkPackage(pkg.id)!;
  const followUp = detail.items.find((i) => result.createdItemIds.includes(i.id));
  assert.ok(followUp!.prompt.includes("review"), "prompt mentions review");
});

test("runPass with autoCreateItems=false skips follow-up item creation", async () => {
  const pkg = makePackage("No-auto-create package");
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 0, "no items created when autoCreateItems=false");
});

test("runPass stops with all_checks_clean when all items are done", async () => {
  const pkg = makePackage("All-done package");
  upsertLoop(pkg.id, { maxPasses: 3 });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });
  updateWorkPackageItem(pkg.id, pkg.items[1].id, { status: "done" });

  const result = await runPass(pkg.id);

  assert.equal(result.pass.stopReason, "all_checks_clean");
  assert.equal(result.loop.status, "stopped");
  assert.equal(result.loop.stopReason, "all_checks_clean");
});

test("runPass stops with max_passes_reached on last allowed pass", async () => {
  const pkg = makePackage("Max-pass stop package");
  const loop = upsertLoop(pkg.id, { maxPasses: 1 });
  // passCount is 0 so next pass = 1 = maxPasses
  assert.equal(loop.passCount, 0);

  const result = await runPass(pkg.id);

  assert.equal(result.pass.stopReason, "max_passes_reached");
  assert.equal(result.loop.status, "stopped");
  assert.equal(result.loop.passCount, 1);
});

test("runPass stops with no_actionable_follow_up when items are in mixed non-active state", async () => {
  const pkg = makePackage("No-action package");
  upsertLoop(pkg.id, { maxPasses: 5, autoCreateItems: false });
  // All items in draft (not running, not failed, not review) → no follow-up possible
  // draft items won't trigger any action and nothing is running

  const result = await runPass(pkg.id);

  // With autoCreateItems=false and no failed/review/running items, stops
  assert.equal(result.pass.stopReason, "no_actionable_follow_up");
  assert.equal(result.loop.status, "stopped");
});

test("runPass increments passCount after each successful pass", async () => {
  const pkg = makePackage("Count-passes package");
  upsertLoop(pkg.id, { maxPasses: 5 });

  // First pass
  const r1 = await runPass(pkg.id);
  assert.equal(r1.loop.passCount, 1);

  // Second pass (if not stopped)
  if (r1.loop.status !== "stopped") {
    const r2 = await runPass(pkg.id);
    assert.equal(r2.loop.passCount, 2);
  }
});

test("runPass records are retrievable via getLoopPasses", async () => {
  const pkg = makePackage("Pass-history package");
  upsertLoop(pkg.id, { maxPasses: 5 });

  await runPass(pkg.id);
  const loop = getLoop(pkg.id)!;
  const passes = getLoopPasses(loop.id);
  assert.ok(passes.length >= 1);
  assert.equal(passes[0].loopId, loop.id);
  assert.ok(passes[0].summary, "summary is set");
});

test("runPass atomic lock rejects a second concurrent call via DB-level guard", async () => {
  const pkg = makePackage("Atomic-lock package");
  upsertLoop(pkg.id, { maxPasses: 5 });
  const loop = getLoop(pkg.id)!;

  // Directly set status to 'running' to simulate an in-flight pass acquired atomically.
  getDb().prepare("UPDATE flight_loops SET status = 'running' WHERE _id = ?").run(loop.id);

  // The atomic UPDATE will find status NOT IN ('idle', 'active') → changes=0 → throws.
  await assert.rejects(() => runPass(pkg.id), /already running/);

  // Restore for cleanup
  getDb().prepare("UPDATE flight_loops SET status = 'idle' WHERE _id = ?").run(loop.id);
});

test("runPass evidence includes git field when projectPath is a real git repo", async () => {
  // Use the hivematrix repo itself as a known git root.
  const repoPath = process.cwd();
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "Git-evidence package",
    project: "test",
    projectPath: repoPath,
    items: [
      { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { maxPasses: 3 });

  const result = await runPass(pkg.id);

  // The git field should be present if the repo root is a valid git repo
  const evidence = result.pass.evidence as Record<string, unknown>;
  if (evidence.git) {
    const git = evidence.git as Record<string, unknown>;
    assert.ok("status" in git, "git.status field present");
    assert.ok("diffStat" in git, "git.diffStat field present");
  }
  // The test doesn't require git to succeed (CI may not have git), just that it doesn't throw.
  assert.equal(result.pass.status, "completed");
});

test("runPass evidence includes taskOutput for failed item with linked task", async () => {
  const pkg = makePackage("TaskOutput package");
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: true });

  // Simulate a task that produced output and is linked to the item
  const taskId = generateId();
  const taskOutput = JSON.stringify({ summary: "compile failed: cannot find module 'foo'" });
  getDb().prepare(
    "INSERT INTO tasks (_id, title, description, project, projectPath, status, output) VALUES (?, 'Test task', 'desc', 'test', '/tmp', 'failed', ?)"
  ).run(taskId, taskOutput);

  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed", blocker: "compile error", createdTaskId: taskId });

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  const failed = evidence.failedItems as Array<{ taskOutput: string | null }>;
  assert.ok(Array.isArray(failed) && failed.length > 0, "failedItems present");
  assert.ok(failed[0].taskOutput?.includes("compile failed"), "task summary in evidence");

  // The follow-up item prompt should include the output note
  const followUp = getWorkPackage(pkg.id)!.items.find((i) => result.createdItemIds.includes(i.id));
  assert.ok(followUp, "follow-up item created");
  assert.ok(followUp!.prompt.includes("compile failed"), "task output in follow-up prompt");
});

test("runPass computes nextRunAt for fixed-cadence loop", async () => {
  const pkg = makePackage("Fixed-cadence package");
  // 5 passes, 60s cadence, autoCreateItems so it doesn't stop at no_actionable_follow_up
  upsertLoop(pkg.id, { maxPasses: 5, mode: "fixed", cadenceSeconds: 60, autoCreateItems: false });

  // Put an item in failed state so pass doesn't stop with no_actionable_follow_up
  // Actually with autoCreateItems=false and no failed items, it would stop.
  // Let's add a running item to prevent early stop.
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });

  const before = Date.now();
  const result = await runPass(pkg.id);
  const after = Date.now();

  if (result.loop.status !== "stopped") {
    assert.ok(result.loop.nextRunAt, "nextRunAt set for fixed mode");
    const nextRun = new Date(result.loop.nextRunAt!).getTime();
    assert.ok(nextRun >= before + 55_000, "nextRunAt is at least ~60s in the future");
    assert.ok(nextRun <= after + 65_000, "nextRunAt is not unreasonably far");
  }
});

// --- Risk-based follow-up status via runPass ---

test("runPass creates held follow-up for high-risk failed item", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "High-risk failed package",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Deploy prod", prompt: "Push release", risk: "high", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: true });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed", blocker: "auth error" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 1);
  const detail = getWorkPackage(pkg.id)!;
  const followUp = detail.items.find((i) => result.createdItemIds.includes(i.id))!;
  assert.equal(followUp.status, "held", "high-risk follow-up must be held for operator approval");
  assert.equal(followUp.risk, "high");
});

test("runPass creates ready follow-up for low-risk failed item when autoReadySafeItems=true", async () => {
  const pkg = makePackage("Low-risk auto-ready package");
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: true, autoReadySafeItems: true });
  // items[0] has risk: "low"
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed", blocker: "lint error" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 1);
  const detail = getWorkPackage(pkg.id)!;
  const followUp = detail.items.find((i) => result.createdItemIds.includes(i.id))!;
  assert.equal(followUp.status, "ready", "low-risk follow-up auto-promoted to ready");
});

test("runPass creates draft follow-up for low-risk failed item when autoReadySafeItems=false", async () => {
  const pkg = makePackage("Low-risk draft package");
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: true, autoReadySafeItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed", blocker: "test failure" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 1);
  const detail = getWorkPackage(pkg.id)!;
  const followUp = detail.items.find((i) => result.createdItemIds.includes(i.id))!;
  assert.equal(followUp.status, "draft");
});

// --- Observability tests ---

test("runPass evidence includes loopMode, passIndex, gatesDiscovered", async () => {
  const pkg = makePackage("Observability package");
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 5 });

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  assert.equal(evidence.loopMode, "self_paced", "evidence.loopMode matches loop mode");
  assert.equal(evidence.passIndex, 1, "evidence.passIndex is 1 for first pass");
  assert.ok(Array.isArray(evidence.gatesDiscovered), "evidence.gatesDiscovered is an array");
});

test("runPass evidence gatesDiscovered lists gate names from package.json even when gates are not run", async () => {
  const { mkdtempSync: mktmp, writeFileSync: wf, rmSync: rms } = await import("node:fs");
  const { tmpdir: tmp } = await import("node:os");
  const { join: pjoin } = await import("node:path");
  const dir = mktmp(pjoin(tmp(), "hm-obs-gates-"));
  try {
    wf(pjoin(dir, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc --noEmit", test: "node --test" } }));
    const { createWorkPackage: cwp } = await import("./store");
    const pkg2 = cwp({ title: "Gates-discovered pkg", project: "test", projectPath: dir, items: [
      { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ]});
    upsertLoop(pkg2.id, { maxPasses: 3 });
    const result = await runPass(pkg2.id);
    const evidence = result.pass.evidence as Record<string, unknown>;
    const discovered = evidence.gatesDiscovered as string[];
    assert.ok(discovered.includes("typecheck"), "typecheck in gatesDiscovered");
    assert.ok(discovered.includes("tests"), "tests in gatesDiscovered");
  } finally {
    rms(dir, { recursive: true, force: true });
  }
});

// --- classifyPassState unit tests (pure function) ---

test("classifyPassState: risky when held items exist", () => {
  assert.equal(classifyPassState({ counts: { held: 1, draft: 2 }, blockedItemCount: 0 }), "risky");
});

test("classifyPassState: risky takes priority over all other states", () => {
  assert.equal(
    classifyPassState({ counts: { held: 1, failed: 1, running: 1, review: 1 }, blockedItemCount: 1 }),
    "risky",
  );
});

test("classifyPassState: blocked when blockedItemCount > 0 and no held items", () => {
  assert.equal(classifyPassState({ counts: { draft: 2 }, blockedItemCount: 1 }), "blocked");
});

test("classifyPassState: blocked takes priority over needs_follow_up and running", () => {
  assert.equal(
    classifyPassState({ counts: { failed: 1, running: 1 }, blockedItemCount: 2 }),
    "blocked",
  );
});

test("classifyPassState: needs_follow_up for failed items", () => {
  assert.equal(classifyPassState({ counts: { failed: 1, done: 2 }, blockedItemCount: 0 }), "needs_follow_up");
});

test("classifyPassState: needs_follow_up for review items", () => {
  assert.equal(classifyPassState({ counts: { review: 1, done: 1 }, blockedItemCount: 0 }), "needs_follow_up");
});

test("classifyPassState: needs_follow_up for mixed failed+review", () => {
  assert.equal(
    classifyPassState({ counts: { failed: 2, review: 1, done: 1 }, blockedItemCount: 0 }),
    "needs_follow_up",
  );
});

test("classifyPassState: needs_follow_up takes priority over running", () => {
  assert.equal(
    classifyPassState({ counts: { failed: 1, running: 1 }, blockedItemCount: 0 }),
    "needs_follow_up",
  );
});

test("classifyPassState: running when running items and nothing urgent", () => {
  assert.equal(
    classifyPassState({ counts: { running: 1, draft: 1, done: 1 }, blockedItemCount: 0 }),
    "running",
  );
});

test("classifyPassState: clean for all-done package", () => {
  assert.equal(classifyPassState({ counts: { done: 3, cancelled: 1 }, blockedItemCount: 0 }), "clean");
});

test("classifyPassState: clean for draft-only package (nothing urgent)", () => {
  assert.equal(classifyPassState({ counts: { draft: 2 }, blockedItemCount: 0 }), "clean");
});

test("classifyPassState: clean for empty counts", () => {
  assert.equal(classifyPassState({ counts: {}, blockedItemCount: 0 }), "clean");
});

// --- Integration tests for new stop reasons ---

test("runPass stops with risky_action_held when held items exist", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "Risky-held package",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Deploy to prod", prompt: "Push release", risk: "high", executionMode: "hold", dependsOn: [], scopeHints: [] },
      { title: "Write docs", prompt: "Write docs", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { maxPasses: 3 });

  const result = await runPass(pkg.id);

  assert.equal(result.pass.stopReason, "risky_action_held");
  assert.equal(result.loop.status, "stopped");
  assert.equal(result.loop.stopReason, "risky_action_held");
});

test("runPass stops with waiting_for_approval when non-terminal items have blockers", async () => {
  const pkg = makePackage("Blocked-item package");
  upsertLoop(pkg.id, { maxPasses: 3 });
  // ready + blocker = blocked (not failed, not held)
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "ready", blocker: "waiting for concurrent writer to finish" });

  const result = await runPass(pkg.id);

  assert.equal(result.pass.stopReason, "waiting_for_approval");
  assert.equal(result.loop.status, "stopped");
  assert.equal(result.loop.stopReason, "waiting_for_approval");
});

test("runPass evidence includes state classification and blockedItemCount", async () => {
  const pkg = makePackage("State-evidence package");
  upsertLoop(pkg.id, { maxPasses: 3 });

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  assert.ok("state" in evidence, "evidence.state is present");
  const validStates = ["clean", "needs_follow_up", "blocked", "risky", "running"];
  assert.ok(validStates.includes(evidence.state as string), `evidence.state is a valid classification (got: ${evidence.state})`);
  assert.ok("blockedItemCount" in evidence, "evidence.blockedItemCount is present");
  assert.equal(typeof evidence.blockedItemCount, "number");
});

// --- discoverRepoGates ---

test("discoverRepoGates: returns empty array for missing or gateless directory", () => {
  assert.deepEqual(discoverRepoGates(""), []);
  assert.deepEqual(discoverRepoGates("/tmp/nonexistent-dir-xyz"), []);
});

test("discoverRepoGates: discovers typecheck gate from package.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-gates-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      scripts: { typecheck: "tsc --noEmit" },
    }));
    const gates = discoverRepoGates(dir);
    const names = gates.map((g) => g.name);
    assert.ok(names.includes("typecheck"), "typecheck gate discovered");
    const tc = gates.find((g) => g.name === "typecheck")!;
    assert.equal(tc.command, "npm");
    assert.deepEqual(tc.args, ["run", "typecheck"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverRepoGates: discovers tests gate from package.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-gates-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      scripts: { test: "node --test" },
    }));
    const gates = discoverRepoGates(dir);
    assert.ok(gates.some((g) => g.name === "tests"), "tests gate discovered");
    const t = gates.find((g) => g.name === "tests")!;
    assert.equal(t.command, "npm");
    assert.deepEqual(t.args, ["test"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverRepoGates: discovers scope-wall gate when scripts/scope-wall.mjs exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-gates-"));
  try {
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "scope-wall.mjs"), "// wall");
    const gates = discoverRepoGates(dir);
    assert.ok(gates.some((g) => g.name === "scope-wall"), "scope-wall gate discovered");
    const sw = gates.find((g) => g.name === "scope-wall")!;
    assert.equal(sw.command, "node");
    assert.deepEqual(sw.args, ["scripts/scope-wall.mjs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverRepoGates: discovers all three gates when all are present", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-gates-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      scripts: { typecheck: "tsc --noEmit", test: "node --test" },
    }));
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "scope-wall.mjs"), "// wall");
    const names = discoverRepoGates(dir).map((g) => g.name);
    assert.ok(names.includes("typecheck"));
    assert.ok(names.includes("tests"));
    assert.ok(names.includes("scope-wall"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverRepoGates: ignores malformed package.json gracefully", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-gates-"));
  try {
    writeFileSync(join(dir, "package.json"), "{ not valid json }");
    assert.doesNotThrow(() => discoverRepoGates(dir));
    assert.deepEqual(discoverRepoGates(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- runRepoGates ---

test("runRepoGates: passing command returns passed=true and output", () => {
  const results = runRepoGates("/tmp", [
    { name: "node-version", command: "node", args: ["--version"] },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].passed, true);
  assert.equal(results[0].exitCode, 0);
  assert.ok(results[0].output.length > 0, "output captured");
  assert.ok(results[0].durationMs >= 0);
});

test("runRepoGates: failing command returns passed=false with output", () => {
  const results = runRepoGates("/tmp", [
    { name: "fail-gate", command: "node", args: ["-e", "process.stderr.write('err msg'); process.exit(1)"] },
  ]);
  assert.equal(results[0].passed, false);
  assert.equal(results[0].exitCode, 1);
  assert.ok(results[0].output.includes("err msg"), "stderr captured in output");
});

test("runRepoGates: empty gates array returns empty array", () => {
  assert.deepEqual(runRepoGates("/tmp", []), []);
});

test("runRepoGates: unknown command returns passed=false gracefully", () => {
  const results = runRepoGates("/tmp", [
    { name: "no-such-cmd", command: "this-command-does-not-exist-xyz", args: [] },
  ]);
  assert.equal(results[0].passed, false);
  assert.equal(results[0].exitCode, null);
});

// --- runPass gate integration ---

test("runPass evidence includes gates field when gates are discovered", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-gate-pass-"));
  try {
    // A minimal package.json with a fast-passing test script using node -e.
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      scripts: { typecheck: "node -e \"process.exit(0)\"" },
    }));
    const pkg = createWorkPackage({
      title: "Gate-evidence package",
      project: "test",
      projectPath: dir,
      items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
    });
    upsertLoop(pkg.id, { maxPasses: 3 });

    const result = await runPass(pkg.id);

    const evidence = result.pass.evidence as Record<string, unknown>;
    assert.ok("gates" in evidence, "evidence.gates present");
    const gates = evidence.gates as Array<{ name: string; passed: boolean }>;
    assert.ok(Array.isArray(gates) && gates.length > 0, "at least one gate result");
    assert.ok(gates.some((g) => g.name === "typecheck"), "typecheck gate in results");
    assert.equal(result.pass.status, "completed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runPass creates gate follow-up items when a gate fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-gate-fail-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      scripts: { typecheck: "node -e \"process.exit(1)\"" },
    }));
    const pkg = createWorkPackage({
      title: "Gate-fail package",
      project: "test",
      projectPath: dir,
      items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
    });
    upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: true });

    const result = await runPass(pkg.id);

    assert.ok(result.createdItemIds.length > 0, "at least one follow-up item from failing gate");
    const detail = getWorkPackage(pkg.id)!;
    const gateItem = detail.items.find((i) => result.createdItemIds.includes(i.id))!;
    assert.ok(gateItem, "gate follow-up item exists in package");
    assert.ok(gateItem.title.includes("typecheck"), "title references failing gate");
    assert.equal(gateItem.status, "draft");
    assert.equal(gateItem.risk, "low");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runPass: all_checks_clean requires both items done AND gates passing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-gate-clean-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      scripts: { typecheck: "node -e \"process.exit(0)\"" },
    }));
    const pkg = createWorkPackage({
      title: "All-clean package",
      project: "test",
      projectPath: dir,
      items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
    });
    upsertLoop(pkg.id, { maxPasses: 3 });
    updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

    const result = await runPass(pkg.id);

    assert.equal(result.pass.stopReason, "all_checks_clean");
    assert.equal(result.loop.status, "stopped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runPass: failing gate prevents all_checks_clean even if items are done", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-gate-prevent-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      scripts: { typecheck: "node -e \"process.exit(1)\"" },
    }));
    const pkg = createWorkPackage({
      title: "Items-done-gate-fail package",
      project: "test",
      projectPath: dir,
      items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
    });
    upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: true });
    updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

    const result = await runPass(pkg.id);

    assert.notEqual(result.pass.stopReason, "all_checks_clean", "should not be clean when gate fails");
    assert.ok(result.createdItemIds.length > 0, "gate follow-up item created");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Max pass limit: two-pass boundary sequence ---

test("max pass limit: two-pass sequence reaches limit then pre-rejects on third call", async () => {
  const pkg = makePackage("Two-pass-limit package");
  upsertLoop(pkg.id, { maxPasses: 2, autoCreateItems: false });
  // Running item keeps state=running so pass 1 does not early-stop.
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });

  const r1 = await runPass(pkg.id);
  assert.equal(r1.loop.passCount, 1, "pass 1 increments count to 1");
  assert.notEqual(r1.pass.stopReason, "max_passes_reached", "pass 1 does not hit limit (newPassCount=1 < maxPasses=2)");
  assert.equal(r1.loop.status, "idle", "loop continues after pass 1");

  const r2 = await runPass(pkg.id);
  assert.equal(r2.loop.passCount, 2, "pass 2 increments count to 2");
  assert.equal(r2.pass.stopReason, "max_passes_reached", "pass 2 reaches the limit (newPassCount=2 == maxPasses=2)");
  assert.equal(r2.loop.status, "stopped", "loop stopped after hitting max");

  // Third call: loop is now stopped, rejects with "loop is stopped"
  await assert.rejects(() => runPass(pkg.id), /loop is stopped/);
});

// --- Non-overlapping passes: concurrent lock test ---

// --- Skipped pass tests ---

test("runPass writes a skipped pass when Flight is held", async () => {
  const { getDb: gdb } = await import("@/lib/db");
  const pkg = createWorkPackage({
    title: "Held-flight skip package",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  gdb().prepare("UPDATE work_packages SET status = 'held' WHERE _id = ?").run(pkg.id);
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 3 });

  const result = await runPass(pkg.id);

  assert.equal(result.pass.status, "skipped", "pass status is 'skipped'");
  assert.equal(result.pass.stopReason, "skipped_flight_not_ready");
  const loop = getLoop(pkg.id)!;
  assert.equal(loop.passCount, 0, "passCount stays at 0 after skip");
});

test("runPass writes a skipped pass when Flight is in review", async () => {
  const { getDb: gdb } = await import("@/lib/db");
  const pkg = createWorkPackage({
    title: "Review-flight skip package",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  gdb().prepare("UPDATE work_packages SET status = 'review' WHERE _id = ?").run(pkg.id);
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 3 });

  const result = await runPass(pkg.id);

  assert.equal(result.pass.status, "skipped");
  assert.equal(result.pass.stopReason, "skipped_flight_not_ready");
  const loop = getLoop(pkg.id)!;
  assert.equal(loop.passCount, 0);
});

test("skipped pass does not count toward maxPasses", async () => {
  const { getDb: gdb } = await import("@/lib/db");
  const pkg = createWorkPackage({
    title: "Skip-maxpass package",
    project: "test",
    projectPath: "/tmp/test",
    items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
  });
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 1 });

  gdb().prepare("UPDATE work_packages SET status = 'held' WHERE _id = ?").run(pkg.id);
  const skipped = await runPass(pkg.id);
  assert.equal(skipped.pass.status, "skipped");
  assert.equal(getLoop(pkg.id)!.passCount, 0, "passCount still 0 after skip");

  gdb().prepare("UPDATE work_packages SET status = 'running' WHERE _id = ?").run(pkg.id);
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });
  const real = await runPass(pkg.id);
  assert.equal(real.pass.status, "completed", "real pass succeeds despite prior skip");
  assert.equal(getLoop(pkg.id)!.passCount, 1, "passCount is 1 after one real pass");
});

// --- Profile strategy tests ---

test("release profile: pass fails when mandatory typecheck gate is missing", async () => {
  const { mkdtempSync: mktmp, rmSync: rms } = await import("node:fs");
  const { tmpdir: tmp } = await import("node:os");
  const { join: pjoin } = await import("node:path");
  const dir = mktmp(pjoin(tmp(), "hm-release-nogate-"));
  try {
    // No package.json → no typecheck gate
    const { createWorkPackage: cwp } = await import("./store");
    const pkg = cwp({ title: "Release-nogate pkg", project: "test", projectPath: dir, items: [
      { title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
    ]});
    upsertLoop(pkg.id, { maxPasses: 3, profile: "release" });

    const result = await runPass(pkg.id);

    assert.equal(result.pass.status, "failed", "release pass fails when gates are missing");
    assert.equal(result.pass.stopReason, "release_gate_missing");
    assert.equal(result.loop.status, "stopped", "loop stopped on release gate missing");
  } finally {
    rms(dir, { recursive: true, force: true });
  }
});

test("watch profile creates no follow-up items even when autoCreateItems=true", async () => {
  const pkg = makePackage("Watch-profile package");
  upsertLoop(pkg.id, { maxPasses: 5, profile: "watch", autoCreateItems: true });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 0, "watch profile creates no follow-up items");
  const evidence = result.pass.evidence as Record<string, unknown>;
  assert.ok(Array.isArray(evidence.externalChecks), "watch evidence has externalChecks array");
  assert.equal(result.pass.stopReason, "no_active_items_to_watch", "watch stops when no running/ready items");
});

test("personal_admin profile creates held items for high-risk failed items", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({ title: "Personal-admin high-risk pkg", project: "test", projectPath: "/tmp/test", items: [
    { title: "Deploy to prod", prompt: "Push release", risk: "high", executionMode: "sequential", dependsOn: [], scopeHints: [] },
  ]});
  upsertLoop(pkg.id, { maxPasses: 3, profile: "personal_admin", autoCreateItems: true });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed", blocker: "auth error" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 1, "one follow-up created");
  const detail = getWorkPackage(pkg.id)!;
  const followUp = detail.items.find((i) => result.createdItemIds.includes(i.id))!;
  assert.equal(followUp.status, "held", "personal_admin holds high-risk items for operator approval");
  const evidence = result.pass.evidence as Record<string, unknown>;
  assert.equal(typeof evidence.pendingApprovals, "number", "personal_admin evidence has pendingApprovals count");
});

// --- Archived item evidence tests ---

test("runPass evidence includes archivedCount and archivedItems for archived items", async () => {
  const pkg = makePackage("Archived-evidence package");
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: true });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });
  updateWorkPackageItem(pkg.id, pkg.items[1].id, { status: "archived" });

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  assert.equal(evidence.archivedCount, 1, "evidence.archivedCount is 1");
  assert.ok(Array.isArray(evidence.archivedItems), "evidence.archivedItems is an array");
  assert.equal((evidence.archivedItems as unknown[]).length, 1, "one archived item");
  const archived = (evidence.archivedItems as Array<{ id: string; title: string }>)[0];
  assert.ok(archived.id, "archived item has id");
  assert.ok(archived.title, "archived item has title");
  assert.equal(result.pass.stopReason, "all_checks_clean", "all terminal → all_checks_clean");
});

test("runPass summary includes archived count when archived items present", async () => {
  const pkg = makePackage("Archived-summary package");
  upsertLoop(pkg.id, { maxPasses: 3 });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });
  updateWorkPackageItem(pkg.id, pkg.items[1].id, { status: "archived" });

  const result = await runPass(pkg.id);

  assert.ok(result.pass.summary?.includes("archived"), "summary mentions archived count");
});

test("classifyPassState: clean for a Flight with only archived and done items", () => {
  assert.equal(
    classifyPassState({ counts: { done: 2, archived: 1 }, blockedItemCount: 0 }),
    "clean",
    "archived items do not make state risky/blocked/needs_follow_up"
  );
});

// --- Goal Flight pass evidence tests ---

test("goal_quality pass includes goal and successCriteria from intake.goalFlight in evidence", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "Goal-evidence pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate" as const,
      confidence: 0.85,
      reasons: ["broad outcome"],
      risk: "medium" as const,
      suggestedMode: "split" as const,
      goalFlight: {
        goal: "Build an online store",
        successCriteria: ["Catalogue browsable", "Cart functional", "Checkout completes"],
      },
    },
    items: [{ title: "Item A", prompt: "Do A", risk: "low" as const, executionMode: "sequential" as const, dependsOn: [], scopeHints: [] }],
  });
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 6, profile: "goal_quality" });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  assert.equal(evidence.goal, "Build an online store", "evidence.goal from intake.goalFlight");
  assert.deepEqual(evidence.successCriteria, ["Catalogue browsable", "Cart functional", "Checkout completes"]);
});

test("two concurrent runPass calls: exactly one acquires the lock, other is rejected", async () => {
  const pkg = makePackage("Concurrent-lock package");
  upsertLoop(pkg.id, { maxPasses: 5, autoCreateItems: false });
  // Running item prevents no_actionable_follow_up early stop.
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });

  // Fire both calls in the same microtask batch. The first runs synchronously
  // to the lock acquisition before yielding at reconcileWorkPackage; the second
  // then hits the atomic UPDATE WHERE status IN ('idle','active') which finds
  // status='running' and returns changes=0 → throws "already running".
  const [r1, r2] = await Promise.allSettled([runPass(pkg.id), runPass(pkg.id)]);

  const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
  const rejected = [r1, r2].filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1, "exactly one pass acquires the lock");
  assert.equal(rejected.length, 1, "exactly one pass is rejected");

  const reason = (rejected[0] as PromiseRejectedResult).reason as Error;
  assert.ok(/already running/i.test(reason.message), `rejected with 'already running', got: ${reason.message}`);

  const loop = getLoop(pkg.id)!;
  assert.notEqual(loop.status, "running", "loop not stuck in 'running' after both settle");
});

// --- High-risk cancelled item semantics in passes ---

test("runPass: high-risk cancelled items appear in evidence as cancelledHighRiskCount and cancelledHighRiskItems", async () => {
  const pkg = createWorkPackage({
    title: "Cancelled-high-risk evidence pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Safe step", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Risky deploy", prompt: "Deploy", risk: "high", executionMode: "hold", dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: false });
  // Operator marks the safe step done and intentionally cancels the high-risk action.
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });
  updateWorkPackageItem(pkg.id, pkg.items[1].id, { status: "cancelled" });
  // Ensure risk=high is persisted (hold items start as held, we're simulating operator cancel).
  getDb().prepare("UPDATE work_package_items SET risk = 'high' WHERE _id = ?").run(pkg.items[1].id);

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  assert.equal(evidence.cancelledHighRiskCount, 1, "evidence reports 1 cancelled high-risk item");
  const items = evidence.cancelledHighRiskItems as Array<{ id: string; title: string }>;
  assert.ok(Array.isArray(items), "cancelledHighRiskItems is an array");
  assert.equal(items.length, 1, "one cancelled high-risk item");
  assert.equal(items[0].title, "Risky deploy");
});

test("runPass: summary includes 'high-risk skipped' when high-risk items are cancelled", async () => {
  const pkg = createWorkPackage({
    title: "Cancelled-high-risk summary pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Safe step", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Risky deploy", prompt: "Deploy", risk: "high", executionMode: "hold", dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });
  updateWorkPackageItem(pkg.id, pkg.items[1].id, { status: "cancelled" });
  getDb().prepare("UPDATE work_package_items SET risk = 'high' WHERE _id = ?").run(pkg.items[1].id);

  const result = await runPass(pkg.id);

  assert.ok(result.pass.summary?.includes("high-risk skipped"), `summary should mention 'high-risk skipped', got: "${result.pass.summary}"`);
});

// --- Goal Flight success criteria follow-up and evidence tests ---

test("goal_quality evidence.criteriaStatus: met when done item title contains criterion text", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "Criteria-match pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate" as const,
      confidence: 0.9,
      reasons: ["broad outcome"],
      risk: "medium" as const,
      suggestedMode: "split" as const,
      goalFlight: {
        goal: "Build a store",
        successCriteria: ["Build checkout", "Add payment"],
      },
    },
    items: [
      { title: "Build checkout page", prompt: "Create checkout UI", risk: "low" as const, executionMode: "sequential" as const, dependsOn: [], scopeHints: [] },
      { title: "Miscellaneous task", prompt: "Do something else", risk: "low" as const, executionMode: "sequential" as const, dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 6, profile: "goal_quality", autoCreateItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  const cs = evidence.criteriaStatus as Array<{ criterion: string; status: string }>;
  assert.ok(Array.isArray(cs), "criteriaStatus is an array");
  assert.equal(cs.length, 2, "one entry per criterion");
  const checkout = cs.find((c) => c.criterion === "Build checkout")!;
  const payment = cs.find((c) => c.criterion === "Add payment")!;
  assert.equal(checkout.status, "met", "Build checkout is met (done item title contains it)");
  assert.equal(payment.status, "unmet", "Add payment is unmet (no matching item)");
});

test("goal_quality evidence.criteriaStatus: in_progress when matching item is not done", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "Criteria-inprogress pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate" as const,
      confidence: 0.9,
      reasons: ["broad outcome"],
      risk: "medium" as const,
      suggestedMode: "split" as const,
      goalFlight: {
        goal: "Build a store",
        successCriteria: ["Add payment gateway"],
      },
    },
    items: [
      { title: "Add payment gateway", prompt: "Integrate Stripe", risk: "low" as const, executionMode: "sequential" as const, dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 6, profile: "goal_quality", autoCreateItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  const cs = evidence.criteriaStatus as Array<{ criterion: string; status: string }>;
  assert.ok(Array.isArray(cs), "criteriaStatus is an array");
  assert.equal(cs[0].status, "in_progress", "criterion is in_progress when matching item is running");
});

test("goal_quality evidence has no criteriaStatus when successCriteria is empty", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "No-criteria pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate" as const,
      confidence: 0.9,
      reasons: ["broad outcome"],
      risk: "medium" as const,
      suggestedMode: "split" as const,
      goalFlight: { goal: "Build a store", successCriteria: [] },
    },
    items: [
      { title: "Item A", prompt: "Do A", risk: "low" as const, executionMode: "sequential" as const, dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 6, profile: "goal_quality", autoCreateItems: false });

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  assert.ok(!("criteriaStatus" in evidence), "criteriaStatus absent when successCriteria is empty");
});

test("goal_quality creates follow-up items for unmet criteria when autoCreateItems=true", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "Criteria-followup pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate" as const,
      confidence: 0.9,
      reasons: ["broad outcome"],
      risk: "medium" as const,
      suggestedMode: "split" as const,
      goalFlight: {
        goal: "Build a store",
        successCriteria: ["Build checkout", "Send notifications"],
      },
    },
    items: [
      { title: "Build checkout page", prompt: "Create checkout", risk: "low" as const, executionMode: "sequential" as const, dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 6, profile: "goal_quality", autoCreateItems: true });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

  const result = await runPass(pkg.id);

  assert.ok(result.createdItemIds.length >= 1, "at least one follow-up created for unmet criterion");
  const detail = getWorkPackage(pkg.id)!;
  const criterionItem = detail.items.find((i) => result.createdItemIds.includes(i.id) && i.title.includes("Send notifications"))!;
  assert.ok(criterionItem, "follow-up item for unmet criterion 'Send notifications' exists");
  assert.ok(criterionItem.title.includes("Send notifications"), "title references the unmet criterion");
  assert.ok(criterionItem.prompt.includes("Send notifications"), "prompt references the unmet criterion");
});

test("goal_quality does not create follow-up for in-progress criterion", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "Criteria-inprogress-nofollowup pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate" as const,
      confidence: 0.9,
      reasons: ["broad outcome"],
      risk: "medium" as const,
      suggestedMode: "split" as const,
      goalFlight: {
        goal: "Build a store",
        successCriteria: ["Add payment gateway"],
      },
    },
    items: [
      { title: "Add payment gateway", prompt: "Integrate Stripe", risk: "low" as const, executionMode: "sequential" as const, dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 6, profile: "goal_quality", autoCreateItems: true });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 0, "no follow-up created when criterion is in_progress");
});

test("goal_quality does not create criterion follow-ups when autoCreateItems=false", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "Criteria-no-auto-create pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate" as const,
      confidence: 0.9,
      reasons: ["broad outcome"],
      risk: "medium" as const,
      suggestedMode: "split" as const,
      goalFlight: {
        goal: "Build a store",
        successCriteria: ["Build checkout", "Send notifications"],
      },
    },
    items: [
      { title: "Build checkout page", prompt: "Create checkout", risk: "low" as const, executionMode: "sequential" as const, dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 6, profile: "goal_quality", autoCreateItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 0, "no criterion follow-ups when autoCreateItems=false");
});

test("goal_quality pass summary includes criteria met count", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "Criteria-summary pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate" as const,
      confidence: 0.9,
      reasons: ["broad outcome"],
      risk: "medium" as const,
      suggestedMode: "split" as const,
      goalFlight: {
        goal: "Build a store",
        successCriteria: ["Build checkout", "Add payment", "Send notifications"],
      },
    },
    items: [
      { title: "Build checkout page", prompt: "Create checkout", risk: "low" as const, executionMode: "sequential" as const, dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 6, profile: "goal_quality", autoCreateItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

  const result = await runPass(pkg.id);

  assert.ok(result.pass.summary?.includes("criteria"), `summary should mention 'criteria', got: "${result.pass.summary}"`);
});

test("goal_quality unmet criteria with autoCreateItems=true prevent all_checks_clean", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({
    title: "Criteria-prevent-clean pkg",
    project: "test",
    projectPath: "/tmp/test",
    intake: {
      kind: "work_package_candidate" as const,
      confidence: 0.9,
      reasons: ["broad outcome"],
      risk: "medium" as const,
      suggestedMode: "split" as const,
      goalFlight: {
        goal: "Build a store",
        successCriteria: ["Build checkout", "Send notifications"],
      },
    },
    items: [
      { title: "Build checkout page", prompt: "Create checkout", risk: "low" as const, executionMode: "sequential" as const, dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { mode: "self_paced", maxPasses: 6, profile: "goal_quality", autoCreateItems: true });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

  const result = await runPass(pkg.id);

  assert.notEqual(result.pass.stopReason, "all_checks_clean", "all_checks_clean should not fire when criterion follow-ups were created");
  assert.ok(result.createdItemIds.length > 0, "criterion follow-up items created");
});

// --- Release profile artifact evidence ---

test("release profile: evidence includes releaseArtifacts with releaseScriptExists, packageVersion, gitTagAtHead", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-release-artifacts-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      version: "1.2.3",
      scripts: { typecheck: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" },
    }));
    const pkg = createWorkPackage({
      title: "Release-artifacts pkg",
      project: "test",
      projectPath: dir,
      items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
    });
    upsertLoop(pkg.id, { maxPasses: 3, profile: "release" });
    updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

    const result = await runPass(pkg.id);

    const evidence = result.pass.evidence as Record<string, unknown>;
    assert.ok("releaseArtifacts" in evidence, "evidence.releaseArtifacts present for release profile");
    const ra = evidence.releaseArtifacts as Record<string, unknown>;
    assert.equal(ra.packageVersion, "1.2.3", "packageVersion read from package.json");
    assert.equal(ra.releaseScriptExists, false, "releaseScriptExists false when no release script present");
    assert.ok(ra.gitTagAtHead === null || typeof ra.gitTagAtHead === "string", "gitTagAtHead is string or null");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release profile: releaseScriptExists true when scripts/developer-id-release.sh is present", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-release-script-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      scripts: { typecheck: "node -e \"process.exit(0)\"" },
    }));
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "developer-id-release.sh"), "# release");
    const pkg = createWorkPackage({
      title: "Release-mjs pkg",
      project: "test",
      projectPath: dir,
      items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
    });
    upsertLoop(pkg.id, { maxPasses: 3, profile: "release" });
    updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

    const result = await runPass(pkg.id);

    const evidence = result.pass.evidence as Record<string, unknown>;
    const ra = evidence.releaseArtifacts as Record<string, unknown>;
    assert.equal(ra.releaseScriptExists, true, "releaseScriptExists true when scripts/developer-id-release.sh is present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release profile: evidence does NOT include releaseArtifacts for quality profile", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-quality-no-ra-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      scripts: { typecheck: "node -e \"process.exit(0)\"" },
    }));
    const pkg = createWorkPackage({
      title: "Quality-no-artifacts pkg",
      project: "test",
      projectPath: dir,
      items: [{ title: "Item A", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] }],
    });
    upsertLoop(pkg.id, { maxPasses: 3, profile: "quality" });
    updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });

    const result = await runPass(pkg.id);

    const evidence = result.pass.evidence as Record<string, unknown>;
    assert.ok(!("releaseArtifacts" in evidence), "releaseArtifacts absent for non-release profiles");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Watch profile: progress and stuck state monitoring ---

test("watch profile: loop stays active (not stopped) when running items exist", async () => {
  const pkg = makePackage("Watch-active package");
  upsertLoop(pkg.id, { maxPasses: 5, profile: "watch", autoCreateItems: true });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "running" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 0, "watch creates no items");
  assert.equal(result.pass.stopReason, null, "no stop reason when running items exist");
  assert.notEqual(result.loop.status, "stopped", "loop stays active while items are running");
  const evidence = result.pass.evidence as Record<string, unknown>;
  assert.equal(evidence.runningCount, 1, "evidence.runningCount reflects running items");
});

test("watch profile: evidence includes stuckItems for running items with no linked task", async () => {
  const pkg = makePackage("Watch-stuck package");
  upsertLoop(pkg.id, { maxPasses: 5, profile: "watch" });
  // items[0] stays in draft (createdTaskId=null). Set it to running with no task.
  getDb().prepare("UPDATE work_package_items SET status = 'running', createdTaskId = NULL WHERE _id = ?").run(pkg.items[0].id);

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  const stuck = evidence.stuckItems as Array<{ id: string; title: string; reason: string }>;
  assert.ok(Array.isArray(stuck), "evidence.stuckItems is an array");
  assert.equal(stuck.length, 1, "one stuck item detected");
  assert.equal(stuck[0].reason, "no_task_linked", "stuck reason is no_task_linked");
  assert.equal(stuck[0].id, pkg.items[0].id);
});

test("watch profile: stops with no_active_items_to_watch when no running or ready items", async () => {
  const pkg = makePackage("Watch-idle package");
  upsertLoop(pkg.id, { maxPasses: 5, profile: "watch" });
  // items are in draft (default) — not running or ready
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });
  updateWorkPackageItem(pkg.id, pkg.items[1].id, { status: "done" });

  const result = await runPass(pkg.id);

  assert.equal(result.pass.stopReason, "no_active_items_to_watch");
  assert.equal(result.loop.status, "stopped");
});

test("watch profile: evidence includes failedItems and reviewItems for observability", async () => {
  const pkg = makePackage("Watch-obs package");
  upsertLoop(pkg.id, { maxPasses: 5, profile: "watch" });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed", blocker: "timeout" });
  updateWorkPackageItem(pkg.id, pkg.items[1].id, { status: "review" });

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  const failed = evidence.failedItems as Array<{ id: string; title: string; blocker: string | null }>;
  const review = evidence.reviewItems as Array<{ id: string; title: string }>;
  assert.ok(Array.isArray(failed) && failed.length === 1, "failedItems in watch evidence");
  assert.equal(failed[0].blocker, "timeout", "blocker captured in watch evidence");
  assert.ok(Array.isArray(review) && review.length === 1, "reviewItems in watch evidence");
});

// --- Personal admin: conservative follow-up status ---

test("personal_admin profile creates held follow-up for medium-risk failed item", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({ title: "Personal-admin medium-risk pkg", project: "test", projectPath: "/tmp/test", items: [
    { title: "Send email blast", prompt: "Email all users", risk: "medium", executionMode: "sequential", dependsOn: [], scopeHints: [] },
  ]});
  upsertLoop(pkg.id, { maxPasses: 3, profile: "personal_admin", autoCreateItems: true });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed", blocker: "smtp error" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 1);
  const detail = getWorkPackage(pkg.id)!;
  const followUp = detail.items.find((i) => result.createdItemIds.includes(i.id))!;
  assert.equal(followUp.status, "held", "personal_admin holds medium-risk items for review before executing");
});

test("personal_admin profile creates draft follow-up for low-risk failed item", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({ title: "Personal-admin low-risk pkg", project: "test", projectPath: "/tmp/test", items: [
    { title: "Update README", prompt: "Fix typo in docs", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
  ]});
  upsertLoop(pkg.id, { maxPasses: 3, profile: "personal_admin", autoCreateItems: true });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed", blocker: "lint error" });

  const result = await runPass(pkg.id);

  assert.equal(result.createdItemIds.length, 1);
  const detail = getWorkPackage(pkg.id)!;
  const followUp = detail.items.find((i) => result.createdItemIds.includes(i.id))!;
  assert.equal(followUp.status, "draft", "personal_admin leaves low-risk items as draft (safe to queue)");
});

test("personal_admin evidence pendingApprovals counts pre-existing held items", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({ title: "Personal-admin pending pkg", project: "test", projectPath: "/tmp/test", items: [
    { title: "Hold me", prompt: "Held task", risk: "high", executionMode: "hold", dependsOn: [], scopeHints: [] },
    { title: "Fail me", prompt: "Will fail", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
  ]});
  upsertLoop(pkg.id, { maxPasses: 3, profile: "personal_admin", autoCreateItems: true });
  // items[0] starts held (executionMode: "hold" creates it held)
  updateWorkPackageItem(pkg.id, pkg.items[1].id, { status: "failed", blocker: "network" });

  const result = await runPass(pkg.id);

  const evidence = result.pass.evidence as Record<string, unknown>;
  // pendingApprovals counts pre-existing held items at evidence-gathering time
  assert.ok(typeof evidence.pendingApprovals === "number", "pendingApprovals is a number");
  assert.ok((evidence.pendingApprovals as number) >= 1, "at least one pre-existing held item counted");
});

// --- resolveFollowUpStatus: forceHeldMediumRisk path ---

test("forceHeldMediumRisk holds medium-risk follow-ups for personal_admin", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const medPkg = cwp({ title: "Medium-held pkg", project: "test", projectPath: "/tmp/test", items: [
    { title: "Medium item", prompt: "Do medium thing", risk: "medium", executionMode: "sequential", dependsOn: [], scopeHints: [] },
  ]});
  upsertLoop(medPkg.id, { maxPasses: 3, profile: "personal_admin", autoCreateItems: true });
  updateWorkPackageItem(medPkg.id, medPkg.items[0].id, { status: "failed" });
  const r = await runPass(medPkg.id);
  const detail = getWorkPackage(medPkg.id)!;
  const fu = detail.items.find((i) => r.createdItemIds.includes(i.id))!;
  assert.equal(fu.status, "held", "medium-risk follow-up is held under personal_admin");
  assert.equal(fu.risk, "medium");
});

test("forceHeldMediumRisk does not affect quality profile — medium-risk stays draft", async () => {
  const { createWorkPackage: cwp } = await import("./store");
  const pkg = cwp({ title: "Quality-medium pkg", project: "test", projectPath: "/tmp/test", items: [
    { title: "Medium item", prompt: "Do medium thing", risk: "medium", executionMode: "sequential", dependsOn: [], scopeHints: [] },
  ]});
  upsertLoop(pkg.id, { maxPasses: 3, profile: "quality", autoCreateItems: true, autoReadySafeItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "failed" });
  const r = await runPass(pkg.id);
  const detail = getWorkPackage(pkg.id)!;
  const fu = detail.items.find((i) => r.createdItemIds.includes(i.id))!;
  assert.equal(fu.status, "draft", "quality profile does not hold medium-risk items");
});

test("runPass: all_checks_clean fires when all items terminal and some are high-risk cancelled", async () => {
  const pkg = createWorkPackage({
    title: "AllTerminal-cancelled-high pkg",
    project: "test",
    projectPath: "/tmp/test",
    items: [
      { title: "Safe step", prompt: "Do A", risk: "low", executionMode: "sequential", dependsOn: [], scopeHints: [] },
      { title: "Risky deploy", prompt: "Deploy", risk: "high", executionMode: "hold", dependsOn: [], scopeHints: [] },
    ],
  });
  upsertLoop(pkg.id, { maxPasses: 3, autoCreateItems: false });
  updateWorkPackageItem(pkg.id, pkg.items[0].id, { status: "done" });
  updateWorkPackageItem(pkg.id, pkg.items[1].id, { status: "cancelled" });
  getDb().prepare("UPDATE work_package_items SET risk = 'high' WHERE _id = ?").run(pkg.items[1].id);

  const result = await runPass(pkg.id);

  assert.equal(result.pass.stopReason, "all_checks_clean", "all items terminal (including cancelled high-risk) → all_checks_clean stop");
  assert.equal(result.loop.status, "stopped", "loop stops when all items terminal");
});
