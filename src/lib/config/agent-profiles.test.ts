import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  getAgentProfile, getAllAgentProfiles, getCoreAgentProfiles, resolveLegacyAgentType,
  profileTier, AGENT_PROFILE_IDS, LEGACY_PROFILE_ALIASES,
  writeCustomProfile, deleteCustomProfile, customProfileIds,
} from "./agent-profiles";

async function withTempHome<T>(files: Record<string, unknown> | null, run: () => T | Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hm-agent-profiles-test-"));
  if (files) {
    const agentsDir = join(tempHome, ".hivematrix", "agents");
    mkdirSync(agentsDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(agentsDir, name), typeof content === "string" ? content : JSON.stringify(content));
    }
  }
  process.env.HOME = tempHome;
  try {
    return await run();
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

test("getAgentProfile falls back to developer for an unknown id", async () => {
  await withTempHome(null, () => {
    const p = getAgentProfile("not-a-real-role");
    assert.equal(p.id, "developer");
  });
});

test("built-in modelRole assignments match the spec's admission-test table (post-cut roster)", async () => {
  await withTempHome(null, () => {
    const byId = new Map(AGENT_PROFILE_IDS.map((id) => [id, getAgentProfile(id)]));
    assert.equal(byId.get("developer")?.modelRole, "coding");
    assert.equal(byId.get("qa")?.modelRole, "coding");
    assert.equal(byId.get("designer")?.modelRole, "coding");
    assert.equal(byId.get("marketing")?.modelRole, "writer");
    assert.equal(byId.get("founder")?.modelRole, "thinking");
    assert.equal(byId.get("coo")?.modelRole, "thinking");
    assert.equal(byId.get("general")?.modelRole, undefined);
    assert.equal(byId.get("researcher")?.modelRole, undefined);
    assert.equal(byId.get("trader")?.modelRole, undefined);
  });
});

test("the roster is exactly 7 core + 1 coordinator + 1 domain (14 → 9)", async () => {
  await withTempHome(null, () => {
    const all = getAllAgentProfiles();
    assert.equal(all.length, 9, "cut ceo/cto/cfo/analyst/inventor — 5 removed from the original 14");
    const byTier = { core: 0, coordinator: 0, domain: 0 };
    for (const p of all) byTier[profileTier(p)]++;
    assert.deepEqual(byTier, { core: 7, coordinator: 1, domain: 1 });
    assert.deepEqual(
      new Set(all.filter((p) => profileTier(p) === "core").map((p) => p.id)),
      new Set(["general", "developer", "researcher", "marketing", "founder", "qa", "designer"]),
    );
    assert.equal(all.find((p) => p.id === "coo")?.tier, "coordinator");
    assert.equal(all.find((p) => p.id === "trader")?.tier, "domain");
  });
});

test("getCoreAgentProfiles never includes the coordinator or domain profile", async () => {
  await withTempHome(null, () => {
    const coreIds = getCoreAgentProfiles().map((p) => p.id);
    assert.equal(coreIds.length, 7);
    assert.ok(!coreIds.includes("coo"), "coo is coordinator-tier — must never be classifier-reachable yet");
    assert.ok(!coreIds.includes("trader"), "trader is domain-tier — must never be classifier-reachable");
  });
});

test("every cut id resolves through LEGACY_PROFILE_ALIASES to a real, undamaged profile — not the generic developer fallback", async () => {
  await withTempHome(null, () => {
    assert.equal(getAgentProfile("cto").id, "developer");
    assert.equal(getAgentProfile("ceo").id, "founder");
    assert.equal(getAgentProfile("cfo").id, "founder");
    assert.equal(getAgentProfile("analyst").id, "researcher");
    assert.equal(getAgentProfile("inventor").id, "founder");
    // resolveLegacyAgentType is the raw-string form the scheduler consults
    // BEFORE calling getAgentProfile (e.g. for its own dispatch branches).
    for (const [legacy, target] of Object.entries(LEGACY_PROFILE_ALIASES)) {
      assert.equal(resolveLegacyAgentType(legacy), target);
    }
    assert.equal(resolveLegacyAgentType("auto"), "auto", "\"auto\" is not an alias key — must pass through untouched");
    assert.equal(resolveLegacyAgentType("developer"), "developer", "a surviving id is not an alias key — passes through");
  });
});

test("a custom profile can set a valid modelRole and it overrides the built-in", async () => {
  await withTempHome(
    { "developer.json": { id: "developer", systemPrompt: "Custom dev prompt.", modelRole: "thinking" } },
    () => {
      const p = getAgentProfile("developer");
      assert.equal(p.systemPrompt, "Custom dev prompt.");
      assert.equal(p.modelRole, "thinking");
    }
  );
});

test("an invalid modelRole on a custom profile is dropped, not trusted verbatim", async () => {
  await withTempHome(
    { "rogue.json": { id: "rogue", systemPrompt: "x", modelRole: "made-up-role" } },
    () => {
      const p = getAgentProfile("rogue");
      assert.equal(p.id, "rogue"); // the custom profile itself loaded fine
      assert.equal(p.modelRole, undefined); // but the bogus role string was rejected, not passed through
    }
  );
});

test("a custom profile with no modelRole simply has none (not a crash)", async () => {
  await withTempHome({ "plain.json": { id: "plain", systemPrompt: "x" } }, () => {
    const all = getAllAgentProfiles();
    const plain = all.find((p) => p.id === "plain");
    assert.ok(plain);
    assert.equal(plain?.modelRole, undefined);
  });
});

// ─── Phase 7 (2026-07-09): rewritten thin profiles ─────────────────────────

function promptLines(id: string): number {
  return getAgentProfile(id).systemPrompt.trim().split("\n").length;
}

test("developer's rewrite preserves every original rule verbatim — extends, never replaces", async () => {
  await withTempHome(null, () => {
    const prompt = getAgentProfile("developer").systemPrompt;
    const originalRules = [
      "Read files before modifying them to understand existing code",
      "Use bash for git, npm, build tools, and other shell commands",
      "Make targeted edits rather than rewriting entire files",
      "Run tests after changes when a test suite exists",
      "Be direct — execute the task, don't ask for confirmation",
      "Commit changes when work is complete",
    ];
    for (const rule of originalRules) {
      assert.ok(prompt.includes(rule), `original rule dropped or reworded: "${rule}"`);
    }
    // The Phase-7 addition: an explicit verification/handoff step, layered
    // in ADDITION to (not instead of) the rules above.
    assert.match(prompt, /verify|verification/i);
  });
});

test("researcher and founder enforce opposite sides of the same boundary: researcher must not recommend, founder must", async () => {
  await withTempHome(null, () => {
    const researcher = getAgentProfile("researcher").systemPrompt;
    const founder = getAgentProfile("founder").systemPrompt;
    assert.match(researcher, /not to advise|not just to gather and present/i);
    assert.match(researcher, /recommend/i, "must at least mention recommending, to explicitly forbid it");
    assert.match(founder, /take a position|land on a recommendation|recommend/i);
    assert.match(founder, /name the risks|honest about risks/i);
  });
});

test("the four rewritten profiles clear the ≥25-line depth bar; designer/qa/trader are untouched by Phase 7", async () => {
  await withTempHome(null, () => {
    for (const id of ["founder", "researcher", "marketing", "coo"]) {
      assert.ok(promptLines(id) >= 25, `${id} is only ${promptLines(id)} lines — expected ≥25`);
    }
    // general is deliberately kept short — the no-tools conversational fallback.
    assert.ok(promptLines("general") < 15);
    // Reference quality bar — must remain exactly what they were before Phase 7.
    assert.equal(promptLines("qa"), 45);
    assert.equal(promptLines("designer"), 58);
    assert.equal(promptLines("trader"), 49);
  });
});

test("coo's prompt describes its real fire-and-forget limitation honestly, and defers roster listing to the live injection (no hardcoded roster string)", async () => {
  await withTempHome(null, () => {
    const prompt = getAgentProfile("coo").systemPrompt;
    assert.match(prompt, /fire-and-forget/i);
    assert.match(prompt, /cannot read|cannot synthesize|cannot see/i);
    // Must NOT contain a comma-separated hardcoded id list (the pre-2026-07-09
    // bug this profile had — a literal roster string that rotted the moment a
    // role was cut). The real roster comes from generic-agent.ts/subprocess.ts
    // injecting it live (see generic-agent.test.ts / subprocess.test.ts).
    assert.doesNotMatch(prompt, /developer, researcher, marketing, founder/);
  });
});

// ─── Phase 2 (2026-07-09): custom profile write/delete ─────────────────────

test("writeCustomProfile creates ~/.hivematrix/agents/<id>.json and getAgentProfile picks it up immediately, no restart", async () => {
  await withTempHome(null, () => {
    writeCustomProfile({ id: "founder", systemPrompt: "Edited founder prompt.", tools: ["bash", "read_file"] });
    const p = getAgentProfile("founder");
    assert.equal(p.systemPrompt, "Edited founder prompt.");
    assert.deepEqual(p.tools, ["bash", "read_file"]);
    assert.ok(customProfileIds().includes("founder"));
  });
});

test("writeCustomProfile rejects an empty systemPrompt", async () => {
  await withTempHome(null, () => {
    assert.throws(() => writeCustomProfile({ id: "founder", systemPrompt: "   " }), /systemPrompt/);
  });
});

test("writeCustomProfile rejects a malformed id even when called directly (defense in depth behind the route's own validation)", async () => {
  await withTempHome(null, () => {
    assert.throws(() => writeCustomProfile({ id: "../../etc/passwd", systemPrompt: "x" }), /Invalid profile id/);
    assert.throws(() => writeCustomProfile({ id: "UPPERCASE", systemPrompt: "x" }), /Invalid profile id/);
  });
});

test("writeCustomProfile validates and persists modelRole/tier when given valid values, drops invalid ones", async () => {
  await withTempHome(null, () => {
    writeCustomProfile({ id: "researcher", systemPrompt: "x", modelRole: "thinking", tier: "domain" });
    const p = getAgentProfile("researcher");
    assert.equal(p.modelRole, "thinking");
    assert.equal(p.tier, "domain");

    writeCustomProfile({ id: "marketing", systemPrompt: "x", modelRole: "not-a-role", tier: "not-a-tier" });
    const p2 = getAgentProfile("marketing");
    assert.equal(p2.modelRole, undefined);
    assert.equal(profileTier(p2), "core", "invalid tier is dropped, defaults to core");
  });
});

test("deleteCustomProfile removes the override and getAgentProfile reverts to the built-in", async () => {
  await withTempHome(null, () => {
    writeCustomProfile({ id: "qa", systemPrompt: "Custom QA prompt." });
    assert.equal(getAgentProfile("qa").systemPrompt, "Custom QA prompt.");

    const deleted = deleteCustomProfile("qa");
    assert.equal(deleted, true);
    assert.notEqual(getAgentProfile("qa").systemPrompt, "Custom QA prompt.");
    assert.match(getAgentProfile("qa").systemPrompt, /senior QA engineer/i, "reverted to the real built-in qa prompt");
  });
});

test("deleteCustomProfile returns false (not an error) when there is nothing to delete", async () => {
  await withTempHome(null, () => {
    assert.equal(deleteCustomProfile("developer"), false, "developer has no custom override in this fixture");
  });
});

test("deleteCustomProfile rejects a malformed id", async () => {
  await withTempHome(null, () => {
    assert.throws(() => deleteCustomProfile("../escape"), /Invalid profile id/);
  });
});
