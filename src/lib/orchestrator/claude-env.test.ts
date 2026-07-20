import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Regression 2026-07-20: every task failed with "OAuth session expired and could
 * not be refreshed" while Chat, the terminal and the browser all worked.
 *
 * buildClaudeEnv treated `task.profile` — an AGENT PERSONA ("developer",
 * "researcher") — as a Claude CLI config directory, producing
 * CLAUDE_CONFIG_DIR=$HOME/.developer. The CLI derives a separate keychain
 * credential per config dir, so each persona silently minted its own credential
 * that nothing refreshes. Measured on the affected machine: the default
 * credential was valid while .developer's had been expired for five days.
 *
 * Setting the variable to $HOME/.claude is equally wrong — an explicit path
 * hashes to a suffixed keychain item, a DIFFERENT credential from the
 * unsuffixed default used when the variable is absent.
 */
// Must AWAIT fn: an un-awaited async body lets the finally block restore HOME
// and delete the temp dir before the assertions run, which reads as a
// file-level failure with every subtest green.
async function withHome(fn: (home: string) => void | Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), "hm-claude-env-"));
  const prev = process.env.HOME;
  process.env.HOME = home;
  mkdirSync(join(home, ".hivematrix"), { recursive: true });
  try { await fn(home); } finally {
    if (prev) process.env.HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
}

const writeConfig = (home: string, cfg: object) =>
  writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify(cfg));

test("a persona name never becomes a Claude config dir", async () => {
  await withHome(async (home) => {
    writeConfig(home, {});
    const { buildClaudeEnvForTests } = await import("./subprocess");
    for (const persona of ["developer", "researcher", "qa", "coo"]) {
      const env = buildClaudeEnvForTests(persona);
      assert.equal(
        env.CLAUDE_CONFIG_DIR, undefined,
        `persona "${persona}" must not select a Claude config dir — it minted $HOME/.${persona} and its own credential`,
      );
    }
  });
});

test("no configured profiles means the variable is omitted entirely, not set to .claude", async () => {
  await withHome(async (home) => {
    writeConfig(home, {});
    const { buildClaudeEnvForTests } = await import("./subprocess");
    const env = buildClaudeEnvForTests(undefined);
    // Explicitly pointing at $HOME/.claude hashes to a DIFFERENT keychain item
    // than the default. Omission is the only way to share the credential that
    // Chat, the terminal and the browser use.
    assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  });
});

test("an inherited CLAUDE_CONFIG_DIR is stripped so a stale dir cannot leak in", async () => {
  await withHome(async (home) => {
    writeConfig(home, {});
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = "/somewhere/stale";
    try {
      const { buildClaudeEnvForTests } = await import("./subprocess");
      assert.equal(buildClaudeEnvForTests(undefined).CLAUDE_CONFIG_DIR, undefined);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prev;
    }
  });
});

test("a REAL configured Claude profile is still honoured (the multi-account feature)", async () => {
  await withHome(async (home) => {
    writeConfig(home, { profiles: [{ configDir: ".claude-work" }], defaultProfile: ".claude-work" });
    const { buildClaudeEnvForTests } = await import("./subprocess");
    assert.equal(buildClaudeEnvForTests(".claude-work").CLAUDE_CONFIG_DIR, `${home}/.claude-work`);
    // …but a persona is still rejected even when profiles exist.
    assert.equal(buildClaudeEnvForTests("developer").CLAUDE_CONFIG_DIR, undefined);
  });
});
