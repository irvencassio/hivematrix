import test from "node:test";
import assert from "node:assert/strict";
import { stalePruneCandidates } from "./prune";
import type { Skill } from "./contracts";

function skill(p: Partial<Skill>): Skill {
  return {
    name: "s", description: "", tags: [], body: "b", source: "manual",
    createdAt: "", updatedAt: "", revisions: 1, useCount: 0, lastUsedAt: "",
    compat: ["all"], trusted: true, kind: "instruction", interpreter: "bash", ...p,
  };
}

const NOW = Date.parse("2026-06-22T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

test("idle: used but cold past idleDays is flagged; recent is not", () => {
  const skills = [
    skill({ name: "cold", useCount: 5, lastUsedAt: daysAgo(90) }),
    skill({ name: "warm", useCount: 5, lastUsedAt: daysAgo(10) }),
  ];
  const c = stalePruneCandidates(skills, { now: NOW, idleDays: 60 });
  assert.deepEqual(c.map((x) => x.name), ["cold"]);
  assert.equal(c[0].reason, "idle");
  assert.equal(c[0].ageDays, 90);
});

test("never-used: flagged only after the grace window", () => {
  const skills = [
    skill({ name: "old-unused", useCount: 0, createdAt: daysAgo(45) }),
    skill({ name: "fresh-unused", useCount: 0, createdAt: daysAgo(5) }),
  ];
  const c = stalePruneCandidates(skills, { now: NOW, neverUsedGraceDays: 30 });
  assert.deepEqual(c.map((x) => x.name), ["old-unused"]);
  assert.equal(c[0].reason, "never-used");
});

test("sorted most-stale first", () => {
  const skills = [
    skill({ name: "a", useCount: 1, lastUsedAt: daysAgo(70) }),
    skill({ name: "b", useCount: 1, lastUsedAt: daysAgo(120) }),
  ];
  const c = stalePruneCandidates(skills, { now: NOW, idleDays: 60 });
  assert.deepEqual(c.map((x) => x.name), ["b", "a"]);
});
