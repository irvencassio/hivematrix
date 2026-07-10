import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getAgentProfile, getAllAgentProfiles, AGENT_PROFILE_IDS } from "./agent-profiles";

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

test("built-in modelRole assignments match the spec's admission-test table", async () => {
  await withTempHome(null, () => {
    const byId = new Map(AGENT_PROFILE_IDS.map((id) => [id, getAgentProfile(id)]));
    assert.equal(byId.get("developer")?.modelRole, "coding");
    assert.equal(byId.get("cto")?.modelRole, "coding");
    assert.equal(byId.get("qa")?.modelRole, "coding");
    assert.equal(byId.get("designer")?.modelRole, "coding");
    assert.equal(byId.get("marketing")?.modelRole, "writer");
    assert.equal(byId.get("founder")?.modelRole, "thinking");
    assert.equal(byId.get("ceo")?.modelRole, "thinking");
    assert.equal(byId.get("coo")?.modelRole, "thinking");
    assert.equal(byId.get("analyst")?.modelRole, "thinking");
    assert.equal(byId.get("inventor")?.modelRole, "thinking");
    assert.equal(byId.get("general")?.modelRole, undefined);
    assert.equal(byId.get("researcher")?.modelRole, undefined);
    assert.equal(byId.get("cfo")?.modelRole, undefined);
    assert.equal(byId.get("trader")?.modelRole, undefined);
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
