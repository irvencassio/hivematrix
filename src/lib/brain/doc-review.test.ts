import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { classifyDoc, isProjectBriefLoaded, isCtxLoadedFile } from "./doc-review";

test("classifyDoc precedence: excluded > brief > ctx > stale > indexed > orphan", () => {
  const base = { isExcluded: false, isBriefLoaded: false, isCtxLoaded: false, isStale: false, isIndexed: false };
  assert.equal(classifyDoc({ ...base }).status, "orphan");
  assert.equal(classifyDoc({ ...base, isIndexed: true }).status, "indexed");
  assert.equal(classifyDoc({ ...base, isIndexed: true, isStale: true }).status, "stale", "stale wins over indexed");
  assert.equal(classifyDoc({ ...base, isStale: true, isCtxLoaded: true }).status, "ctx", "ctx wins over stale");
  assert.equal(classifyDoc({ ...base, isCtxLoaded: true, isBriefLoaded: true }).status, "brief", "brief wins over ctx");
  assert.equal(classifyDoc({ ...base, isBriefLoaded: true, isExcluded: true }).status, "excluded", "excluded wins over everything");
});

test("classifyDoc returns the matching emoji badge", () => {
  const base = { isExcluded: false, isBriefLoaded: false, isCtxLoaded: false, isStale: false, isIndexed: false };
  assert.equal(classifyDoc({ ...base, isBriefLoaded: true }).badge, "⭐");
  assert.equal(classifyDoc({ ...base, isCtxLoaded: true }).badge, "🟢");
  assert.equal(classifyDoc({ ...base, isStale: true }).badge, "🟠");
  assert.equal(classifyDoc({ ...base, isIndexed: true }).badge, "🔵");
  assert.equal(classifyDoc({ ...base }).badge, "⚪");
  assert.equal(classifyDoc({ ...base, isExcluded: true }).badge, "🔴");
});

test("isProjectBriefLoaded: only hive's root-level agent-brief.md", () => {
  assert.equal(isProjectBriefLoaded("hive", "agent-brief.md"), true);
  assert.equal(isProjectBriefLoaded("hive", "lanes/agent-brief.md"), false, "must be root-level, not nested");
  assert.equal(isProjectBriefLoaded("solo-founder-os", "agent-brief.md"), false, "only the canonical project");
});

test("isCtxLoadedFile: known-issues.md and any lanes/*.md, hive only", () => {
  assert.equal(isCtxLoadedFile("hive", "known-issues.md"), true);
  assert.equal(isCtxLoadedFile("hive", "lanes/manager.md"), true);
  assert.equal(isCtxLoadedFile("hive", "lanes/terminal.md"), true);
  assert.equal(isCtxLoadedFile("hive", "current-state.md"), false, "scaffolded but never loaded");
  assert.equal(isCtxLoadedFile("hive", "decisions.md"), false, "scaffolded but never loaded");
  assert.equal(isCtxLoadedFile("solo-founder-os", "known-issues.md"), false, "only the canonical project");
});

// ── Integration: temp HOME + brain root, mirroring the Phase-1 checkpoint ──

async function withFixture<T>(run: (ctx: { home: string; root: string }) => Promise<T>): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "hm-doc-review-"));
  const root = join(home, "brain");
  const originalHome = process.env.HOME;
  mkdirSync(join(home, ".hivematrix"), { recursive: true });
  writeFileSync(join(home, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: root } }));

  const proj = join(root, "projects", "hive");
  mkdirSync(join(proj, "lanes"), { recursive: true });
  const now = Date.now();
  const old = now - 200 * 86_400_000; // 200 days ago — stale
  writeFileSync(join(proj, "agent-brief.md"), "# Hive Agent Brief\n");
  writeFileSync(join(proj, "known-issues.md"), "# Known Issues\n");
  writeFileSync(join(proj, "current-state.md"), "# Current State\n");
  writeFileSync(join(proj, "decisions.md"), "# Decisions\n");
  writeFileSync(join(proj, "lanes", "manager.md"), "# Manager Lane\n");
  writeFileSync(join(proj, "scratch.md"), "# scratch\ntodo\n");
  // Backdate current-state.md and scratch.md so they read as stale (mtime-based).
  utimesSync(join(proj, "current-state.md"), new Date(old), new Date(old));
  utimesSync(join(proj, "scratch.md"), new Date(old), new Date(old));

  process.env.HOME = home;
  try {
    return await run({ home, root });
  } finally {
    process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  }
}

