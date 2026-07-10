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

test("listPinnedDocs is empty when neither CLAUDE.md nor settings.json exist", async () => {
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
    assert.equal(docs[0].configFile, true);
    assert.ok(docs[0].sizeBytes > 0);
  });
});

test("listPinnedDocs also surfaces settings.json independently when present", async () => {
  await withTempHome(async () => {
    const { listPinnedDocs, userSettingsJsonPath } = await import("./pinned");
    mkdirSync(join(process.env.HOME!, ".claude"), { recursive: true });
    writeFileSync(userSettingsJsonPath(), JSON.stringify({ model: "opus" }));
    const docs = await listPinnedDocs();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].file, "settings.json");
    assert.equal(docs[0].configFile, true);
  });
});

test("listPinnedDocs shows both files when both exist", async () => {
  await withTempHome(async () => {
    const { listPinnedDocs, userClaudeMdPath, userSettingsJsonPath } = await import("./pinned");
    mkdirSync(join(process.env.HOME!, ".claude"), { recursive: true });
    writeFileSync(userClaudeMdPath(), "# Instructions");
    writeFileSync(userSettingsJsonPath(), JSON.stringify({ model: "opus" }));
    const docs = await listPinnedDocs();
    assert.deepEqual(docs.map((d) => d.file).sort(), ["CLAUDE.md", "settings.json"]);
  });
});

test("readPinnedDoc returns real content for either known file, and null for anything else", async () => {
  await withTempHome(async () => {
    const { readPinnedDoc, userClaudeMdPath, userSettingsJsonPath } = await import("./pinned");
    mkdirSync(join(process.env.HOME!, ".claude"), { recursive: true });
    writeFileSync(userClaudeMdPath(), "# Instructions\nBe concise.");
    writeFileSync(userSettingsJsonPath(), JSON.stringify({ model: "opus" }));

    const claudeDoc = await readPinnedDoc("CLAUDE.md");
    assert.ok(claudeDoc);
    assert.match(claudeDoc!.content, /Be concise/);

    const settingsDoc = await readPinnedDoc("settings.json");
    assert.ok(settingsDoc);
    assert.match(settingsDoc!.content, /"model"/);

    assert.equal(await readPinnedDoc("MEMORY.md"), null, "only known pinned files are valid");
    assert.equal(await readPinnedDoc("../../etc/passwd"), null);
  });
});

test("readPinnedDoc returns null when the file does not exist", async () => {
  await withTempHome(async () => {
    const { readPinnedDoc } = await import("./pinned");
    assert.equal(await readPinnedDoc("CLAUDE.md"), null);
    assert.equal(await readPinnedDoc("settings.json"), null);
  });
});
