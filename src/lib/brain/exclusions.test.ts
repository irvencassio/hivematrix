import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadExclusions, isExcluded, setExcluded } from "./exclusions";

function withTempHome<T>(run: () => T): T {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hive-brain-exclusions-test-"));
  process.env.HOME = tempHome;
  try {
    return run();
  } finally {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
}

test("loadExclusions is empty when no sidecar exists", () => {
  withTempHome(() => {
    assert.deepEqual([...loadExclusions()], []);
    assert.equal(isExcluded("projects/hive/agent-brief.md"), false);
  });
});

test("setExcluded persists, isExcluded reflects it, and un-excluding removes it", () => {
  withTempHome(() => {
    setExcluded(["projects/hive/known-issues.md"], true);
    assert.equal(isExcluded("projects/hive/known-issues.md"), true);
    assert.equal(isExcluded("projects/hive/agent-brief.md"), false);

    setExcluded(["projects/hive/agent-brief.md"], true);
    assert.deepEqual([...loadExclusions()].sort(), ["projects/hive/agent-brief.md", "projects/hive/known-issues.md"]);

    setExcluded(["projects/hive/known-issues.md"], false);
    assert.equal(isExcluded("projects/hive/known-issues.md"), false);
    assert.equal(isExcluded("projects/hive/agent-brief.md"), true);
  });
});

test("setExcluded is idempotent and sorts the persisted list", () => {
  withTempHome(() => {
    setExcluded(["b.md", "a.md"], true);
    setExcluded(["a.md"], true); // re-excluding an already-excluded doc is a no-op
    assert.deepEqual([...loadExclusions()], ["a.md", "b.md"]);
  });
});
