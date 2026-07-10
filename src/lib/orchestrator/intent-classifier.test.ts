import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { classifyTask, _setExecSyncForTests } from "./intent-classifier";

async function withTempHome<T>(config: Record<string, unknown>, run: () => T | Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hm-intent-classifier-test-"));
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

test.afterEach(() => { _setExecSyncForTests(null); });

test("classifyTask never shells out to the Claude CLI when Claude is disabled as a frontier provider", async () => {
  let execCalls = 0;
  _setExecSyncForTests(((): never => {
    execCalls++;
    throw new Error("classifyTask must not invoke the CLI when Claude is disabled");
  }) as unknown as typeof import("node:child_process").execSync);

  await withTempHome({ providers: { claude: { enabled: false } } }, async () => {
    // No keyword match either → falls all the way to the "developer" default,
    // but the point under test is that it got there without ever shelling out.
    const result = await classifyTask("completely unmatched gibberish with no keywords at all");
    assert.equal(result, "developer");
  });

  assert.equal(execCalls, 0, "the CLI step must be skipped entirely, not attempted-and-caught");
});

test("classifyTask still uses the keyword fallback when Claude is disabled and a keyword matches", async () => {
  _setExecSyncForTests(((): never => {
    throw new Error("must not shell out when Claude is disabled");
  }) as unknown as typeof import("node:child_process").execSync);

  await withTempHome({ providers: { claude: { enabled: false } } }, async () => {
    const result = await classifyTask("design a wireframe and prototype for the new flow");
    assert.equal(result, "designer");
  });
});

test("classifyTask attempts the CLI when Claude is explicitly enabled, and falls through to keywords if it fails", async () => {
  let execCalls = 0;
  _setExecSyncForTests(((): never => {
    execCalls++;
    throw new Error("simulated: claude CLI not actually runnable in this test sandbox");
  }) as unknown as typeof import("node:child_process").execSync);

  await withTempHome({ providers: { claude: { enabled: true } } }, async () => {
    const result = await classifyTask("fix the login bug and add a regression test");
    assert.equal(result, "developer", "falls through to the keyword rule for this phrase after the CLI attempt fails");
  });

  assert.ok(execCalls > 0, "the CLI step is actually attempted when the provider is enabled");
});

test("classifyTask returns the CLI's classification when it succeeds and names a real core-tier role", async () => {
  _setExecSyncForTests(((cmd: string) => {
    // Both the Haiku attempt and (if it happened) a Sonnet retry get the
    // same canned reply here — this test only cares that a valid response
    // short-circuits before ever reaching the keyword fallback.
    return JSON.stringify({ agent: "designer" });
  }) as unknown as typeof import("node:child_process").execSync);

  await withTempHome({ providers: { claude: { enabled: true } } }, async () => {
    // Deliberately a developer-shaped phrase — if this returns "designer" it
    // proves the CLI's answer won, not the keyword fallback.
    const result = await classifyTask("fix the bug and refactor the module");
    assert.equal(result, "designer");
  });
});

test("classifyTask rejects a CLI response naming a domain id, falling through instead of trusting it", async () => {
  // trader is domain-tier — never auto-routable, explicit-pick only.
  _setExecSyncForTests(((): string => JSON.stringify({ agent: "trader" })) as unknown as typeof import("node:child_process").execSync);

  await withTempHome({ providers: { claude: { enabled: true } } }, async () => {
    const result = await classifyTask("fix the login bug");
    assert.equal(result, "developer", "\"trader\" is not a valid CLI response (domain-tier) — falls through to the keyword rule");
  });
});
