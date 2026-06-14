import test from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, topK } from "./vector";
import { planReindex, contentHash, indexToItems, type IndexFile } from "./index-store";
import { mergeHybrid } from "./search";

test("cosineSimilarity: identical=1, orthogonal=0, opposite=-1, zero-safe", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test("topK ranks by similarity, descending, bounded", () => {
  const items = [
    { id: "a", vector: [1, 0] },
    { id: "b", vector: [0.9, 0.1] },
    { id: "c", vector: [0, 1] },
  ];
  const ranked = topK([1, 0], items, 2);
  assert.deepEqual(ranked.map((r) => r.id), ["a", "b"]);
  assert.ok(ranked[0].score >= ranked[1].score);
});

test("planReindex: new + changed embed, gone pruned, model-change resets", () => {
  const index: IndexFile = { model: "m1", entries: { "a.md": { hash: "h1", vector: [1] }, "old.md": { hash: "h", vector: [1] } } };
  const files = [{ relPath: "a.md", hash: "h1" }, { relPath: "b.md", hash: "h2" }];

  const same = planReindex(files, index, "m1");
  assert.deepEqual(same.toEmbed, ["b.md"], "a unchanged, b is new");
  assert.deepEqual(same.toPrune, ["old.md"], "old.md gone from disk");
  assert.equal(same.reset, false);

  const changed = planReindex([{ relPath: "a.md", hash: "H1-NEW" }], index, "m1");
  assert.deepEqual(changed.toEmbed, ["a.md"], "content hash changed → re-embed");

  const reset = planReindex(files, index, "m2");
  assert.equal(reset.reset, true);
  assert.deepEqual(reset.toEmbed.sort(), ["a.md", "b.md"], "model change re-embeds all");
  assert.deepEqual(reset.toPrune, [], "reset rebuilds, nothing to prune");
});

test("contentHash is stable + change-sensitive; indexToItems flattens", () => {
  assert.equal(contentHash("hello"), contentHash("hello"));
  assert.notEqual(contentHash("hello"), contentHash("hello!"));
  const items = indexToItems({ model: "m", entries: { "x.md": { hash: "h", vector: [1, 2] } } });
  assert.deepEqual(items, [{ id: "x.md", vector: [1, 2] }]);
});

test("mergeHybrid blends keyword + semantic, unions paths, tags sources", () => {
  const keyword = [{ path: "kw.md", score: 10, snippet: "kw snip" }, { path: "both.md", score: 5, snippet: "both snip" }];
  const semantic = [{ path: "both.md", score: 1 }, { path: "sem.md", score: 0.8 }];
  const merged = mergeHybrid(keyword, semantic);
  const paths = merged.map((m) => m.path);
  assert.ok(paths.includes("kw.md") && paths.includes("sem.md") && paths.includes("both.md"));
  const both = merged.find((m) => m.path === "both.md")!;
  assert.deepEqual(both.sources.sort(), ["keyword", "semantic"]);
  assert.equal(both.snippet, "both snip");
  // both.md (in both sets) should outrank sem-only / kw-only with lower blended score
  assert.equal(merged[0].path, "both.md");
});
