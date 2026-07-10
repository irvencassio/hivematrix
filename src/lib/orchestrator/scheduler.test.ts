import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getUsageAvailabilityForTask, resolveAutoAgentType, resolveModelForAgentRole, shouldClearStaleUsageDelay } from "./scheduler";
import type { UsageData } from "@/lib/usage/fetcher";

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
