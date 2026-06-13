import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startClaudeAuthLogin } from "./claude-auth-login";

test("startClaudeAuthLogin writes a fixed command script and opens it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-claude-auth-"));
  const opened: string[][] = [];

  const result = await startClaudeAuthLogin({
    homeDir: dir,
    execFile: async (file, args) => {
      opened.push([file, ...args]);
    },
    cliPath: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
  });

  assert.equal(result.ok, true);
  assert.equal(result.scriptPath, join(dir, ".hivematrix", "claude-auth-login.command"));
  assert.deepEqual(opened, [["open", result.scriptPath]]);

  const script = readFileSync(result.scriptPath, "utf-8");
  assert.match(script, /claude auth login/);
  assert.match(script, /Return to HiveMatrix and click refresh/);
  assert.doesNotMatch(script, /\$\{.*\}/);
  assert.equal(statSync(result.scriptPath).mode & 0o777, 0o700);
});
