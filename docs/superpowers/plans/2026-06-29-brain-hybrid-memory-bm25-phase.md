# Brain Hybrid Memory — BM25 Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Date: 2026-06-29
Design spec: `docs/superpowers/specs/2026-06-29-brain-hybrid-memory-design.md`

## Context

The flight has already produced:

| Artifact | State |
|---|---|
| `src/lib/brain/chunking.test.ts` | RED — imports `chunkDocument` from `./chunking`, which does not exist |
| `src/lib/brain/index-db.ts` | Types + DDL constant only — CRUD functions missing |
| `src/lib/brain/index-db.test.ts` | RED — imports `openBrainIndex`, `upsertDoc`, `upsertChunks`, `deleteDoc`, `upsertEmbedding`, `getChunksWithEmbeddings`, `computeReindexPlan`, `fts5Search` — none exist |
| `src/lib/brain/hybrid-search.ts` | Complete — pure functions, no I/O |
| `src/lib/brain/hybrid-search.test.ts` | Should be GREEN (pure functions) |
| `src/lib/brain/mmr.ts` | Complete — pure functions |
| `src/lib/brain/mmr.test.ts` | Should be GREEN (pure functions) |
| `src/lib/embeddings/provider.ts` | Extended with `IndexConfig`, `HybridConfig`, `MmrConfig`, `TemporalDecayConfig` in `EmbeddingsConfig` |

**This plan covers Phase 1 (BM25 only).** Embedding, cosine search, and MMR wiring are Phase 2.

---

## Task 1 — Implement `src/lib/brain/chunking.ts`

**Verify RED first:**
```bash
npx tsx --test src/lib/brain/chunking.test.ts
# Expect: cannot find module './chunking' or missing export 'chunkDocument'
```

### What to implement

File: `src/lib/brain/chunking.ts`

Export a single function:

```ts
export function chunkDocument(
  text: string,
  relPath: string,
  opts?: { chunkWords?: number; chunkOverlapWords?: number },
): BrainChunk[]
```

Import `BrainChunk` from `./index-db`.

#### Algorithm

1. If `text.trim()` is empty, return `[]`.
2. Parse the text into **sections** by splitting on lines that start with `#` (any level, 1–6).
   - Each section is `{ heading: string | null; body: string }`.
   - Text before the first heading is section 0 with `heading: null`.
   - Strip the `#` markers and surrounding whitespace from the heading string (e.g. `## Foo` → `"Foo"`).
   - Skip sections whose `body.trim()` is empty.
3. For each section, split `body` into **sliding-window chunks**:
   - `chunkWords` default: `500`; `chunkOverlapWords` default: `100`
   - Hard ceiling: `700` words. If a window exceeds 700 words, force a split.
   - Split on whitespace boundaries only — never mid-word.
   - Overlap: the start of chunk `n+1` begins `chunkOverlapWords` words before the end of chunk `n`.
   - If the body is ≤ `chunkWords` words, emit it as a single chunk.
4. For each chunk, produce a `BrainChunk`:
   ```ts
   {
     id: `${relPath}#${chunkIndex}`,   // global 0-based across the whole doc
     path: relPath,
     chunkIndex,                        // increments monotonically across all sections
     heading: section.heading,          // null for preamble section
     text: chunkText,
     tokenEstimate: wordCount,          // count of whitespace-separated tokens in chunkText
   }
   ```
5. All sub-chunks of a long section carry the same `heading` as the section.

#### Helpers (internal)

```ts
function splitIntoSections(text: string): Array<{ heading: string | null; body: string }>
function splitIntoWindows(body: string, chunkWords: number, overlapWords: number): string[]
function wordCount(text: string): number { return text.split(/\s+/).filter(Boolean).length; }
```

**Verify GREEN:**
```bash
npx tsx --test src/lib/brain/chunking.test.ts
# All 17 tests should pass
```

---

## Task 2 — Implement `openBrainIndex` in `src/lib/brain/index-db.ts`

**Pre-condition:** Task 1 GREEN.

**Verify RED first:**
```bash
npx tsx --test src/lib/brain/index-db.test.ts 2>&1 | head -30
# Expect: openBrainIndex is not a function / cannot find export
```

### What to implement

Add to `src/lib/brain/index-db.ts`:

```ts
import Database from "better-sqlite3";

