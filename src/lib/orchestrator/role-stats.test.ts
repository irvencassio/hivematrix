import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate the DB under a temp HOME before anything calls getDb() (matches
// the deleted frontier-debt.test.ts's pattern).
const home = mkdtempSync(join(tmpdir(), "role-stats-test-"));
mkdirSync(join(home, ".hivematrix"), { recursive: true });
process.env.HOME = home;

const { Task } = await import("@/lib/db");
const { computeRoleStats } = await import("./role-stats");

test("computeRoleStats: a role with zero tasks reports zeros/nulls, never a fabricated rate", async (t) => {
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const stats = await computeRoleStats("designer-never-run-xyz");
  assert.equal(stats.totalRuns, 0);
  assert.deepEqual(stats.byStatus, {});
  assert.equal(stats.successRate, null);
  assert.equal(stats.lastRunAt, null);
  assert.equal(stats.medianDurationMs, null);
});

test("computeRoleStats: success rate requires at least 5 resolved (archived+failed) outcomes", async (t) => {
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const agentType = "qa-threshold-test";

  // 4 archived, 0 failed — below the 5-resolved threshold.
  for (let i = 0; i < 4; i++) {
    await Task.create({ title: `t${i}`, description: "d", project: "p", projectPath: home, status: "archived", agentType });
  }
  assert.equal((await computeRoleStats(agentType)).successRate, null, "4 resolved outcomes is not enough data yet");

  // A 5th resolved outcome crosses the threshold.
  await Task.create({ title: "t5", description: "d", project: "p", projectPath: home, status: "archived", agentType });
  assert.equal((await computeRoleStats(agentType)).successRate, 1, "5/5 archived ⇒ rate 1");
});

test("computeRoleStats: byStatus counts every status; successRate is archived / (archived + failed) only", async (t) => {
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const agentType = "founder-status-test";

  // 6 archived + 2 failed = 8 resolved outcomes — clears the 5-resolved
  // confidence threshold tested separately above.
  const statuses = ["archived", "archived", "archived", "archived", "archived", "archived", "failed", "failed", "review", "review"];
  for (const status of statuses) {
    await Task.create({ title: "t", description: "d", project: "p", projectPath: home, status, agentType });
  }

  const stats = await computeRoleStats(agentType);
  assert.equal(stats.totalRuns, 10);
  assert.deepEqual(stats.byStatus, { archived: 6, failed: 2, review: 2 });
  // 6 archived / (6 archived + 2 failed) = 0.75 — "review" tasks (unresolved) don't count.
  assert.equal(stats.successRate, 0.75);
});

test("computeRoleStats: median duration only counts tasks with both startedAt and completedAt", async (t) => {
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const agentType = "developer-duration-test";

  const base = Date.parse("2026-07-09T12:00:00.000Z");
  const withTiming = [1000, 2000, 3000, 4000, 5000]; // ms durations
  for (const ms of withTiming) {
    await Task.create({
      title: "t", description: "d", project: "p", projectPath: home, status: "archived", agentType,
      startedAt: new Date(base).toISOString(), completedAt: new Date(base + ms).toISOString(),
    });
  }
  // A task with no startedAt/completedAt must not pollute the duration set.
  await Task.create({ title: "no-timing", description: "d", project: "p", projectPath: home, status: "archived", agentType });

  const stats = await computeRoleStats(agentType);
  assert.equal(stats.totalRuns, 6);
  assert.equal(stats.medianDurationMs, 3000, "median of [1000,2000,3000,4000,5000]");
});

test("computeRoleStats: lastRunAt is the most recent completedAt (or assignedAt when not yet completed)", async (t) => {
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const agentType = "marketing-lastrun-test";

  await Task.create({
    title: "older", description: "d", project: "p", projectPath: home, status: "archived", agentType,
    completedAt: "2026-07-01T00:00:00.000Z",
  });
  await Task.create({
    title: "newer", description: "d", project: "p", projectPath: home, status: "archived", agentType,
    completedAt: "2026-07-09T00:00:00.000Z",
  });

  const stats = await computeRoleStats(agentType);
  assert.equal(stats.lastRunAt, "2026-07-09T00:00:00.000Z");
});

test("computeRoleStats: provenance split counts each task's output.roleProvenance.source, unrecognized/missing goes to unknown", async (t) => {
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const agentType = "researcher-provenance-test";

  await Task.create({
    title: "a", description: "d", project: "p", projectPath: home, status: "archived", agentType,
    output: { roleProvenance: { agentType, source: "explicit" } },
  });
  await Task.create({
    title: "b", description: "d", project: "p", projectPath: home, status: "archived", agentType,
    output: { roleProvenance: { agentType, source: "classifier" } },
  });
  await Task.create({ title: "c", description: "d", project: "p", projectPath: home, status: "archived", agentType });

  const stats = await computeRoleStats(agentType);
  assert.deepEqual(stats.provenance, { explicit: 1, classifier: 1, keyword: 0, default: 0, unknown: 1 });
});
