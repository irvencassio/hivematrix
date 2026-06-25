import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildBrainMemoryBundle, buildBrainIndexBlock, ensureHiveBrainScaffold, hiveProjectBrainDir } from "./memory-bundle";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("ensureHiveBrainScaffold seeds the canonical Hive brain structure", async () => {
  const brainRoot = mkdtempSync(join(tmpdir(), "hive-brain-"));

  const created = await ensureHiveBrainScaffold(brainRoot);
  const agentBrief = readFileSync(join(hiveProjectBrainDir(brainRoot), "agent-brief.md"), "utf-8");
  const scaffoldText = created
    .filter((path) => path.endsWith(".md"))
    .map((path) => readFileSync(path, "utf-8"))
    .join("\n\n");

  assert.ok(created.some((path) => path.endsWith("/agent-brief.md")));
  assert.ok(created.some((path) => path.endsWith("/lanes/manager.md")));
  assert.ok(created.some((path) => path.endsWith("/lanes/capability-design.md")));
  assert.ok(created.some((path) => path.endsWith("/lanes/scheduler.md")));
  assert.ok(created.some((path) => path.endsWith("/lanes/desktop.md")));
  assert.ok(created.some((path) => path.endsWith("/lanes/terminal.md")));
  assert.ok(!created.some((path) => path.includes("/bees/")));
  assert.match(scaffoldText, /Message Lane/);
  assert.match(scaffoldText, /Mail Lane/);
  assert.match(scaffoldText, /Manager Lane/);
  assert.match(scaffoldText, /Memory Lane/);
  assert.match(scaffoldText, /Desktop Lane/);
  assert.match(scaffoldText, /Terminal Lane/);
  assert.match(scaffoldText, /Capability Design Lane/);
  assert.doesNotMatch(scaffoldText, /AuthBee|ManagerBee|BrainBee|TermBee|MessageBee|MailBee|InventorBee|new Bees|other Bees|Bee Playbook/);
  assert.match(agentBrief, new RegExp(escapeRegExp(brainRoot)));
});

test("buildBrainIndexBlock lists projects + recent docs and directs the agent to search", async () => {
  const brainRoot = mkdtempSync(join(tmpdir(), "hive-brain-"));
  const projHive = join(brainRoot, "projects", "hive");
  const projCanopy = join(brainRoot, "projects", "canopy");
  mkdirSync(projHive, { recursive: true });
  mkdirSync(projCanopy, { recursive: true });
  writeFileSync(join(projHive, "2026-06-16-restart.md"), "# Restart");
  writeFileSync(join(projHive, "2026-06-20-rapidmlx.html"), "<h1>RapidMLX</h1>");
  writeFileSync(join(projCanopy, "2026-06-01-plan.md"), "# Plan");

  const block = await buildBrainIndexBlock({ brainRootDir: brainRoot });
  assert.match(block, /Brain Index/);
  assert.match(block, /hive\/:/);
  assert.match(block, /canopy\/:/);
  assert.match(block, /2026-06-20-rapidmlx\.html/);
  // newest-first within a project
  assert.ok(block.indexOf("2026-06-20-rapidmlx.html") < block.indexOf("2026-06-16-restart.md"));
  assert.match(block, /ALWAYS consult/);
});

test("buildBrainIndexBlock returns empty when there are no projects", async () => {
  const brainRoot = mkdtempSync(join(tmpdir(), "hive-brain-"));
  assert.equal(await buildBrainIndexBlock({ brainRootDir: brainRoot }), "");
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
  assert.match(bundle, /Lane Playbook \(manager\)/);
  assert.doesNotMatch(bundle, /Bee Playbook|ManagerBee/);
  assert.match(bundle, /Known Issues/);
  // Directive reflections replace mission recaps in HiveMatrix — recap content not included
});
