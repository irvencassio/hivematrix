import test from "node:test";
import assert from "node:assert/strict";
import { stalePruneCandidates, demotionCandidates } from "./prune";
import type { Skill } from "./contracts";

function skill(p: Partial<Skill>): Skill {
  return {
    name: "s", description: "", tags: [], body: "b", source: "manual",
    createdAt: "", updatedAt: "", revisions: 1, useCount: 0, lastUsedAt: "",
    compat: ["all"], trusted: true, failures: 0, probation: false, kind: "instruction", interpreter: "bash", roles: [], ...p,
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

// --- demotionCandidates -------------------------------------------------

test("demotionCandidates: trusted skill at the failures>=max(3,useCount) threshold is included", () => {
  const skills = [skill({ name: "shaky", trusted: true, failures: 3, useCount: 1 })];
  const c = demotionCandidates(skills);
  assert.deepEqual(c.map((x) => x.name), ["shaky"]);
});

test("demotionCandidates: trusted skill below the threshold is excluded", () => {
  const skills = [skill({ name: "ok", trusted: true, failures: 2, useCount: 1 })];
  assert.deepEqual(demotionCandidates(skills), []);
});

test("demotionCandidates: already-untrusted skill is excluded even past the threshold", () => {
  const skills = [skill({ name: "already-demoted", trusted: false, failures: 10, useCount: 1 })];
  assert.deepEqual(demotionCandidates(skills), []);
});

test("demotionCandidates: healthy skill (no failures) is excluded", () => {
  const skills = [skill({ name: "healthy", trusted: true, failures: 0, useCount: 20 })];
  assert.deepEqual(demotionCandidates(skills), []);
});

test("demotionCandidates: boundary — failures==useCount>=3 included, failures<useCount excluded", () => {
  const skills = [
    skill({ name: "at-boundary", trusted: true, failures: 5, useCount: 5 }),
    skill({ name: "under-boundary", trusted: true, failures: 4, useCount: 5 }),
  ];
  const c = demotionCandidates(skills);
  assert.deepEqual(c.map((x) => x.name), ["at-boundary"]);
});

test("demotionCandidates: sorted worst-first (highest failures-minus-useCount)", () => {
  const skills = [
    skill({ name: "mild", trusted: true, failures: 3, useCount: 1 }), // diff 2
    skill({ name: "severe", trusted: true, failures: 8, useCount: 1 }), // diff 7
  ];
  const c = demotionCandidates(skills);
  assert.deepEqual(c.map((x) => x.name), ["severe", "mild"]);
});

test("demotionCandidates: result shape includes name/failures/useCount/trusted", () => {
  const skills = [skill({ name: "shaky", trusted: true, failures: 3, useCount: 1 })];
  const c = demotionCandidates(skills);
  assert.deepEqual(c[0], { name: "shaky", failures: 3, useCount: 1, trusted: true });
});
