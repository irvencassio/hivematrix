import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchBrain, formatBrainSearchResult, tokenizeQuery } from "./search";

function makeBrain(): string {
  const root = mkdtempSync(join(tmpdir(), "brain-search-"));
  mkdirSync(join(root, "projects"), { recursive: true });
  writeFileSync(join(root, "2026-06-13-cloudflare-tunnel-setup.md"), "# Cloudflare tunnel\nHow to set up a named cloudflare tunnel for remote access. The tunnel is durable.");
  writeFileSync(join(root, "projects", "knox-cost-analysis.md"), "Knox depot cost analysis. Knox knox knox pricing details and totals.");
  writeFileSync(join(root, "random-note.md"), "Grocery list and unrelated musings about the weather.");
  mkdirSync(join(root, "node_modules", "junk"), { recursive: true });
  writeFileSync(join(root, "node_modules", "junk", "tunnel.md"), "tunnel tunnel tunnel — should be skipped");
  return root;
}

test("tokenizeQuery drops stop words and short tokens, dedupes", () => {
  assert.deepEqual(tokenizeQuery("How do I find the cloudflare tunnel doc"), ["cloudflare", "tunnel"]);
});

test("searchBrain ranks a filename+content match highest", async () => {
  const root = makeBrain();
  try {
    const r = await searchBrain("cloudflare tunnel", { root });
    assert.ok(r.hits.length >= 1);
    assert.equal(r.hits[0].path, "2026-06-13-cloudflare-tunnel-setup.md");
    assert.match(r.hits[0].snippet, /cloudflare/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("searchBrain finds content-only matches and scores by term frequency", async () => {
  const root = makeBrain();
  try {
    const r = await searchBrain("knox pricing", { root });
    assert.ok(r.hits.some((h) => h.path.endsWith("knox-cost-analysis.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("searchBrain skips node_modules and unrelated files", async () => {
  const root = makeBrain();
  try {
    const r = await searchBrain("tunnel", { root });
    assert.ok(!r.hits.some((h) => h.path.includes("node_modules")), "must not surface node_modules");
    assert.ok(!r.hits.some((h) => h.path.includes("random-note")), "must not surface unrelated docs");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("searchBrain returns a clear empty result for no matches", async () => {
  const root = makeBrain();
  try {
    const r = await searchBrain("xylophone quasar", { root });
    assert.equal(r.hits.length, 0);
    assert.match(formatBrainSearchResult(r), /No brain docs matched/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("searchBrain handles a missing/disabled brain root", async () => {
  const r = await searchBrain("anything", { root: null });
  assert.equal(r.root, null);
  assert.match(formatBrainSearchResult(r), /Error/);
});

test("formatBrainSearchResult lists numbered hits with snippets", async () => {
  const root = makeBrain();
  try {
    const out = formatBrainSearchResult(await searchBrain("cloudflare tunnel", { root }));
    assert.match(out, /Found \d+ brain doc/);
    assert.match(out, /1\. .*cloudflare-tunnel/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
