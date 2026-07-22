import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getUsageAvailabilityForTask, resolveAutoAgentType, resolveModelForAgentRole, shouldClearStaleUsageDelay, pickNextEligibleTask, reapWaitingChildren, nextSpawnFailureAction, MAX_SPAWN_RETRIES } from "./scheduler";
import type { UsageData } from "@/lib/usage/fetcher";

async function withTempDb<T>(run: () => T | Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const originalDbPath = process.env.HIVEMATRIX_DB_PATH;
  const tmp = mkdtempSync(join(tmpdir(), "hm-scheduler-db-test-"));
  process.env.HOME = tmp;
  process.env.HIVEMATRIX_DB_PATH = join(tmp, "test.db");
  const { _resetDbForTests } = await import("@/lib/db");
  _resetDbForTests();
  try {
    return await run();
  } finally {
    _resetDbForTests();
    if (originalDbPath) process.env.HIVEMATRIX_DB_PATH = originalDbPath; else delete process.env.HIVEMATRIX_DB_PATH;
    if (originalHome) process.env.HOME = originalHome;
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function mkTask(overrides: Record<string, unknown> = {}) {
  const { Task, generateId } = await import("@/lib/db");
  return Task.create({
    _id: generateId(),
    title: "t", description: "d", project: "p", projectPath: "/tmp/p",
    status: "backlog", executor: "agent",
    ...overrides,
  });
}

const BASE_QUERY = { status: "backlog", executor: "agent" };

async function withTempHome<T>(config: Record<string, unknown>, run: () => T | Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hm-scheduler-test-"));
  mkdirSync(join(tempHome, ".hivematrix"), { recursive: true });
  writeFileSync(join(tempHome, ".hivematrix", "config.json"), JSON.stringify(config));
  process.env.HOME = tempHome;
  try {
    return await run();
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

const usage: UsageData = {
  fetchedAt: "2026-05-15T13:40:10.577Z",
  profiles: [
    {
      profile: "irv",
      accountName: "",
      accountEmail: "",
      planType: "",
      provider: "claude",
      fiveHour: { utilization: 100, resetsAt: "2026-05-15T18:00:01.013Z" },
      sevenDay: { utilization: 6, resetsAt: "2026-05-21T06:00:01.013Z" },
      sevenDayOpus: null,
      sevenDaySonnet: null,
      extraUsage: null,
      fetchedAt: "2026-05-15T13:40:10.577Z",
    },
    {
      profile: "chatgpt",
      accountName: "",
      accountEmail: "",
      planType: "",
      provider: "codex",
      fiveHour: { utilization: 14, resetsAt: "2026-05-14T23:31:53.000Z" },
      sevenDay: { utilization: 8, resetsAt: "2026-05-19T12:35:02.000Z" },
      sevenDayOpus: null,
      sevenDaySonnet: null,
      extraUsage: null,
      fetchedAt: "2026-05-15T13:40:10.577Z",
    },
  ],
};

test("Codex tasks are not blocked by the active Claude profile limit", () => {
  const result = getUsageAvailabilityForTask(
    { model: "codex:gpt-5.4", profile: "claude-irv" },
    usage,
    ".claude-irv"
  );

  assert.equal(result.ok, true);
  assert.equal(result.provider, "codex");
  assert.equal(result.profile, "chatgpt");
});

test("Claude tasks are blocked by their own exhausted Claude profile", () => {
  const result = getUsageAvailabilityForTask(
    { model: "claude-sonnet-4-6", profile: "claude-irv" },
    usage,
    ".claude-el"
  );

  assert.equal(result.ok, false);
  assert.equal(result.provider, "claude");
  assert.equal(result.profile, "irv");
  assert.equal(result.resetsAt, "2026-05-15T18:00:01.013Z");
});

test("Codex tasks clear stale delayUntil values copied from Claude usage resets", () => {
  assert.equal(
    shouldClearStaleUsageDelay(
      {
        model: "codex:gpt-5.4",
        profile: "claude-irv",
        delayUntil: "2026-05-15T18:00:01.013Z",
      },
      usage,
      ".claude-irv"
    ),
    true
  );
});

test("Codex tasks clear stale delayUntil values when the cached reset shifts slightly", () => {
  assert.equal(
    shouldClearStaleUsageDelay(
      {
        model: "codex:gpt-5.4",
        profile: "claude-irv",
        delayUntil: "2026-05-15T18:00:01.013Z",
      },
      {
        ...usage,
        profiles: usage.profiles.map((profile) => profile.profile === "irv"
          ? {
              ...profile,
              fiveHour: {
                utilization: 100,
                resetsAt: "2026-05-15T18:00:01.492Z",
              },
            }
          : profile),
      },
      ".claude-irv"
    ),
    true
  );
});

test("Claude tasks keep their own rate-limit delay", () => {
  assert.equal(
    shouldClearStaleUsageDelay(
      {
        model: "claude-sonnet-4-6",
        profile: "claude-irv",
        delayUntil: "2026-05-15T18:00:01.013Z",
      },
      usage,
      ".claude-irv"
    ),
    false
  );
});

test("manually queued delays are not cleared when they match a usage reset", () => {
  assert.equal(
    shouldClearStaleUsageDelay(
      {
        model: "codex:gpt-5.4",
        profile: "claude-irv",
        delayUntil: "2026-05-15T18:00:01.013Z",
        delayReason: "manual",
      },
      usage,
      ".claude-irv"
    ),
    false
  );
});

test("usage-limit delays still clear when the provider becomes available", () => {
  assert.equal(
    shouldClearStaleUsageDelay(
      {
        model: "codex:gpt-5.4",
        profile: "claude-irv",
        delayUntil: "2026-05-15T18:00:01.013Z",
        delayReason: "usage_limit",
      },
      usage,
      ".claude-irv"
    ),
    true
  );
});

test("non usage-reset delays are not cleared", () => {
  assert.equal(
    shouldClearStaleUsageDelay(
      {
        model: "codex:gpt-5.4",
        profile: "claude-irv",
        delayUntil: "2026-05-15T13:45:00.000Z",
      },
      usage,
      ".claude-irv"
    ),
    false
  );
});

test("blank coding agent tasks resolve to the configured thinking role model (native-task-execution: top-level task runs on Opus)", async () => {
  await withTempHome({ thinkModel: "claude-opus-4-8" }, () => {
    assert.equal(resolveModelForAgentRole(null, "developer"), "claude-opus-4-8");
    assert.equal(resolveModelForAgentRole(undefined, "cto"), "claude-opus-4-8");
    assert.equal(resolveModelForAgentRole("", "qa"), "claude-opus-4-8");
  });
});

test("explicit task model remains pinned over role defaults", async () => {
  await withTempHome({ thinkModel: "claude-opus-4-8" }, () => {
    assert.equal(resolveModelForAgentRole("claude-sonnet-4-6", "developer"), "claude-sonnet-4-6");
  });
});

test("resolveAutoAgentType: agentSpecialization absent ⇒ developer/default, no classifier call", async () => {
  await withTempHome({}, async () => {
    assert.deepEqual(await resolveAutoAgentType("write the launch blog post"), { agentType: "developer", source: "default" });
  });
});

test("resolveAutoAgentType: agentSpecialization explicitly false ⇒ developer/default", async () => {
  await withTempHome({ features: { agentSpecialization: false } }, async () => {
    assert.deepEqual(await resolveAutoAgentType("verify the checkout flow end to end"), { agentType: "developer", source: "default" });
  });
});

test("modelRole: thinking-tier profiles now resolve via thinkModel (previously undefined)", async () => {
  await withTempHome({ thinkModel: "claude-opus-4-8" }, () => {
    assert.equal(resolveModelForAgentRole(null, "founder"), "claude-opus-4-8");
    assert.equal(resolveModelForAgentRole(null, "coo"), "claude-opus-4-8");
    // "analyst" was cut (Phase 4) and aliases to "researcher" via getAgentProfile
    // — researcher's modelRole is deliberately unset, so this now resolves like
    // researcher, not like the old standalone analyst profile did.
    assert.equal(resolveModelForAgentRole(undefined, "analyst"), undefined);
  });
});

test("modelRole: designer resolves via the coding role model (previously undefined)", async () => {
  await withTempHome({ frontierModel: "qwen3.6-35b-4bit" }, () => {
    assert.equal(resolveModelForAgentRole(null, "designer"), "qwen3.6-35b-4bit");
  });
});

test("modelRole: profiles with no modelRole and no coarse-map entry stay undefined", async () => {
  await withTempHome({ thinkModel: "claude-opus-4-8", frontierModel: "qwen3.6-35b-4bit" }, () => {
    assert.equal(resolveModelForAgentRole(null, "researcher"), undefined);
    assert.equal(resolveModelForAgentRole(undefined, "general"), undefined);
  });
});

test("modelRole: an empty role-model slot falls through cleanly (no crash, no false positive)", async () => {
  await withTempHome({}, () => {
    assert.equal(resolveModelForAgentRole(null, "founder"), undefined);
  });
});

test("a task created without an explicit budget gets the $25 unattended-runaway backstop, not the old $5 default", async () => {
  await withTempDb(async () => {
    const task = await mkTask({});
    // Raised from $10 on 2026-07-16 after it killed three near-complete tasks
    // at $10.35–$10.68. Still a ceiling, just one that clears real work.
    assert.equal(task.maxBudgetUsd, 25);
  });
});

test("a task can still opt out of the ceiling entirely with an explicit 0", async () => {
  await withTempDb(async () => {
    const task = await mkTask({ maxBudgetUsd: 0 });
    assert.equal(task.maxBudgetUsd, 0);
  });
});

test("pickNextEligibleTask: with no dependsOn anywhere, behavior is unchanged — oldest position wins", async () => {
  await withTempDb(async () => {
    const a = await mkTask({ position: 2, title: "second" });
    const b = await mkTask({ position: 1, title: "first" });
    const picked = await pickNextEligibleTask(BASE_QUERY);
    assert.equal(picked?._id.toString(), b._id.toString());
    void a;
  });
});

test("pickNextEligibleTask: B depends on A ⇒ B is never picked while A is still active", async () => {
  await withTempDb(async () => {
    const a = await mkTask({ position: 1, title: "A", status: "in_progress" });
    await mkTask({ position: 2, title: "B", dependsOn: [a._id.toString()] });
    // A itself isn't a backlog task right now (it's in_progress), so the only
    // backlog candidate is B — and its dependency isn't terminal yet.
    const picked = await pickNextEligibleTask(BASE_QUERY);
    assert.equal(picked, null, "B must not run before A terminates");
  });
});

test("pickNextEligibleTask: B becomes eligible once A reaches a terminal status (review)", async () => {
  await withTempDb(async () => {
    const a = await mkTask({ position: 1, title: "A", status: "review" });
    const b = await mkTask({ position: 2, title: "B", dependsOn: [a._id.toString()] });
    const picked = await pickNextEligibleTask(BASE_QUERY);
    assert.equal(picked?._id.toString(), b._id.toString());
  });
});

test("pickNextEligibleTask: a blocked task never starves an eligible one behind it in position order", async () => {
  await withTempDb(async () => {
    const a = await mkTask({ position: 1, title: "A", status: "in_progress" });
    await mkTask({ position: 2, title: "B (blocked)", dependsOn: [a._id.toString()] });
    const c = await mkTask({ position: 3, title: "C (free)" });
    const picked = await pickNextEligibleTask(BASE_QUERY);
    assert.equal(picked?._id.toString(), c._id.toString(), "C has no deps and should be picked even though it's behind blocked B");
  });
});

test("pickNextEligibleTask: multiple dependsOn must ALL be terminal, not just one", async () => {
  await withTempDb(async () => {
    const a = await mkTask({ position: 1, title: "A", status: "review" });
    const b = await mkTask({ position: 2, title: "B", status: "in_progress" });
    await mkTask({ position: 3, title: "C", dependsOn: [a._id.toString(), b._id.toString()] });
    assert.equal(await pickNextEligibleTask(BASE_QUERY), null, "C waits on B too, even though A is done");
  });
});

test("pickNextEligibleTask: a dependsOn id that no longer resolves to any task keeps the task blocked (fail closed, not silently dropped)", async () => {
  await withTempDb(async () => {
    await mkTask({ position: 1, title: "orphaned dep", dependsOn: ["does-not-exist"] });
    assert.equal(await pickNextEligibleTask(BASE_QUERY), null);
  });
});

// ─── Phase 3: waiting_children reaper — the COO delegation "money test" ────

test("reapWaitingChildren: does nothing while children are still active — parent stays parked, never claimable", async () => {
  await withTempDb(async () => {
    const parent = await mkTask({
      status: "review", reviewState: "waiting_children",
      output: { childrenWaitingSince: new Date().toISOString() },
    });
    await mkTask({ parentTaskId: parent._id.toString(), status: "in_progress", agentType: "qa" });

    await reapWaitingChildren();

    const fresh = await (await import("@/lib/db")).Task.findById(parent._id.toString());
    assert.equal(fresh!.reviewState, "waiting_children");
    assert.equal(fresh!.status, "review");
    // Structural proof it can never occupy a scheduler slot while waiting —
    // the claim query only ever matches status:"backlog".
    const claimable = await (await import("@/lib/db")).Task.find({ status: "backlog", executor: "agent" });
    assert.ok(!claimable.some((t) => t._id.toString() === parent._id.toString()));
  });
});

test("reapWaitingChildren: THE MONEY TEST — 2 children terminate, parent resumes exactly once with both outputs in context", async () => {
  await withTempDb(async () => {
    const parent = await mkTask({
      description: "Ship the pricing page redesign.",
      status: "review", reviewState: "waiting_children",
      output: { childrenWaitingSince: new Date().toISOString(), delegated: true },
    });
    await mkTask({
      parentTaskId: parent._id.toString(), agentType: "designer", title: "Design the layout",
      status: "archived", output: { summary: "Delivered a 3-panel responsive layout." },
    });
    await mkTask({
      parentTaskId: parent._id.toString(), agentType: "qa", title: "Verify checkout flow",
      status: "failed", output: { summary: "Checkout button is unreachable on mobile." },
    });

    await reapWaitingChildren();

    const { Task } = await import("@/lib/db");
    const resumed = await Task.findById(parent._id.toString());
    assert.equal(resumed!.status, "backlog", "released back to the scheduler — no blocking, no polling");
    assert.equal(resumed!.reviewState, null);
    assert.equal((resumed!.output as Record<string, unknown>).continuations, 1, "exactly one continuation recorded");
    assert.match(resumed!.description, /Ship the pricing page redesign\./, "original instructions preserved");
    assert.match(resumed!.description, /\[designer\] Design the layout — archived/);
    assert.match(resumed!.description, /Delivered a 3-panel responsive layout\./);
    assert.match(resumed!.description, /\[qa\] Verify checkout flow — failed/);
    assert.match(resumed!.description, /Checkout button is unreachable on mobile\./);

    // Second reap pass (simulating the parent finishing again without new
    // children, or the operator re-checking) must be a no-op — the parent
    // is no longer reviewState:"waiting_children" so it's not revisited.
    await reapWaitingChildren();
    const still = await Task.findById(parent._id.toString());
    assert.equal((still!.output as Record<string, unknown>).continuations, 1, "resuming again does not bump continuations a second time");
  });
});

test("reapWaitingChildren: force-resumes after 24h even if a child never finished — never strand a task", async () => {
  await withTempDb(async () => {
    const overdue = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const parent = await mkTask({
      status: "review", reviewState: "waiting_children",
      output: { childrenWaitingSince: overdue },
    });
    await mkTask({ parentTaskId: parent._id.toString(), agentType: "developer", title: "Slow task", status: "in_progress" });

    await reapWaitingChildren();

    const { Task } = await import("@/lib/db");
    const resumed = await Task.findById(parent._id.toString());
    assert.equal(resumed!.status, "backlog");
    assert.match(resumed!.description, /did not complete in time — status: in_progress/);
  });
});

test("reapWaitingChildren: NOT overdue and children still active ⇒ stays parked (force-resume only fires past 24h)", async () => {
  await withTempDb(async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const parent = await mkTask({ status: "review", reviewState: "waiting_children", output: { childrenWaitingSince: recent } });
    await mkTask({ parentTaskId: parent._id.toString(), status: "in_progress" });

    await reapWaitingChildren();

    const { Task } = await import("@/lib/db");
    const stillWaiting = await Task.findById(parent._id.toString());
    assert.equal(stillWaiting!.reviewState, "waiting_children");
  });
});

test("reapWaitingChildren: a subtask that succeeded auto-archives (agent-manager's shouldAutoArchiveSubtask), which is what lets terminal-status checks converge", async () => {
  await withTempDb(async () => {
    const parent = await mkTask({ status: "review", reviewState: "waiting_children", output: { childrenWaitingSince: new Date().toISOString() } });
    // Simulates the auto-archive outcome directly (agent-manager.ts's own
    // logic is unit-tested separately) — status:"archived" is what the
    // reaper treats as settled.
    await mkTask({ parentTaskId: parent._id.toString(), status: "archived", output: { summary: "Done." } });

    await reapWaitingChildren();

    const { Task } = await import("@/lib/db");
    const resumed = await Task.findById(parent._id.toString());
    assert.equal(resumed!.status, "backlog");
  });
});

test("nextSpawnFailureAction: a spawn failure is requeued up to the cap, then fails — never loops forever", () => {
  // Regression 2026-07-22: the scheduler's spawn-failure catch requeued EVERY
  // failure with no counter (unlike handleExit's cap of 5), so a permanent
  // failure — e.g. an expired sign-in — looped every ~2 min forever. Paired
  // with the old auth cascade it re-opened browser login prompts on every lap.
  // The cap must let a genuinely stuck task fail visibly.

  // First failure through the cap: requeue, with a monotonically rising count.
  for (let prior = 0; prior < MAX_SPAWN_RETRIES; prior++) {
    const r = nextSpawnFailureAction(prior);
    assert.equal(r.action, "requeue", `failure #${prior + 1} of ${MAX_SPAWN_RETRIES} should still retry`);
    assert.equal(r.retries, prior + 1);
  }

  // The one past the cap fails instead of requeueing — the loop terminates.
  const capped = nextSpawnFailureAction(MAX_SPAWN_RETRIES);
  assert.equal(capped.action, "fail");
  assert.equal(capped.retries, MAX_SPAWN_RETRIES + 1);

  // A fresh/undefined counter starts at one retry, not a crash.
  assert.deepEqual(nextSpawnFailureAction(undefined), { action: "requeue", retries: 1 });
});
