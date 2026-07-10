import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Project discovery + its cache live under $HOME; point HOME at a temp dir
// with one fake git repo so the scan is deterministic and isolated.
const TMP = mkdtempSync(join(tmpdir(), "hm-cc-config-test-"));
const originalHome = process.env.HOME;
process.env.HOME = TMP;

const projectDir = join(TMP, "myrepo");
mkdirSync(join(projectDir, ".git"), { recursive: true });
writeFileSync(join(projectDir, ".git", "HEAD"), "ref: refs/heads/main");
writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "myrepo" }));
writeFileSync(join(projectDir, "CLAUDE.md"), "# Project instructions\nBe terse.");
mkdirSync(join(projectDir, ".claude"), { recursive: true });
writeFileSync(join(projectDir, ".claude", "settings.json"), JSON.stringify({ model: "opus", permissions: { allow: ["Bash(git *)"] } }));
writeFileSync(join(projectDir, ".mcp.json"), JSON.stringify({ mcpServers: { canopy: { command: "canopy-mcp" } } }));
// settings.local.json deliberately absent — proves "only files that exist" holds per-file, not all-or-nothing.

const { discoverProjectsFresh } = await import("@/lib/routing/project-discovery");
discoverProjectsFresh(); // populate the cache deterministically before the config module reads it

const { listProjectConfigDocs, readProjectConfigDoc, findMatchingCodeProjectPath, CONFIG_FILE_PREFIX } = await import("./claude-code-project-config");

test.after(() => {
  process.env.HOME = originalHome;
  rmSync(TMP, { recursive: true, force: true });
});

test("findMatchingCodeProjectPath matches a Brain slug to a discovered code project, case/punctuation-insensitively", () => {
  // Compare by suffix, not strict equality — discovery may resolve /tmp's real
  // path (e.g. macOS /private/tmp symlink), which is a discovery-layer detail.
  assert.ok(findMatchingCodeProjectPath("myrepo")?.endsWith("/myrepo"));
  assert.ok(findMatchingCodeProjectPath("MyRepo")?.endsWith("/myrepo"));
  assert.equal(findMatchingCodeProjectPath("no-such-project"), null);
});

test("listProjectConfigDocs surfaces CLAUDE.md, settings.json, and .mcp.json — but not the absent settings.local.json", async () => {
  const docs = await listProjectConfigDocs("myrepo");
  const files = docs.map((d) => d.file).sort();
  assert.deepEqual(files, [
    CONFIG_FILE_PREFIX + "CLAUDE.md",
    CONFIG_FILE_PREFIX + ".mcp.json",
    CONFIG_FILE_PREFIX + "settings.json",
  ].sort());
  for (const d of docs) {
    assert.equal(d.configFile, true);
    assert.equal(d.archived, false);
    assert.equal(d.excluded, false);
    assert.equal(d.status, "brief");
    assert.ok(d.sizeBytes > 0);
  }
});

test("listProjectConfigDocs is empty for a Brain project with no matching code project", async () => {
  assert.deepEqual(await listProjectConfigDocs("some-brain-only-project"), []);
});

test("readProjectConfigDoc returns real content for each surfaced file", async () => {
  const claudeDoc = await readProjectConfigDoc("myrepo", CONFIG_FILE_PREFIX + "CLAUDE.md");
  assert.ok(claudeDoc);
  assert.match(claudeDoc!.content, /Be terse/);

  const settingsDoc = await readProjectConfigDoc("myrepo", CONFIG_FILE_PREFIX + "settings.json");
  assert.ok(settingsDoc);
  assert.match(settingsDoc!.content, /"model"/);

  const mcpDoc = await readProjectConfigDoc("myrepo", CONFIG_FILE_PREFIX + ".mcp.json");
  assert.ok(mcpDoc);
  assert.match(mcpDoc!.content, /canopy/);
});

test("readProjectConfigDoc: absent settings.local.json returns null", async () => {
  assert.equal(await readProjectConfigDoc("myrepo", CONFIG_FILE_PREFIX + "settings.local.json"), null);
});

test("readProjectConfigDoc: an unprefixed or unknown file name is rejected", async () => {
  assert.equal(await readProjectConfigDoc("myrepo", "CLAUDE.md"), null, "must carry the claude-code/ prefix");
  assert.equal(await readProjectConfigDoc("myrepo", CONFIG_FILE_PREFIX + "not-a-real-file.json"), null);
});

test("CLAUDE.md prefers the project root over .claude/CLAUDE.md when both exist", async () => {
  const other = join(TMP, "otherrepo");
  mkdirSync(join(other, ".git"), { recursive: true });
  writeFileSync(join(other, ".git", "HEAD"), "ref: refs/heads/main");
  writeFileSync(join(other, "package.json"), JSON.stringify({ name: "otherrepo" }));
  writeFileSync(join(other, "CLAUDE.md"), "root version");
  mkdirSync(join(other, ".claude"), { recursive: true });
  writeFileSync(join(other, ".claude", "CLAUDE.md"), "nested version");
  discoverProjectsFresh();

  const doc = await readProjectConfigDoc("otherrepo", CONFIG_FILE_PREFIX + "CLAUDE.md");
  assert.ok(doc);
  assert.match(doc!.content, /root version/);
});
