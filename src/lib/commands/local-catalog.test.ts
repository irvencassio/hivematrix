import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Fixtures live under a temp HOME so getActiveProfile() falls back to ".claude"
// (no ~/.hivematrix/config.json present). HOME must be set before importing the
// module-under-test, since resolveConfigDir reads homedir() at call time.
const TMP = mkdtempSync(join(tmpdir(), "hm-cmds-"));
const HOME = join(TMP, "home");
const CFG = join(HOME, ".claude");
mkdirSync(join(CFG, "commands", "ns"), { recursive: true });
mkdirSync(join(CFG, "skills", "puller"), { recursive: true });
mkdirSync(join(CFG, "skills", "quietskill"), { recursive: true });
const origHome = process.env.HOME;
process.env.HOME = HOME;

writeFileSync(
  join(CFG, "commands", "import-all.md"),
  "---\ndescription: Import everything\nargument-hint: <target>\nmodel: opus\n---\nDo the import $ARGUMENTS",
);
writeFileSync(join(CFG, "commands", "ns", "sub.md"), "no frontmatter body");
writeFileSync(
  join(CFG, "skills", "puller", "SKILL.md"),
  "---\nname: puller\ndescription: pulls things\nallowed-tools: Bash\n---\nRun pull.sh then report.",
);
writeFileSync(join(CFG, "skills", "puller", "pull.sh"), "#!/bin/sh\necho hi");
writeFileSync(
  join(CFG, "skills", "quietskill", "SKILL.md"),
  "---\nname: quietskill\ndescription: not invocable\nuser-invocable: false\n---\nhidden",
);

const { scanLocalCommands, readManifestBody } = await import("./local-catalog");
const { parseCommandFile, parseSkillManifest, splitFrontmatter } = await import("./contracts");

test.after(() => { process.env.HOME = origHome; rmSync(TMP, { recursive: true, force: true }); });

test("splitFrontmatter handles a missing frontmatter block", () => {
  const r = splitFrontmatter("just a body");
  assert.deepEqual(r.fm, {});
  assert.equal(r.body, "just a body");
});

test("splitFrontmatter folds a YAML block-scalar description (>-)", () => {
  const content = "---\nname: pushall\ndescription: >-\n  Push everything to the\n  remote in one go.\nallowed-tools: Bash\n---\nbody here";
  const { fm, body } = splitFrontmatter(content);
  assert.equal(fm.name, "pushall");
  assert.equal(fm.description, "Push everything to the remote in one go.");
  assert.equal(fm["allowed-tools"], "Bash", "key after the block scalar still parses");
  assert.equal(body, "body here");
});

test("parseCommandFile reads frontmatter + keeps the namespaced invokeName", () => {
  const c = parseCommandFile("---\ndescription: x\nargument-hint: <a>\n---\nbody", "ns:sub", "/p");
  assert.equal(c.invokeName, "ns:sub");
  assert.equal(c.kind, "command");
  assert.equal(c.description, "x");
  assert.equal(c.argumentHint, "<a>");
  assert.equal(c.hasBundledFiles, false);
  assert.deepEqual(c.compat, ["all"]);
});

test("parseCommandFile infers model compatibility", () => {
  assert.deepEqual(parseCommandFile("---\nmodel: all\n---\nbody", "c", "/p").compat, ["all"]);
  assert.deepEqual(parseCommandFile("---\nmodel: any\n---\nbody", "c", "/p").compat, ["all"]);
  assert.deepEqual(parseCommandFile("---\nmodel: '*'\n---\nbody", "c", "/p").compat, ["all"]);
  assert.deepEqual(parseCommandFile("---\nmodel: opus\n---\nbody", "c", "/p").compat, ["claude"]);
  assert.deepEqual(parseCommandFile("---\nmodel: sonnet\n---\nbody", "c", "/p").compat, ["claude"]);
  assert.deepEqual(parseCommandFile("---\nmodel: haiku\n---\nbody", "c", "/p").compat, ["claude"]);
  assert.deepEqual(parseCommandFile("---\nmodel: claude-opus-4\n---\nbody", "c", "/p").compat, ["claude"]);
  assert.deepEqual(parseCommandFile("---\nmodel: codex\n---\nbody", "c", "/p").compat, ["codex"]);
  assert.deepEqual(parseCommandFile("---\nmodel: gpt-5\n---\nbody", "c", "/p").compat, ["codex"]);
  assert.deepEqual(parseCommandFile("---\nmodel: chatgpt\n---\nbody", "c", "/p").compat, ["codex"]);
  assert.deepEqual(parseCommandFile("---\nmodel: openai-gpt-5\n---\nbody", "c", "/p").compat, ["codex"]);
  assert.deepEqual(parseCommandFile("---\nmodel: qwen3\n---\nbody", "c", "/p").compat, ["qwen"]);
  assert.deepEqual(parseCommandFile("---\nmodel: unknown-future-model\n---\nbody", "c", "/p").compat, ["all"]);
  assert.deepEqual(parseCommandFile("---\nmodel: qwen3, unknown-future-model\n---\nbody", "c", "/p").compat, ["all"]);
});

test("parseSkillManifest reads name + bundled flag", () => {
  const s = parseSkillManifest("---\nname: puller\ndescription: d\n---\nbody", "puller", "/p/SKILL.md", 1);
  assert.equal(s.kind, "skill");
  assert.equal(s.invokeName, "puller");
  assert.equal(s.hasBundledFiles, true);
  assert.equal(s.bundledFileCount, 1);
  assert.deepEqual(s.compat, ["all"]);
});

test("scanLocalCommands discovers both sources, namespacing, bundled detection", async () => {
  const all = await scanLocalCommands();
  const names = all.map((c) => c.invokeName);
  assert.ok(names.includes("import-all"));
  assert.ok(names.includes("ns:sub"), "subdir namespacing → ns:sub");
  assert.ok(names.includes("puller"));
  const puller = all.find((c) => c.invokeName === "puller");
  assert.equal(puller?.kind, "skill");
  assert.equal(puller?.hasBundledFiles, true, "pull.sh counted as a bundled file");
  const ia = all.find((c) => c.invokeName === "import-all");
  assert.equal(ia?.model, "opus");
  assert.deepEqual(ia?.compat, ["claude"]);
});

test("scanLocalCommands excludes user-invocable:false skills", async () => {
  const all = await scanLocalCommands();
  assert.ok(!all.some((c) => c.invokeName === "quietskill"), "quietskill is filtered out");
});

test("scanLocalCommands sorts commands before skills", async () => {
  const all = await scanLocalCommands();
  const firstSkillIdx = all.findIndex((c) => c.kind === "skill");
  const lastCmdIdx = all.map((c) => c.kind).lastIndexOf("command");
  assert.ok(firstSkillIdx === -1 || lastCmdIdx < firstSkillIdx);
});

test("scanLocalCommands → [] for a missing config dir", async () => {
  const all = await scanLocalCommands(".claude-does-not-exist");
  assert.deepEqual(all, []);
});

test("readManifestBody strips frontmatter, keeps the body", async () => {
  const body = await readManifestBody(join(CFG, "skills", "puller", "SKILL.md"));
  assert.match(body ?? "", /Run pull\.sh/);
  assert.doesNotMatch(body ?? "", /allowed-tools/);
});

test("readManifestBody → null for a missing file", async () => {
  const body = await readManifestBody(join(CFG, "skills", "nope", "SKILL.md"));
  assert.equal(body, null);
});
