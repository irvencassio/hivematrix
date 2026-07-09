import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function withTempHome<T>(run: () => Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const tempHome = mkdtempSync(join(tmpdir(), "hm-pinned-"));
  process.env.HOME = tempHome;
  return (async () => {
    try {
      return await run();
    } finally {
      process.env.HOME = originalHome;
      rmSync(tempHome, { recursive: true, force: true });
    }
  })();
}

test("listPinnedDocs is empty when ~/.claude/CLAUDE.md does not exist", async () => {
  await withTempHome(async () => {
    const { listPinnedDocs } = await import("./pinned");
    assert.deepEqual(await listPinnedDocs(), []);
  });
});

test("listPinnedDocs surfaces CLAUDE.md forced to 'brief' status when it exists", async () => {
  await withTempHome(async () => {
    const { listPinnedDocs, userClaudeMdPath } = await import("./pinned");
    mkdirSync(join(process.env.HOME!, ".claude"), { recursive: true });
    writeFileSync(userClaudeMdPath(), "# Instructions\nBe concise.");
    const docs = await listPinnedDocs();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].file, "CLAUDE.md");
    assert.equal(docs[0].project, "__pinned__");
    assert.equal(docs[0].status, "brief");
    assert.equal(docs[0].badge, "⭐");
    assert.equal(docs[0].archived, false);
    assert.equal(docs[0].excluded, false);
    assert.ok(docs[0].sizeBytes > 0);
  });
});

test("readPinnedDoc returns CLAUDE.md's real content, and null for anything else", async () => {
  await withTempHome(async () => {
    const { readPinnedDoc, userClaudeMdPath } = await import("./pinned");
    mkdirSync(join(process.env.HOME!, ".claude"), { recursive: true });
    writeFileSync(userClaudeMdPath(), "# Instructions\nBe concise.");
    const doc = await readPinnedDoc("CLAUDE.md");
    assert.ok(doc);
    assert.match(doc!.content, /Be concise/);
    assert.equal(await readPinnedDoc("MEMORY.md"), null, "only CLAUDE.md is a valid pinned file");
    assert.equal(await readPinnedDoc("../../etc/passwd"), null);
  });
});

test("readPinnedDoc returns null when the file does not exist", async () => {
  await withTempHome(async () => {
    const { readPinnedDoc } = await import("./pinned");
    assert.equal(await readPinnedDoc("CLAUDE.md"), null);
  });
});
