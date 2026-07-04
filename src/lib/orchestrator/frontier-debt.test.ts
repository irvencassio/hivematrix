import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { decideDebtAction } from "./frontier-debt";

// Isolate the DB under a temp HOME before anything calls getDb().
const home = mkdtempSync(join(tmpdir(), "fdebt-"));
mkdirSync(join(home, ".hivematrix"), { recursive: true });
process.env.HOME = home;

test("decideDebtAction: drain only when cloud-ok + original task terminal", () => {
  assert.equal(decideDebtAction({ mode: "cloud-ok", originalTaskStatus: "done" }), "drain");
  assert.equal(decideDebtAction({ mode: "cloud-ok", originalTaskStatus: "review" }), "drain");
  assert.equal(decideDebtAction({ mode: "cloud-ok", originalTaskStatus: "in_progress" }), "wait");
  assert.equal(decideDebtAction({ mode: "local-only", originalTaskStatus: "done" }), "wait");
  assert.equal(decideDebtAction({ mode: "offline", originalTaskStatus: "done" }), "wait");
  assert.equal(decideDebtAction({ mode: "cloud-ok", originalTaskStatus: null }), "cancel");
});

test("enqueue → drain creates a frontier review task and clears pending", async (t) => {
  const { Task } = await import("@/lib/db");
  const { getConnectivityPolicy } = await import("@/lib/connectivity/policy");
  const { enqueueFrontierDebt, getDebtStatus, drainFrontierDebt } = await import("./frontier-debt");

  t.after(() => rmSync(home, { recursive: true, force: true }));

  // Original code-critical task that ran locally and has finished.
  const orig = await Task.create({
    title: "Implement the parser", description: "do the thing",
    project: "inbox", projectPath: home, status: "done", source: "dashboard",
  });
  enqueueFrontierDebt(orig._id, "inbox", home);
  enqueueFrontierDebt(orig._id, "inbox", home); // idempotent
  assert.equal(getDebtStatus().pending, 1);

  // Offline → nothing drains.
  getConnectivityPolicy().setManualOverride("offline");
  assert.equal(await drainFrontierDebt(), 0);
  assert.equal(getDebtStatus().pending, 1);

  // Cloud restored → debt replays as a frontier review task.
  getConnectivityPolicy().setManualOverride("cloud-ok");
  const drained = await drainFrontierDebt();
  assert.equal(drained, 1);
  assert.equal(getDebtStatus().pending, 0);
  assert.equal(getDebtStatus().drained, 1);

  const reviews = await Task.find({ source: "review-debt" }) as Array<{ title: string; model: string }>;
  assert.equal(reviews.length, 1);
  assert.match(reviews[0].title, /Frontier review:/);
  assert.equal(reviews[0].model, "mixed");

  getConnectivityPolicy().setManualOverride(null);
});

test("drain loop logs a failed drain and keeps running", async (t) => {
  const { startFrontierDebtLoop, stopFrontierDebtLoop } = await import("./frontier-debt");
  const errors: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { errors.push(args.join(" ")); });
  t.after(() => stopFrontierDebtLoop());

  let calls = 0;
  startFrontierDebtLoop(20, async () => {
    calls += 1;
    if (calls === 1) throw new Error("db locked");
    return 0;
  });

  const end = Date.now() + 2_000;
  while (calls < 2 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));

  assert.ok(calls >= 2, `loop should keep running after a failed drain (calls=${calls})`);
  assert.ok(
    errors.some((e) => e.includes("[frontier-debt]") && e.includes("db locked")),
    "the drain failure should be logged, not swallowed",
  );
});
