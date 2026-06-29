import test from "node:test";
import assert from "node:assert/strict";
import { rankSkills, filterSkillsByHarness, getSkillCompatibility } from "./search";
import type { SkillIndexEntry } from "./contracts";

function e(p: Partial<SkillIndexEntry>): SkillIndexEntry {
  return {
    name: "n", description: "", tags: [], useCount: 0, compat: ["all"],
    hasInput: false, trusted: true, kind: "instruction", ...p,
  };
}

const lib: SkillIndexEntry[] = [
  e({ name: "deploy-release", description: "cut and ship a release", tags: ["ops", "release"], useCount: 12 }),
  e({ name: "release-notes", description: "draft release notes from commits", tags: ["docs"], useCount: 3 }),
  e({ name: "summarize-pr", description: "summarize a pull request", tags: ["review"], useCount: 0 }),
];

test("empty query → all, most-used first", () => {
  const r = rankSkills(lib, "");
  assert.deepEqual(r.map((x) => x.name), ["deploy-release", "release-notes", "summarize-pr"]);
});

test("name/tag matches surface; non-matches excluded; proven multi-field match leads", () => {
  const r = rankSkills(lib, "release");
  // deploy-release (name+tag+desc+12 uses) outscores release-notes (name-prefix+desc)
  assert.deepEqual(r.map((x) => x.name), ["deploy-release", "release-notes"]);
  assert.ok(!r.find((x) => x.name === "summarize-pr")); // no match at all
});

test("tag match surfaces a skill not named for the term", () => {
  const r = rankSkills(lib, "ops");
  assert.deepEqual(r.map((x) => x.name), ["deploy-release"]);
});

test("multi-word query requires every term to contribute", () => {
  assert.equal(rankSkills(lib, "summarize request").map((x) => x.name).join(","), "summarize-pr");
  assert.equal(rankSkills(lib, "summarize nonexistentword").length, 0);
});

test("no match → empty", () => {
  assert.deepEqual(rankSkills(lib, "kubernetes"), []);
});

const mixedLib: SkillIndexEntry[] = [
  e({ name: "claude-only", compat: ["claude"] }),
  e({ name: "codex-only", compat: ["codex"] }),
  e({ name: "qwen-only", compat: ["qwen"] }),
  e({ name: "claude-and-codex", compat: ["claude", "codex"] }),
  e({ name: "any-harness", compat: ["all"] }),
  e({ name: "empty-compat", compat: [] }),
];

test("filterSkillsByHarness: claude sees claude-specific and 'all' skills", () => {
  const r = filterSkillsByHarness(mixedLib, "claude");
  const names = r.map((x) => x.name);
  assert.ok(names.includes("claude-only"));
  assert.ok(names.includes("claude-and-codex"));
  assert.ok(names.includes("any-harness"));
  assert.ok(names.includes("empty-compat")); // empty compat = any
  assert.ok(!names.includes("codex-only"));
  assert.ok(!names.includes("qwen-only"));
});

test("filterSkillsByHarness: qwen only sees qwen-specific and 'all' skills", () => {
  const r = filterSkillsByHarness(mixedLib, "qwen");
  const names = r.map((x) => x.name);
  assert.ok(names.includes("qwen-only"));
  assert.ok(names.includes("any-harness"));
  assert.ok(!names.includes("claude-only"));
  assert.ok(!names.includes("codex-only"));
  assert.ok(!names.includes("claude-and-codex"));
});

test("filterSkillsByHarness: empty list stays empty", () => {
  assert.deepEqual(filterSkillsByHarness([], "codex"), []);
});

// --- getSkillCompatibility ---

test("getSkillCompatibility returns the entry for a known skill", () => {
  const entry = getSkillCompatibility("usageleft");
  assert.ok(entry !== null, "usageleft must be in the registry");
  assert.equal(entry.claude, true);
  assert.equal(entry.codex, false);
  assert.equal(entry.qwen, false);
  assert.equal(typeof entry.description, "string");
  assert.ok(entry.description.length > 0);
});

test("getSkillCompatibility returns correct flags for a multi-harness skill", () => {
  const entry = getSkillCompatibility("claude-docs");
  assert.ok(entry !== null);
  assert.equal(entry.claude, true);
  assert.equal(entry.codex, false);
  assert.equal(entry.qwen, false);
});

test("getSkillCompatibility returns null for an unknown skill ID", () => {
  assert.equal(getSkillCompatibility("nonexistent-skill-xyz"), null);
});

test("getSkillCompatibility returns null for an empty string", () => {
  assert.equal(getSkillCompatibility(""), null);
});
