import test from "node:test";
import assert from "node:assert/strict";
import { optionsForRam, optionFor, quantForAlias, LOCAL_MODEL_CATALOG, validateSelection } from "./local-quant";

test("optionsForRam: below 32GB offers nothing", () => {
  assert.deepEqual(optionsForRam(24), []);
});

test("optionsForRam: 32-63GB offers only the fast tier, all three quants", () => {
  const opts = optionsForRam(32);
  assert.equal(opts.length, 3);
  assert.ok(opts.every((o) => o.tier === "fast"));
  assert.deepEqual(opts.map((o) => o.quant).sort(), ["4bit", "6bit", "8bit"]);
});

test("optionsForRam: 63GB still excludes coding (boundary is 64)", () => {
  assert.equal(optionsForRam(63).length, 3);
});

test("optionsForRam: 64GB+ offers both tiers, all six options", () => {
  const opts = optionsForRam(64);
  assert.equal(opts.length, 6);
  assert.deepEqual(opts, LOCAL_MODEL_CATALOG);
});

test("optionFor resolves a specific tier+quant", () => {
  const opt = optionFor("fast", "8bit");
  assert.equal(opt?.alias, "qwen3.6-35b-8bit");
  assert.equal(opt?.repo, "mlx-community/Qwen3.6-35B-A3B-8bit");
  assert.equal(opt?.downloadGiB, 35.2);
});

test("optionFor returns null for an unpublished combination", () => {
  assert.equal(optionFor("fast", "3bit" as never), null);
});

test("quantForAlias parses the short alias", () => {
  assert.equal(quantForAlias("qwen3.6-35b-4bit"), "4bit");
  assert.equal(quantForAlias("qwen3.6-27b-6bit"), "6bit");
});

test("quantForAlias parses the full HF repo id", () => {
  assert.equal(quantForAlias("mlx-community/Qwen3.6-35B-A3B-8bit"), "8bit");
});

test("quantForAlias returns null for a non-quant alias", () => {
  assert.equal(quantForAlias("bge-small"), null);
  // the embeddings model's alias ends in -DWQ, not a bare quant suffix — must not misfire
  assert.equal(quantForAlias("mlx-community/Qwen3-Embedding-8B-4bit-DWQ"), null);
});

test("catalog sizes match the HF API probe (2026-07-09) — not the 2x rapid-mlx ls figure", () => {
  assert.equal(optionFor("fast", "4bit")?.downloadGiB, 19.0);
  assert.equal(optionFor("coding", "4bit")?.downloadGiB, 15.0);
});

test("validateSelection: accepts a fast-only pick within its RAM band", () => {
  const r = validateSelection({ fast: "8bit" }, 32);
  assert.deepEqual(r, { ok: true, selection: { fast: "8bit" } });
});

test("validateSelection: rejects coding below 64GB even if fast is fine", () => {
  const r = validateSelection({ fast: "4bit", coding: "4bit" }, 48);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /coding@4bit needs at least 64GB/);
});

test("validateSelection: rejects an invalid quant string", () => {
  const r = validateSelection({ fast: "12bit" }, 128);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /invalid quant for fast/);
});

test("validateSelection: rejects a non-string quant (type confusion)", () => {
  const r = validateSelection({ fast: 8 as unknown }, 128);
  assert.equal(r.ok, false);
});

test("validateSelection: null explicitly deselects a tier and always validates", () => {
  const r = validateSelection({ coding: null }, 32); // 32GB wouldn't offer coding at all, but null=deselect needs no RAM check
  assert.deepEqual(r, { ok: true, selection: { coding: null } });
});

test("validateSelection: an omitted key is absent from the result (not defaulted)", () => {
  const r = validateSelection({ fast: "4bit" }, 128);
  assert.deepEqual(r, { ok: true, selection: { fast: "4bit" } });
  if (r.ok) assert.ok(!("coding" in r.selection));
});

test("validateSelection: both tiers valid at 64GB+", () => {
  const r = validateSelection({ fast: "6bit", coding: "8bit" }, 96);
  assert.deepEqual(r, { ok: true, selection: { fast: "6bit", coding: "8bit" } });
});

test("validateSelection: ignores unknown keys in the payload", () => {
  const r = validateSelection({ fast: "4bit", nonsense: "8bit" } as never, 128);
  assert.deepEqual(r, { ok: true, selection: { fast: "4bit" } });
});