export type BrainDb = InstanceType<typeof Database>;

/**
 * Open (or create) the brain SQLite index at the given path.
 * Runs the DDL (IF NOT EXISTS) and enables WAL mode.
 * Pass ":memory:" for in-process tests.
 */
export function openBrainIndex(dbPath: string): BrainDb {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Execute each statement from BRAIN_INDEX_DDL individually
  for (const stmt of BRAIN_INDEX_DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    db.exec(stmt + ";");
  }
  return db;
}
```

> Note: `better-sqlite3` is already in `package.json`. The `BRAIN_INDEX_DDL` constant is already in `index-db.ts`.

**Verify GREEN (partial):**
```bash
npx tsx --test src/lib/brain/index-db.test.ts 2>&1 | grep -E "(pass|fail|openBrainIndex)"
# The 5 openBrainIndex tests should now pass; others still fail
```

---

## Task 3 — Implement `upsertDoc` and `upsertChunks`

### What to implement

Add to `src/lib/brain/index-db.ts`:

```ts
export interface DocMeta {
  path: string;
  hash: string;
  title: string | null;
  mtimeMs: number;
  sizeBytes: number;
}

/**
 * Insert or replace a brain_docs row. Uses INSERT OR REPLACE (upsert semantics).
 */
export function upsertDoc(db: BrainDb, meta: DocMeta): void {
  db.prepare(`
    INSERT OR REPLACE INTO brain_docs (path, hash, title, mtime_ms, size_bytes, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(meta.path, meta.hash, meta.title ?? null, meta.mtimeMs, meta.sizeBytes, new Date().toISOString());
}

/**
 * Insert or replace chunk rows for a doc AND keep brain_chunks_fts in sync.
 * The FTS5 content table requires manual `INSERT INTO brain_chunks_fts(...)` after
 * each `INSERT OR REPLACE INTO brain_chunks(...)` because content= tables do not
 * auto-trigger on replace.
 *
 * `docTitle` is denormalized into the FTS index for title-boosted search.
 */
export function upsertChunks(db: BrainDb, chunks: BrainChunk[], docTitle: string | null): void {
  const insertChunk = db.prepare(`
    INSERT OR REPLACE INTO brain_chunks (id, path, chunk_index, heading, text, token_estimate)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO brain_chunks_fts (path, title, heading, text)
    VALUES (?, ?, ?, ?)
  `);
  const txn = db.transaction((rows: BrainChunk[]) => {
    for (const c of rows) {
      insertChunk.run(c.id, c.path, c.chunkIndex, c.heading ?? null, c.text, c.tokenEstimate);
      insertFts.run(c.path, docTitle ?? null, c.heading ?? null, c.text);
    }
  });
  txn(chunks);
}
```

> **FTS5 content table note:** `brain_chunks_fts` is declared with `content='brain_chunks'`. FTS5 content tables require the caller to explicitly insert into the FTS table after inserting into the content table. There is no automatic trigger. The `INSERT INTO brain_chunks_fts` uses the implicit `rowid` assigned by the preceding chunk insert.

**Verify GREEN:**
```bash
npx tsx --test src/lib/brain/index-db.test.ts 2>&1 | grep -E "(pass|fail)" | head -20
# upsertDoc and upsertChunks tests should pass
```

---

## Task 4 — Implement `deleteDoc`

### What to implement

```ts
/**
 * Delete a brain_docs row. brain_chunks rows cascade-delete via FK,
 * and brain_embeddings cascade from brain_chunks.
 *
 * Also deletes the FTS5 shadow rows by issuing a DELETE against the content table
 * (FTS5 content= tables require manual shadow-table cleanup — use the
 * `brain_chunks_fts` delete syntax).
 */
export function deleteDoc(db: BrainDb, path: string): void {
  // Remove FTS entries first (content= table requires explicit delete)
  db.prepare(`
    DELETE FROM brain_chunks_fts WHERE path = ?
  `).run(path);
  // Then delete the doc row; brain_chunks and brain_embeddings cascade
  db.prepare(`DELETE FROM brain_docs WHERE path = ?`).run(path);
}
```

> **FTS5 delete note:** For a `content=` FTS5 table, deletions must be explicitly issued on the FTS table using its own `DELETE` syntax (or `INSERT INTO brain_chunks_fts(brain_chunks_fts, ...) VALUES('delete', ...)`). The simplest approach: issue a `DELETE FROM brain_chunks_fts WHERE path = ?` before deleting the `brain_docs` row. This works because the FTS virtual table exposes a standard `WHERE` delete path.

**Verify GREEN:**
```bash
npx tsx --test src/lib/brain/index-db.test.ts 2>&1 | grep -E "deleteDoc"
# 3 deleteDoc tests should pass
```

---

## Task 5 — Implement `upsertEmbedding` and `getChunksWithEmbeddings`

### What to implement

```ts
/**
 * Insert or replace a single embedding row (chunk_id, model) pair.
 */
export function upsertEmbedding(db: BrainDb, emb: StoredEmbedding): void {
  db.prepare(`
    INSERT OR REPLACE INTO brain_embeddings (chunk_id, model, dims, vector_json, embedded_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    emb.chunkId,
    emb.model,
    emb.dims,
    JSON.stringify(emb.vector),
    emb.embeddedAt,
  );
}

/**
 * Return all chunks that have an embedding for the given model, joining
 * brain_chunks and brain_embeddings. Validates dims vs. parsed vector length;
 * skips corrupt rows silently.
 */
export function getChunksWithEmbeddings(db: BrainDb, model: string): ChunkWithEmbedding[] {
  const rows = db.prepare(`
    SELECT
      c.id, c.path, c.chunk_index as chunkIndex, c.heading, c.text,
      e.dims, e.vector_json
    FROM brain_embeddings e
    JOIN brain_chunks c ON c.id = e.chunk_id
    WHERE e.model = ?
  `).all(model) as Array<{
    id: string; path: string; chunkIndex: number; heading: string | null;
    text: string; dims: number; vector_json: string;
  }>;

  const result: ChunkWithEmbedding[] = [];
  for (const row of rows) {
    let vector: number[];
    try {
      vector = JSON.parse(row.vector_json) as number[];
    } catch {
      continue; // corrupt row — skip
    }
    if (vector.length !== row.dims) continue; // dims mismatch — skip
    result.push({
      id: row.id,
      path: row.path,
      chunkIndex: row.chunkIndex,
      heading: row.heading,
      text: row.text,
      vector,
    });
  }
  return result;
}
```

**Verify GREEN:**
```bash
npx tsx --test src/lib/brain/index-db.test.ts 2>&1 | grep -E "(upsertEmbedding|getChunks)"
```

---

## Task 6 — Implement `computeReindexPlan`

### What to implement

```ts
/**
 * Diff disk state (pathsToHashes) against the DB to compute what needs to happen
 * on the next reindex pass.
 *
 * @param db            - Open brain DB.
 * @param diskHashes    - Map of relPath → current content hash from disk scan.
 * @param currentModel  - The embedding model that will be used this pass.
 */
export function computeReindexPlan(
  db: BrainDb,
  diskHashes: ReadonlyMap<string, string>,
  currentModel: string,
): ChunkIndexPlan {
  // 1. Load all current db doc paths + hashes
  const dbDocs = db.prepare("SELECT path, hash FROM brain_docs").all() as Array<{
    path: string; hash: string;
  }>;
  const dbHashMap = new Map(dbDocs.map((r) => [r.path, r.hash]));

  const pathsToReindex: string[] = [];
  const pathsToPrune: string[] = [];

  // Docs on disk: new or changed hash → reindex
  for (const [path, diskHash] of diskHashes) {
    const dbHash = dbHashMap.get(path);
    if (dbHash === undefined || dbHash !== diskHash) {
      pathsToReindex.push(path);
    }
  }

  // Docs in DB but absent on disk → prune
  for (const [path] of dbHashMap) {
    if (!diskHashes.has(path)) {
      pathsToPrune.push(path);
    }
  }

  // 2. Detect model change: any stored embedding using a different model name?
  const storedModels = db.prepare(
    "SELECT DISTINCT model FROM brain_embeddings LIMIT 1"
  ).all() as Array<{ model: string }>;
  const modelChanged =
    storedModels.length > 0 && !storedModels.every((r) => r.model === currentModel);

  // 3. Chunks needing embeddings: all chunks NOT already embedded with currentModel
  //    (only for docs NOT in pathsToReindex — those will be re-chunked anyway).
  const chunksToEmbed: string[] = [];
  if (!modelChanged) {
    const rows = db.prepare(`
      SELECT c.id
      FROM brain_chunks c
      LEFT JOIN brain_embeddings e ON e.chunk_id = c.id AND e.model = ?
      WHERE e.chunk_id IS NULL
        AND c.path NOT IN (${pathsToReindex.map(() => "?").join(",") || "''"})
    `).all(currentModel, ...pathsToReindex) as Array<{ id: string }>;
    for (const r of rows) chunksToEmbed.push(r.id);
  }

  return { pathsToReindex, pathsToPrune, modelChanged, chunksToEmbed };
}
```

> **Edge case:** If `pathsToReindex` is empty, the `NOT IN (...)` clause needs a placeholder that always evaluates false. Use the literal `'__never__'` or restructure as `c.path NOT IN (SELECT path FROM ...)` via a temp approach. Simplest fix: check `pathsToReindex.length === 0` and skip the query when there are no exclusions.

**Verify GREEN:**
```bash
npx tsx --test src/lib/brain/index-db.test.ts 2>&1 | grep -E "computeReindexPlan"
# 7 computeReindexPlan tests should pass
```

---

## Task 7 — Implement `fts5Search`

### What to implement

```ts
/** Shape returned directly from fts5Search — mirrors RawBm25Hit in hybrid-search.ts. */
export interface RawBm25Hit {
  id: string;
  path: string;
  heading: string | null;
  text: string;
  bm25Score: number; // raw FTS5 bm25() output — negative; more negative = more relevant
}

/**
 * Run an FTS5 BM25 query against brain_chunks_fts.
 * Returns up to `limit` hits sorted by BM25 relevance (ascending bm25Score,
 * since FTS5 bm25() is negative — ORDER BY bm25Score ASC = most relevant first).
 */
export function fts5Search(db: BrainDb, query: string, limit: number): RawBm25Hit[] {
  try {
    return db.prepare(`
      SELECT
        c.id,
        c.path,
        c.heading,
        c.text,
        bm25(brain_chunks_fts) AS bm25Score
      FROM brain_chunks_fts f
      JOIN brain_chunks c ON c.rowid = f.rowid
      WHERE brain_chunks_fts MATCH ?
      ORDER BY bm25Score
      LIMIT ?
    `).all(query, limit) as RawBm25Hit[];
  } catch {
    // FTS5 syntax error (e.g. query has FTS5-invalid chars like bare "*")
    return [];
  }
}
```

> **FTS5 ORDER BY:** FTS5 `bm25()` returns negative scores. `ORDER BY bm25Score` (ascending) means most-negative first, which is most-relevant first. The tests expect `bm25Score < 0`.

**Verify GREEN:**
```bash
npx tsx --test src/lib/brain/index-db.test.ts
# All tests in index-db.test.ts should pass
```

**Full suite check at this milestone:**
```bash
npm test
npm run typecheck
```

---

## Task 8 — Implement `reindexBrain()` in `src/lib/embeddings/indexer.ts`

This function ties chunking + CRUD together for the BM25 path. It does NOT call the embedding provider — that is Phase 2.

### What to implement

Add to `src/lib/embeddings/indexer.ts`:

```ts
import { createHash } from "crypto";
import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, relative } from "path";
import { homedir } from "os";
import {
  openBrainIndex, upsertDoc, upsertChunks, deleteDoc, computeReindexPlan,
  type BrainDb,
} from "@/lib/brain/index-db";
import { chunkDocument } from "@/lib/brain/chunking";
import { getEmbeddingsConfig } from "@/lib/embeddings/provider";