test("listProjects lists the hive project with its doc count", async () => {
  await withFixture(async () => {
    const { listProjects } = await import("./doc-review");
    const projects = await listProjects();
    const hive = projects.find((p) => p.slug === "hive");
    assert.ok(hive, "hive project listed");
    assert.equal(hive!.docCount, 6); // brief, known-issues, current-state, decisions, lanes/manager, scratch
  });
});

test("listProjectDocs classifies each fixture doc per the Phase-1 checkpoint", async () => {
  await withFixture(async () => {
    const { listProjectDocs } = await import("./doc-review");
    const { docs } = await listProjectDocs("hive", { staleDays: 180 });
    const byFile = new Map(docs.map((d) => [d.file, d]));

    assert.equal(byFile.get("agent-brief.md")?.status, "brief");
    assert.equal(byFile.get("known-issues.md")?.status, "ctx");
    assert.equal(byFile.get("lanes/manager.md")?.status, "ctx");
    // current-state.md is backdated stale AND never loaded — must show stale, not ctx.
    assert.equal(byFile.get("current-state.md")?.status, "stale");
    assert.equal(byFile.get("decisions.md")?.status, "orphan", "not loaded, not indexed, not stale");
    // scratch.md is backdated too, so it reads as stale (mtime-based) rather than orphan —
    // "stale" and the mockup's "orphan" example aren't mutually achievable from mtime alone.
    assert.equal(byFile.get("scratch.md")?.status, "stale");

    for (const d of docs) {
      assert.equal(d.project, "hive");
      assert.equal(d.archived, false);
      assert.equal(d.excluded, false);
      assert.equal(typeof d.modified, "number");
      assert.ok(d.sizeBytes > 0);
    }
  });
});

test("listProjectDocs: a fresh, non-stale, unindexed, unloaded doc classifies as orphan", async () => {
  await withFixture(async ({ root }) => {
    writeFileSync(join(root, "projects", "hive", "fresh-note.md"), "# Fresh\nnot loaded, not indexed, not stale");
    const { listProjectDocs } = await import("./doc-review");
    const { docs } = await listProjectDocs("hive");
    assert.equal(docs.find((d) => d.file === "fresh-note.md")?.status, "orphan");
  });
});

test("listProjectDocs: unknown project → empty, no throw", async () => {
  await withFixture(async () => {
    const { listProjectDocs } = await import("./doc-review");
    const { docs } = await listProjectDocs("does-not-exist");
    assert.deepEqual(docs, []);
  });
});

test("listProjectDocs: path-traversal in the slug is rejected", async () => {
  await withFixture(async () => {
    const { listProjectDocs } = await import("./doc-review");
    const { docs } = await listProjectDocs("../../etc");
    assert.deepEqual(docs, []);
  });
});

test("readProjectDoc returns raw content + brain-relative path", async () => {
  await withFixture(async () => {
    const { readProjectDoc } = await import("./doc-review");
    const doc = await readProjectDoc("hive", "agent-brief.md");
    assert.ok(doc);
    assert.match(doc!.content, /Hive Agent Brief/);
    assert.equal(doc!.path, join("projects", "hive", "agent-brief.md"));
    assert.ok(doc!.sizeBytes > 0);
  });
});

test("readProjectDoc: path traversal in relFile is rejected", async () => {
  await withFixture(async () => {
    const { readProjectDoc } = await import("./doc-review");
    assert.equal(await readProjectDoc("hive", "../../../etc/passwd"), null);
    assert.equal(await readProjectDoc("hive", "/etc/passwd"), null);
  });
});

test("readProjectDoc: missing file returns null, does not throw", async () => {
  await withFixture(async () => {
    const { readProjectDoc } = await import("./doc-review");
    assert.equal(await readProjectDoc("hive", "nope.md"), null);
  });
});
