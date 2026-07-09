import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeProviderSetupCommand, openProviderSetup } from "./provider-setup";

test("claude: login-only when binary is already present (no install line)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-provider-setup-"));
  const scriptPath = writeProviderSetupCommand("claude", {
    homeDir: dir,
    cliPath: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    binaryPresent: true,
  });

  assert.equal(scriptPath, join(dir, ".hivematrix", "claude-setup.command"));
  const script = readFileSync(scriptPath, "utf-8");
  assert.match(script, /claude auth login/);
  assert.doesNotMatch(script, /npm install -g @anthropic-ai\/claude-code/);
  assert.doesNotMatch(script, /\$\{.*\}/);
  assert.equal(statSync(scriptPath).mode & 0o777, 0o700);
});

test("claude: best-effort install + fallback URL when binary is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-provider-setup-"));
  const scriptPath = writeProviderSetupCommand("claude", {
    homeDir: dir,
    cliPath: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    binaryPresent: false,
  });

  const script = readFileSync(scriptPath, "utf-8");
  assert.match(script, /npm install -g @anthropic-ai\/claude-code/);
  assert.match(script, /https:\/\/claude\.com\/claude-code/);
  assert.match(script, /claude auth login/);
});

test("codex: full install + login when binary is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-provider-setup-"));
  const scriptPath = writeProviderSetupCommand("codex", {
    homeDir: dir,
    cliPath: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    binaryPresent: false,
  });

  assert.equal(scriptPath, join(dir, ".hivematrix", "codex-setup.command"));
  const script = readFileSync(scriptPath, "utf-8");
  assert.match(script, /npm install -g @openai\/codex/);
  assert.match(script, /codex login/);
});

test("codex: skips install line when binary is present (idempotent)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-provider-setup-"));
  const scriptPath = writeProviderSetupCommand("codex", {
    homeDir: dir,
    cliPath: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    binaryPresent: true,
  });

  const script = readFileSync(scriptPath, "utf-8");
  assert.doesNotMatch(script, /npm install -g @openai\/codex/);
  assert.match(script, /codex login/);
});

test("openProviderSetup writes the script and opens it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-provider-setup-"));
  const opened: string[][] = [];

  const result = await openProviderSetup("codex", {
    homeDir: dir,
    binaryPresent: true,
    cliPath: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    execFile: async (file, args) => {
      opened.push([file, ...args]);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.scriptPath, join(dir, ".hivematrix", "codex-setup.command"));
  assert.deepEqual(opened, [["open", result.scriptPath]]);
});