const INDEXABLE_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".html", ".htm", ".mdx"]);
const SKIP_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash"]);

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/** Walk brainRoot, return Map<relPath, hash>. Skips hidden dirs, SKIP_DIRS, and symlinks. */
function scanBrainRoot(brainRoot: string): Map<string, string> {
  const hashes = new Map<string, string>();

  function walk(dir: string) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
        continue;
      }
      const ext = name.slice(name.lastIndexOf("."));
      if (!INDEXABLE_EXTENSIONS.has(ext)) continue;
      try {
        const content = readFileSync(full, "utf8");
        hashes.set(relative(brainRoot, full), sha256(content));
      } catch { /* unreadable — skip */ }
    }
  }

  walk(brainRoot);
  return hashes;
}

export interface ReindexResult {
  added: number;
  updated: number;
  pruned: number;
  chunksIndexed: number;
  dbPath: string;
  indexedAt: string;
  error?: string;
}

/**
 * Incremental BM25 index rebuild. Reads chunking + index config from
 * getEmbeddingsConfig(). Does NOT embed — that is Phase 2.
 */
export async function reindexBrain(): Promise<ReindexResult> {
  const cfg = getEmbeddingsConfig();
  const indexCfg = cfg.index ?? {
    driver: "sqlite" as const,
    path: "~/.hivematrix/brain-index.sqlite",
    chunkWords: 500,
    chunkOverlapWords: 100,
  };
  const brainRoot = expandHome(
    (cfg as { brainRootDir?: string }).brainRootDir ?? "~/_GD/brain"
  );
  const dbPath = expandHome(indexCfg.path);

  if (!existsSync(brainRoot)) {
    return { added: 0, updated: 0, pruned: 0, chunksIndexed: 0, dbPath, indexedAt: new Date().toISOString(), error: "brainRoot not found" };
  }

  const db = openBrainIndex(dbPath);
  const diskHashes = scanBrainRoot(brainRoot);
  const plan = computeReindexPlan(db, diskHashes, cfg.model);

  let added = 0, updated = 0, pruned = 0, chunksIndexed = 0;

  // Prune deleted docs
  for (const p of plan.pathsToPrune) {
    deleteDoc(db, p);
    pruned++;
  }

  // Re-index new/changed docs
  for (const relPath of plan.pathsToReindex) {
    const full = join(brainRoot, relPath);
    let content: string;
    try { content = readFileSync(full, "utf8"); } catch { continue; }

    const stat = statSync(full);
    const hash = sha256(content);

    // Extract title from first # heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : null;

    const isNew = !diskHashes.has(relPath) || plan.pathsToReindex.includes(relPath);

    // Delete old chunks before re-inserting (the doc row will be replaced)
    deleteDoc(db, relPath);

    upsertDoc(db, { path: relPath, hash, title, mtimeMs: stat.mtimeMs, sizeBytes: stat.size });
    const chunks = chunkDocument(content, relPath, {
      chunkWords: indexCfg.chunkWords,
      chunkOverlapWords: indexCfg.chunkOverlapWords,
    });
    upsertChunks(db, chunks, title);
    chunksIndexed += chunks.length;

    // Distinguish add vs update: "new" if it wasn't in the DB before this pass
    if (isNew) added++; else updated++;
  }

  db.close();
  return { added, updated, pruned, chunksIndexed, dbPath, indexedAt: new Date().toISOString() };
}
```

**Note:** `getEmbeddingsConfig()` is in `provider.ts`. The `brainRootDir` key is stored in the top-level config, not in the `embeddings` sub-object — read it from the raw config if needed. Cast appropriately.

---

## Task 9 — Wire `brain_search` fallback to BM25 index

Update `src/lib/brain/search.ts` to try the SQLite BM25 index first and fall back to the existing scanner when the index is unavailable.

### What to implement

At the top of the existing `brainSearch` function (or its equivalent export), add:

```ts
import { openBrainIndex, fts5Search } from "@/lib/brain/index-db";
import { rankHybrid } from "@/lib/brain/hybrid-search";
import type { RawBm25Hit } from "@/lib/brain/index-db";
import { getEmbeddingsConfig, indexDbPath } from "@/lib/embeddings/provider";
import { existsSync } from "fs";

