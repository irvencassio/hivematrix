import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runReadiness(config) {
  const home = mkdtempSync(join(tmpdir(), "hm-qwen-readiness-"));
  try {
    if (config !== undefined) {
      mkdirSync(join(home, ".hivematrix"), { recursive: true });
      writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify(config));
    }
    return spawnSync(process.execPath, ["--import", "tsx/esm", "scripts/qwen-readiness.mts"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home },
      encoding: "utf8",
      timeout: 30_000,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("qwen readiness skips cleanly when no local Qwen profile exists", () => {
  const result = runReadiness({ providers: {} });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No Qwen profile/i);
  assert.match(result.stdout, /skipped/i);
});
