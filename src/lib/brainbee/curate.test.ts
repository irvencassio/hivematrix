import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { curatePlaybookBody, curatePlaybooksUnder } from "./curate";

const DUP_PLAYBOOK = [
  "# Playbook: coo",
  "",
  "Accumulated rules distilled from directive retrospectives.",
  "",
  "## 2026-06-12 - Goal A (run_1)",
  "- Check credentials first *(confidence: high)*",
  "  - Why: prior auth failures",
  "- Keep directive tasks tiny",
  "",
  "## 2026-06-12 - Goal B (run_2)",
  "- Check credentials first *(confidence: high)*",
  "  - Why: prior auth failures",
  "",
].join("\n");

test("curatePlaybookBody drops duplicate rules and prunes the emptied section", () => {
  const { content, removed } = curatePlaybookBody(DUP_PLAYBOOK);

  assert.equal(removed, 1);
  // First occurrence of the repeated rule is kept exactly once.
  assert.equal((content.match(/Check credentials first/g) ?? []).length, 1);
  // The unique rule survives.
  assert.ok(content.includes("Keep directive tasks tiny"));
  // Goal A header (still has a rule) stays; Goal B (emptied) is pruned.
  assert.ok(content.includes("Goal A"));
  assert.ok(!content.includes("Goal B"));
});

test("curatePlaybookBody leaves a clean playbook unchanged", () => {
  const clean = "# Playbook: coo\n\n## 2026-06-12 - X (run_1)\n- The only rule\n";
  const { content, removed } = curatePlaybookBody(clean);
  assert.equal(removed, 0);
  assert.equal(content, clean);
});

test("curatePlaybooksUnder dedups markdown files under hive/playbooks and rewrites them", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-brainbee-test-"));
  try {
    const rolesDir = join(root, "hive", "playbooks", "roles");
    mkdirSync(rolesDir, { recursive: true });
    const cooPath = join(rolesDir, "coo.md");
    writeFileSync(cooPath, DUP_PLAYBOOK);

    const summary = await curatePlaybooksUnder(root, "2026-06-12T00:00:00Z");

    assert.equal(summary.scanned, 1);
    assert.equal(summary.totalRemoved, 1);
    assert.equal(summary.files.length, 1);
    assert.equal((readFileSync(cooPath, "utf-8").match(/Check credentials first/g) ?? []).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