// In the search entry-point, before falling to legacy scanner:
function tryBm25Search(query: string, maxResults: number): SearchResult[] | null {
  try {
    const cfg = getEmbeddingsConfig();
    if (!cfg.index) return null;
    const dbPath = indexDbPath(cfg.index.path);
    if (!existsSync(dbPath)) return null;

    const db = openBrainIndex(dbPath);
    const bm25Hits = fts5Search(db, query, maxResults * 4);
    db.close();

    if (bm25Hits.length === 0) return null;

    const hits = rankHybrid(bm25Hits, [], { maxResults, textWeight: 1, vectorWeight: 0 });
    return hits.map((h) => ({
      path: h.path,
      score: h.score,
      snippet: h.snippet,
      heading: h.heading ?? undefined,
    }));
  } catch {
    return null;
  }
}
```

Add a helper `indexDbPath` to `provider.ts`:

```ts
export function indexDbPath(configPath: string): string {
  return configPath.startsWith("~") ? join(homedir(), configPath.slice(1)) : configPath;
}
```

The existing keyword-scan path is the fallback: if `tryBm25Search` returns `null`, proceed with the old code path unchanged.

---

## Task 10 — Update Daemon Routes

File: `src/daemon/server.ts`

### `GET /brain/search`

The existing route already exists. No signature change needed. Internally, the handler should call `tryBm25Search` (or the equivalent service function) and fall back to the legacy path when BM25 is unavailable.

### `GET /embeddings` — Add brain index stats

Find the existing `/embeddings` handler. Add brain index stats to its response:

```ts
// Inside the /embeddings GET handler, after existing fields:
let brainIndex = null;
try {
  const cfg = getEmbeddingsConfig();
  if (cfg.index) {
    const dbPath = indexDbPath(cfg.index.path);
    if (existsSync(dbPath)) {
      const db = openBrainIndex(dbPath);
      const docsCount = (db.prepare("SELECT COUNT(*) as n FROM brain_docs").get() as { n: number }).n;
      const chunksCount = (db.prepare("SELECT COUNT(*) as n FROM brain_chunks").get() as { n: number }).n;
      const embeddedCount = (db.prepare("SELECT COUNT(DISTINCT chunk_id) as n FROM brain_embeddings").get() as { n: number }).n;
      db.close();
      brainIndex = {
        dbPath,
        docsIndexed: docsCount,
        chunksIndexed: chunksCount,
        embeddedChunks: embeddedCount,
        model: cfg.model,
      };
    }
  }
} catch { /* stats unavailable — skip */ }

