import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  getAgentProfile, getAllAgentProfiles, getCoreAgentProfiles, resolveLegacyAgentType,
  profileTier, AGENT_PROFILE_IDS, LEGACY_PROFILE_ALIASES,
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
