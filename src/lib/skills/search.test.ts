import test from "node:test";
import assert from "node:assert/strict";
import { rankSkills } from "./search";
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