// Include brainIndex in the JSON response
```

### `POST /embeddings/reindex`

Find the existing `/embeddings/reindex` handler. Replace its body with a call to `reindexBrain()`:

```ts
import { reindexBrain } from "@/lib/embeddings/indexer";

// POST /embeddings/reindex handler:
try {
  const result = await reindexBrain();
  res.json({ ok: true, ...result });
} catch (err) {
  res.status(500).json({ ok: false, error: String(err) });
}
```

---

## Task 11 — Verification Gates

Run in order. Fix failures before proceeding to the next gate.

```bash
# 1. All unit tests pass
npm test

# 2. TypeScript is clean
npm run typecheck

# 3. Scope wall: no violations
node scripts/scope-wall.mjs
```

All three must be zero-error before declaring Phase 1 complete.

---

## Phase 2 Preview (Not Part of This Plan)

The following items are deferred to the embeddings/hybrid/MMR phase:

- `reindexBrain()` embedding pass: call `provider.ts` to embed `plan.chunksToEmbed`
- `src/lib/embeddings/indexer.ts` `indexBrainEmbeddings()` function
- Cosine ranking via `getChunksWithEmbeddings` + `cosineSimilarity`
- MMR reranking wired into the search path
- The `POST /embeddings/reindex` embedding progress reporting
- `GET /embeddings` embedding model readiness
- Phase 2 depends on `npx tsx scripts/qwen-readiness.mts` returning all 6 checks green

---

## Acceptance Criteria for Phase 1

- [ ] `brain_search` still returns results with embeddings disabled (legacy keyword path intact)
- [ ] With the SQLite index built, `brain_search` returns BM25 results citing chunk heading + path
- [ ] Exact project names / identifiers rank well (FTS5 BM25 handles this)
- [ ] Re-running reindex on unchanged docs is a no-op (hash diff prevents re-chunking)
- [ ] Deleted brain docs are pruned from the index
- [ ] All `npm test` tests pass
- [ ] `npm run typecheck` zero errors
- [ ] `node scripts/scope-wall.mjs` zero violations
- [ ] No brain content leaves the machine (no network calls in BM25 path)
