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
