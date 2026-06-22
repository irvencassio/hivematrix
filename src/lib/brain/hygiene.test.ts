import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContent, jaccard, findDuplicates, findStale, type BrainDoc } from "./hygiene";

test("normalizeContent strips frontmatter, markup, and case", () => {
  const n = normalizeContent("---\nname: x\n---\n# Title\n**Bold** `code` text");
  assert.equal(n.includes("name"), false); // frontmatter dropped
  assert.match(n, /title bold code text/);
});

test("jaccard: identical sets = 1, disjoint = 0", () => {
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["a", "b"])), 1);
  assert.equal(jaccard(new Set(["a"]), new Set(["b"])), 0);
});

test("findDuplicates flags exact and near matches, sorted by similarity", () => {
  const docs: BrainDoc[] = [
    { path: "a.md", content: "the quick brown fox jumps over the lazy dog today", mtimeMs: 0 },
    { path: "b.md", content: "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG TODAY", mtimeMs: 0 }, // exact after normalize
    { path: "c.md", content: "the quick brown fox jumps over the lazy dog tomorrow morning", mtimeMs: 0 }, // near
    { path: "d.md", content: "completely unrelated content about kubernetes pods", mtimeMs: 0 },
  ];
  const groups = findDuplicates(docs, { threshold: 0.5 });
  const exact = groups.find((g) => g.kind === "exact");
  assert.ok(exact && exact.docs.includes("a.md") && exact.docs.includes("b.md"));
  assert.equal(groups[0].similarity, 1); // exact sorts first
  assert.ok(groups.some((g) => g.docs.includes("c.md"))); // near match present
  assert.ok(!groups.some((g) => g.docs.includes("d.md"))); // unrelated excluded
});

test("findStale flags docs older than staleDays, most-stale first", () => {
  const now = Date.parse("2026-06-22T00:00:00Z");
  const day = 86_400_000;
  const docs: BrainDoc[] = [
    { path: "old.md", content: "x", mtimeMs: now - 400 * day },
    { path: "fresh.md", content: "y", mtimeMs: now - 10 * day },
    { path: "borderline.md", content: "z", mtimeMs: now - 200 * day },
  ];
  const stale = findStale(docs, { now, staleDays: 180 });
  assert.deepEqual(stale.map((s) => s.path), ["old.md", "borderline.md"]);
  assert.equal(stale[0].ageDays, 400);
});
