import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

test("TerminalLaneCore swift tests pass (policy + log)", () => {
  const pkg = join(process.cwd(), "terminal-lane-app", "TerminalLaneCore");
  const r = spawnSync("swift", ["test", "--package-path", pkg], { encoding: "utf8" });
  if (r.status !== 0) {
    assert.fail(`swift test failed:\n${r.stdout}\n${r.stderr}`);
  }
});
