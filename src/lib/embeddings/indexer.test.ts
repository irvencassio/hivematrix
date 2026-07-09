import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Temp HOME → config points the brain root at a temp dir + enables embeddings.
const TMP = mkdtempSync(join(tmpdir(), "hm-embed-"));
const HOME = join(TMP, "home");
const BRAIN = join(TMP, "brain");
mkdirSync(join(HOME, ".hivematrix"), { recursive: true });
mkdirSync(BRAIN, { recursive: true });
writeFileSync(join(HOME, ".hivematrix", "config.json"), JSON.stringify({
  memory: { brainRootDir: BRAIN },
  embeddings: { enabled: true, endpoint: "http://127.0.0.1:9/v1", model: "fake-embed" },
}));
const origHome = process.env.HOME;
process.env.HOME = HOME;

const { reindexBrain } = await import("./indexer");
const { loadIndex } = await import("./index-store");
const { semanticSearch, hybridBrainSearch } = await import("./search");

// Deterministic fake embedder: bag-of-words over a fixed vocab → comparable vectors.
const VOCAB = ["cloudflare", "tunnel", "knox", "cost", "email", "weather"];
const embedBatch = async (texts: string[]) =>
  texts.map((t) => VOCAB.map((w) => (t.toLowerCase().match(new RegExp(w, "g")) ?? []).length));
const embedQuery = async (q: string) => (await embedBatch([q]))[0];

test.after(() => {
  process.env.HOME = origHome;
  rmSync(TMP, { recursive: true, force: true });
});

test("reindexBrain embeds the corpus; second run is incremental (skips unchanged)", async () => {
  writeFileSync(join(BRAIN, "cloudflare-tunnel.md"), "Setting up a named cloudflare tunnel for remote access. The tunnel is durable.");
  writeFileSync(join(BRAIN, "knox-cost.md"), "Knox depot cost analysis: knox pricing and cost totals.");

  const first = await reindexBrain({ embedder: embedBatch });
  assert.equal(first.indexed, 2);
  assert.equal(first.reset, false);
  assert.equal(Object.keys(loadIndex().entries).length, 2);

  const second = await reindexBrain({ embedder: embedBatch });
  assert.equal(second.indexed, 0, "nothing changed → nothing re-embedded");
});

test("changing a doc re-embeds only it; deleting prunes it", async () => {
  writeFileSync(join(BRAIN, "cloudflare-tunnel.md"), "Updated: cloudflare tunnel tunnel tunnel notes.");
  const changed = await reindexBrain({ embedder: embedBatch });
  assert.equal(changed.indexed, 1, "only the edited doc re-embeds");

  rmSync(join(BRAIN, "knox-cost.md"));
  const pruned = await reindexBrain({ embedder: embedBatch });
  assert.equal(pruned.pruned, 1, "deleted doc pruned from the index");
  assert.ok(!Object.keys(loadIndex().entries).some((p) => p.includes("knox")));
});

test("a doc excluded via the Brain / Memory Review sidecar is dropped from the index (and pruned if already indexed)", async () => {
  writeFileSync(join(BRAIN, "cloudflare-tunnel.md"), "cloudflare tunnel notes, still present on disk.");
  await reindexBrain({ embedder: embedBatch });
  assert.ok("cloudflare-tunnel.md" in loadIndex().entries, "present before exclusion");

  const { setExcluded, loadExclusions } = await import("@/lib/brain/exclusions");
  setExcluded(["cloudflare-tunnel.md"], true);

  const afterExclude = await reindexBrain({ embedder: embedBatch });
  assert.equal(afterExclude.pruned, 1, "excluded doc pruned from the index on the next reindex");
  assert.ok(!("cloudflare-tunnel.md" in loadIndex().entries));

  setExcluded(["cloudflare-tunnel.md"], false);
  assert.equal(loadExclusions().size, 0);
  const afterRestore = await reindexBrain({ embedder: embedBatch });
  assert.equal(afterRestore.indexed, 1, "un-excluding re-embeds it on the next reindex");
  assert.ok("cloudflare-tunnel.md" in loadIndex().entries);
});

test("semanticSearch ranks the semantically closest doc first", async () => {
  // re-seed both docs
  writeFileSync(join(BRAIN, "cloudflare-tunnel.md"), "named cloudflare tunnel remote access durable tunnel");
  writeFileSync(join(BRAIN, "knox-cost.md"), "knox depot cost analysis pricing");
  await reindexBrain({ embedder: embedBatch });

  const hits = await semanticSearch("cloudflare tunnel", { embedder: embedQuery });
  assert.ok(hits.length >= 1);
  assert.match(hits[0].path, /cloudflare-tunnel/);
});

test("hybridBrainSearch returns a BrainSearchResult lifted by semantics", async () => {
  const result = await hybridBrainSearch("cloudflare tunnel", { embedder: embedQuery, maxResults: 3 });
  assert.ok(result.hits.length >= 1);
  assert.match(result.hits[0].path, /cloudflare-tunnel/);
  assert.ok(result.hits[0].snippet.length > 0, "hits carry a snippet");
});

test("model change resets the whole index", async () => {
  const r = await reindexBrain({ embedder: embedBatch, model: "different-model" });
  assert.equal(r.reset, true);
  assert.equal(loadIndex().model, "different-model");
});
