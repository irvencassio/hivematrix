import test from "node:test";
import assert from "node:assert/strict";
import { skillSlug, skillFilename, renderSkillFile, parseSkillFile, formatSkillIndex, skillRunsOn, skillHasInput, applySkillInput, type Skill } from "./contracts";

function skill(over: Partial<Skill> = {}): Skill {
  return {
    name: over.name ?? "deploy-release",
    description: over.description ?? "How to cut a release",
    tags: over.tags ?? ["ops", "release"],
    body: over.body ?? "When releasing:\n1. bump version\n2. tag\n3. push",
    source: over.source ?? "directive:run9",
    createdAt: over.createdAt ?? "2026-06-14T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-06-14T00:00:00.000Z",
    revisions: over.revisions ?? 1,
    useCount: over.useCount ?? 0,
    lastUsedAt: over.lastUsedAt ?? "",
    compat: over.compat ?? ["all"],
    trusted: over.trusted ?? true,
    kind: over.kind ?? "instruction",
    interpreter: over.interpreter ?? "bash",
  };
}

test("skillSlug + skillFilename are safe and stable", () => {
  assert.equal(skillSlug("Deploy a Release!! v2"), "deploy-a-release-v2");
  assert.equal(skillFilename("Deploy a Release"), "deploy-a-release.md");
});

test("renderSkillFile → parseSkillFile round-trips (incl. useCount)", () => {
  const s = skill({ useCount: 4, lastUsedAt: "2026-06-14T01:00:00.000Z", revisions: 2 });
  const parsed = parseSkillFile(renderSkillFile(s));
  assert.ok(parsed);
  assert.equal(parsed!.name, s.name);
  assert.equal(parsed!.description, s.description);
  assert.deepEqual(parsed!.tags, s.tags);
  assert.equal(parsed!.body, s.body);
  assert.equal(parsed!.source, s.source);
  assert.equal(parsed!.revisions, 2);
  assert.equal(parsed!.useCount, 4);
  assert.equal(parsed!.lastUsedAt, "2026-06-14T01:00:00.000Z");
});

test("compat round-trips and skillRunsOn gates by harness", () => {
  const s = skill({ compat: ["claude", "codex"] });
  const parsed = parseSkillFile(renderSkillFile(s))!;
  assert.deepEqual(parsed.compat, ["claude", "codex"]);
  assert.equal(skillRunsOn(parsed.compat, "claude"), true);
  assert.equal(skillRunsOn(parsed.compat, "qwen"), false);
  assert.equal(skillRunsOn(["all"], "qwen"), true);
  assert.equal(skillRunsOn([], "qwen"), true); // empty = any
});

test("a skill with no compat frontmatter defaults to all harnesses", () => {
  const parsed = parseSkillFile("---\nname: x\ndescription: d\n---\nbody")!;
  assert.deepEqual(parsed.compat, ["all"]);
});

test("skillHasInput + applySkillInput handle the {{input}} slot", () => {
  assert.equal(skillHasInput("do {{input}} now"), true);
  assert.equal(skillHasInput("no slot here"), false);
  assert.equal(applySkillInput("summarize {{input}}", "this article"), "summarize this article");
  assert.match(applySkillInput("a fixed recipe", "extra context"), /--- Input ---\nextra context/);
});

test("formatSkillIndex shows use counts for proven skills", () => {
  const idx = formatSkillIndex([{ name: "a", description: "do a", tags: [], useCount: 3, compat: ["all"], hasInput: false, trusted: true, kind: "instruction" }, { name: "b", description: "do b", tags: [], useCount: 0, compat: ["all"], hasInput: false, trusted: true, kind: "instruction" }]);
  assert.match(idx, /- a \(used 3×\): do a/);
  assert.match(idx, /- b: do b/);
});

test("parseSkillFile rejects malformed content", () => {
  assert.equal(parseSkillFile("no frontmatter here"), null);
  assert.equal(parseSkillFile("---\ndescription: missing name\n---\nbody"), null);
});

test("formatSkillIndex lists name: description, empty when no skills", () => {
  assert.equal(formatSkillIndex([]), "");
  const idx = formatSkillIndex([{ name: "a", description: "do a", tags: [], useCount: 0, compat: ["all"], hasInput: false, trusted: true, kind: "instruction" }, { name: "b", description: "do b", tags: [], useCount: 0, compat: ["all"], hasInput: false, trusted: true, kind: "instruction" }]);
  assert.match(idx, /Skill Library/);
  assert.match(idx, /- a: do a/);
  assert.match(idx, /- b: do b/);
});
