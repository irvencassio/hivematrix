import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getUsageAvailabilityForTask, resolveAutoAgentType, resolveModelForAgentRole, shouldClearStaleUsageDelay, pickNextEligibleTask } from "./scheduler";
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

test("blank coding agent tasks resolve to the configured coding role model", async () => {
  await withTempHome({ frontierModel: "qwen3.6-35b-4bit" }, () => {
    assert.equal(resolveModelForAgentRole(null, "developer"), "qwen3.6-35b-4bit");
    assert.equal(resolveModelForAgentRole(undefined, "cto"), "qwen3.6-35b-4bit");
    assert.equal(resolveModelForAgentRole("", "qa"), "qwen3.6-35b-4bit");
  });
});

test("explicit task model remains pinned over role defaults", async () => {
  await withTempHome({ frontierModel: "qwen3.6-35b-4bit" }, () => {
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
