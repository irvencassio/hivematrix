import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildBrainMemoryBundle, ensureHiveBrainScaffold, hiveProjectBrainDir } from "./memory-bundle";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("ensureHiveBrainScaffold seeds the canonical Hive brain structure", async () => {
  const brainRoot = mkdtempSync(join(tmpdir(), "hive-brain-"));

  const created = await ensureHiveBrainScaffold(brainRoot);
  const agentBrief = readFileSync(join(hiveProjectBrainDir(brainRoot), "agent-brief.md"), "utf-8");

  assert.ok(created.some((path) => path.endsWith("/agent-brief.md")));
  assert.ok(created.some((path) => path.endsWith("/bees/managerbee.md")));
  assert.ok(created.some((path) => path.endsWith("/bees/inventorbee.md")));
  assert.ok(created.some((path) => path.endsWith("/bees/cronbee.md")));
  // authbee, tubebee, voicebee removed from HiveMatrix v1 scaffold
  assert.ok(!created.some((path) => path.endsWith("/bees/authbee.md")));
  assert.ok(!created.some((path) => path.endsWith("/bees/tubebee.md")));
  assert.ok(!created.some((path) => path.endsWith("/bees/voicebee.md")));
  assert.match(agentBrief, new RegExp(escapeRegExp(brainRoot)));
});

test("buildBrainMemoryBundle assembles canonical docs and matching recap excerpts", async () => {
  const brainRoot = mkdtempSync(join(tmpdir(), "hive-brain-"));
  await ensureHiveBrainScaffold(brainRoot);

  const projectDir = hiveProjectBrainDir(brainRoot);
  writeFileSync(join(projectDir, "known-issues.md"), "# Hive Known Issues\n\n- Canonical issue");

  const recapDir = join(brainRoot, "sources", "missions", "recaps");
  mkdirSync(recapDir, { recursive: true });
  writeFileSync(
    join(recapDir, "2026-05-09-hive-worker-contract-recap.md"),
    `# Mission Recap: Hive Worker Contract

**Date**: 2026-05-09
**Project**: hive
**Path**: /Users/irvencassio/Hive
**Status**: PASS

## Outcome Summary

Worker contract landed cleanly.
`
  );
  writeFileSync(
    join(recapDir, "2026-05-09-other-project-recap.md"),
    `# Mission Recap: Other Project

**Date**: 2026-05-09
**Project**: other
**Path**: /tmp/other
**Status**: PASS
`
  );

  const bundle = await buildBrainMemoryBundle({
    brainRootDir: brainRoot,
    project: "hive",
    bee: "managerbee",
    recapLimit: 2,
  });

  assert.match(bundle, /Brain Memory Bundle/);
  assert.match(bundle, /Brain Doc Policy/);
  assert.match(bundle, new RegExp(escapeRegExp(brainRoot)));
  assert.match(bundle, /Agent Brief/);
  assert.match(bundle, /Bee Playbook \(managerbee\)/);
  assert.match(bundle, /Known Issues/);
  // Directive reflections replace mission recaps in HiveMatrix — recap content not included
});
