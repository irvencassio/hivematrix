# Brain Hybrid Memory Search Design

Date: 2026-06-29
Status: Proposed
Owner: Irv

## Summary

Upgrade HiveMatrix Brain retrieval from the current keyword scan plus document-level embedding sidecar into a local-first hybrid memory engine closer to OpenClaw's memory search: SQLite FTS5/BM25 for exact recall, local embeddings for semantic recall, chunk-level indexing, hybrid ranking, and optional MMR diversification.

The source of truth remains `~/_GD/brain`. HiveMatrix must not create a shadow brain. The index is rebuildable derived state under `~/.hivematrix`.

## Goals

- Keep all brain content and embeddings local by default.
- Use the same local embedding endpoint/model that OpenClaw and Brainpower can share.
- Improve `brain_search` quality for:
  - exact identifiers, filenames, acronyms, and project names
  - conceptual/synonym queries
  - long documents where only one section matters
  - recurring skill/playbook retrieval
- Preserve keyword-only fallback when embeddings are disabled or unavailable.
- Keep implementation simple enough for a single-Mac, local-first product.

## Non-Goals

- Do not add a cloud embedding provider as default behavior.
- Do not move brain documents out of `~/_GD/brain`.
- Do not introduce Chroma, Qdrant, LanceDB, or Atlas in this phase.
- Do not index arbitrary binary files.
- Do not turn this into a general user-facing database migration project.

## Current State

Relevant files:

- `src/lib/brain/search.ts`
  - bounded text-file scan over the brain root
  - term-frequency scoring plus filename weighting
  - no true BM25
  - no persistent keyword index

- `src/lib/embeddings/provider.ts`
  - local-first OpenAI-compatible `/v1/embeddings` client
  - defaults to `http://localhost:11434/v1` and `qwen3-embedding:8b-q8_0`
  - self-gates and returns `null` on failure

- `src/lib/embeddings/indexer.ts`
  - walks the brain root
  - embeds new/changed text docs
  - stores document-level vectors in `~/.hivematrix/embeddings-index.json`
  - embeds only the first 8,000 characters of each doc

- `src/lib/embeddings/search.ts`
  - ranks document vectors by cosine similarity
  - blends keyword hits and semantic hits
  - falls back to keyword search when embeddings are unavailable

- `package.json`
  - already depends on `better-sqlite3`
  - FTS5/BM25 is available in the current runtime

## Proposed Architecture

### Source Root

Use existing memory settings:

- Canonical brain root: `~/_GD/brain`
- Configured through `memory.brainRootDir`
- Read behavior must remain cloud-stall safe because the root is Google Drive-backed.

### Derived Index

Create a SQLite index under:

```text
~/.hivematrix/brain-index.sqlite
```

This file is disposable and rebuildable from `~/_GD/brain`.

### Tables

```sql
CREATE TABLE brain_docs (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  title TEXT,
  mtime_ms INTEGER,
  size_bytes INTEGER,
  indexed_at TEXT NOT NULL
);

CREATE TABLE brain_chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  token_estimate INTEGER,
  FOREIGN KEY(path) REFERENCES brain_docs(path) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE brain_chunks_fts USING fts5(
  path,
  title,
  heading,
  text,
  content='brain_chunks',
  content_rowid='rowid'
);

CREATE TABLE brain_embeddings (
  chunk_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  embedded_at TEXT NOT NULL,
  PRIMARY KEY(chunk_id, model),
  FOREIGN KEY(chunk_id) REFERENCES brain_chunks(id) ON DELETE CASCADE
);
```

Notes:

- Store vectors as JSON initially for portability and easy inspection.
- Do not add `sqlite-vec` in this phase unless brute-force cosine becomes too slow.
- Revisit binary vector blobs or `sqlite-vec` after measuring corpus size and latency.

### Chunking

Replace document-level embeddings with chunk-level embeddings.

Rules:

- Include `.md`, `.markdown`, `.txt`, `.html`, `.htm`, `.mdx`.
- Skip `.git`, `node_modules`, `.obsidian`, `.trash`, hidden dirs, and symlinks.
- Split markdown by headings first.
- Split oversized sections into overlapping chunks.
- Target size: 350-700 words or roughly 512 tokens.
- Overlap: 75-125 words.
- Preserve metadata:
  - relative path
  - title
  - nearest heading
  - chunk index

### Keyword Search

Use FTS5 BM25:

```sql
SELECT
  c.id,
  c.path,
  c.heading,
  c.text,
  bm25(brain_chunks_fts) AS bm25_score
FROM brain_chunks_fts f
JOIN brain_chunks c ON c.rowid = f.rowid
WHERE brain_chunks_fts MATCH ?
ORDER BY bm25_score
LIMIT ?;
```

Normalize BM25 into a positive relevance score before hybrid merge.

### Semantic Search

Use the existing local embedding provider shape:

- Endpoint: OpenAI-compatible `/v1/embeddings`
- Preferred model: `qwen3-embedding`
- Fallback model candidates: `bge-m3`, `nomic-embed-text`
- No cloud default

Embed:

- document chunks at index time
- user query at search time

Rank via cosine similarity. Brute-force all chunk vectors initially.

### Hybrid Merge

Merge keyword and semantic candidates by chunk id.

Suggested defaults:

```ts
textWeight = 0.45;
vectorWeight = 0.55;
candidateMultiplier = 4;
```

Algorithm:

1. Retrieve top `maxResults * candidateMultiplier` BM25 chunks.
2. Retrieve top `maxResults * candidateMultiplier` semantic chunks.
3. Normalize both rankings to `[0, 1]`.
4. Union by chunk id.
5. Score:

```ts
score = textWeight * textScore + vectorWeight * vectorScore;
```

6. Apply optional boosts:
   - path/title exact match
   - recent dated docs, only when temporal decay is enabled
   - skills/playbooks when the query appears procedural

### MMR Diversification

Add optional MMR reranking to avoid repetitive chunks.

Default:

```ts
mmr.enabled = true;
mmr.lambda = 0.7;
```

Use MMR only when at least two candidates have vectors. Otherwise return sorted hybrid results.

### Temporal Decay

Keep optional and off by default.

If enabled, apply only to dated operational docs:

- `memory/`
- `workflows/`
- `projects/**/plans/`
- date-prefixed files

Do not decay timeless reference docs in `domains/`, `references/`, `skills/`, or `sources/references/`.

## API / Tool Behavior

Existing callers should keep working.

### `brain_search`

No interface break.

Inputs:

- `query`
- `maxResults`

Output should still be formatted as:

- ranked path
- score
- snippet

Enhance formatted output to include heading when available:

```text
1. projects/hive/agent-brief.md > Known Issues (score 0.83)
   snippet...
```

### Daemon Routes

Preserve existing routes. Add or extend:

- `GET /brain/search?q=...`
  - uses hybrid index if available
  - falls back to current keyword scanner if index unavailable

- `GET /embeddings`
  - include brain index stats:
    - docs indexed
    - chunks indexed
    - embedded chunks
    - model
    - index path
    - last index time
    - last error

- `POST /embeddings/reindex`
  - rebuild or incrementally update SQLite index
  - preserve current behavior where possible

## Configuration

Extend existing `embeddings` config without breaking current fields:

```json
{
  "embeddings": {
    "enabled": true,
    "endpoint": "http://localhost:8002/v1",
    "model": "qwen3-embedding",
    "provider": "local",
    "pollIntervalMinutes": 60,
    "index": {
      "driver": "sqlite",
      "path": "~/.hivematrix/brain-index.sqlite",
      "chunkWords": 500,
      "chunkOverlapWords": 100
    },
    "hybrid": {
      "enabled": true,
      "textWeight": 0.45,
      "vectorWeight": 0.55,
      "candidateMultiplier": 4
    },
    "mmr": {
      "enabled": true,
      "lambda": 0.7
    },
    "temporalDecay": {
      "enabled": false,
      "halfLifeDays": 30
    }
  }
}
```

If config is absent or embeddings fail, `brain_search` must still work using keyword fallback.

## Implementation Approach

Use TDD. Do not write production code before failing tests.

Suggested module layout:

- `src/lib/brain/chunking.ts`
- `src/lib/brain/index-db.ts`
- `src/lib/brain/hybrid-search.ts`
- `src/lib/brain/mmr.ts`
- update `src/lib/embeddings/indexer.ts`
- update `src/lib/embeddings/search.ts`
- update `src/lib/brain/search.ts` only as a compatibility/fallback layer
- update daemon routes in `src/daemon/server.ts`

## Test Plan

Unit tests:

- chunking preserves path/title/heading/chunk indexes
- chunking splits long sections with overlap
- SQLite FTS5 BM25 ranks exact keyword matches
- indexer embeds only new/changed chunks
- model change invalidates embeddings
- deleted files prune docs/chunks/embeddings
- hybrid merge combines keyword-only, semantic-only, and both-source hits
- MMR diversifies same-document duplicate chunks
- fallback returns current keyword results when embeddings/index are unavailable

Integration tests:

- temporary brain root with 5-10 docs
- build index
- search exact identifier
- search synonym/concept query
- confirm result includes expected path and heading
- confirm no network/cloud provider is required

Verification gates:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

If local embedding runtime is part of the change:

```bash
npx tsx scripts/qwen-readiness.mts
```

## Acceptance Criteria

- `brain_search` still works with embeddings disabled.
- With embeddings enabled and a local endpoint available, `brain_search` returns hybrid results.
- Exact project names/identifiers rank well through BM25.
- Conceptual queries find relevant docs even without exact keyword overlap.
- Results cite chunk heading/path, not only document path.
- Index rebuild is incremental after the first run.
- No brain document content leaves the machine by default.
- No new heavyweight vector database dependency is introduced.
- All tests and scope wall pass.

## Chunk-Level Embeddings: Data Structures and Storage Schema

### Chunk ID Format

Every chunk needs a stable, unique primary key for `brain_chunks.id`. Use:

```
{relPath}#{chunkIndex}
```

Example: `projects/hive/agent-brief.md#3`

Rationale:
- Brain-relative paths use `/` and `.` — no `#` conflict in practice.
- Human-readable in SQLite inspector and debug logs.
- Stable as long as the doc content hash matches; if the hash changes, all
  chunks for that doc are deleted and re-inserted (see Staleness Detection).

```ts
export function chunkId(relPath: string, chunkIndex: number): string {
  return `${relPath}#${chunkIndex}`;
}
```

### TypeScript Interfaces

#### Core chunk type

```ts
// src/lib/brain/index-db.ts
export interface BrainChunk {
  id: string;             // "{relPath}#{chunkIndex}"
  path: string;           // brain-relative path, e.g. "projects/hive/agent-brief.md"
  chunkIndex: number;     // 0-based within the document
  heading: string | null; // nearest heading above this chunk, or null for preamble
  text: string;           // raw chunk text (untrimmed overlap included)
  tokenEstimate: number;  // word count ≈ token count; used to enforce size bounds
}
```

#### Stored embedding row (mirrors brain_embeddings table)

```ts
export interface StoredEmbedding {
  chunkId: string;      // FK to brain_chunks.id
  model: string;        // model name, e.g. "qwen3-embedding:8b-q8_0"
  dims: number;         // vector dimensionality (redundant but fast to validate)
  vector: number[];     // deserialized from vector_json in storage
  embeddedAt: string;   // ISO 8601, e.g. "2026-06-29T12:00:00.000Z"
}
```

#### In-memory search types (used by hybrid-search.ts and mmr.ts)

```ts
// A chunk joined with its embedding — the unit fed into cosine ranking.
export interface ChunkWithEmbedding {
  id: string;
  path: string;
  chunkIndex: number;
  heading: string | null;
  text: string;
  vector: number[];
}

// Intermediate type during hybrid merge (before final ranking).
export interface ChunkCandidate {
  id: string;
  path: string;
  heading: string | null;
  text: string;
  bm25Score: number;      // normalized to [0, 1]; 0 if absent from BM25 results
  cosineScore: number;    // normalized to [0, 1]; 0 if no embedding available
  hybridScore: number;    // textWeight * bm25Score + vectorWeight * cosineScore
}

// Final hit shape returned from hybrid/MMR pipeline.
export interface ChunkHit {
  id: string;
  path: string;
  heading: string | null;
  snippet: string;        // first 300 chars of chunk text, normalized whitespace
  score: number;          // hybridScore, rounded to 3 decimal places
  sources: Array<"keyword" | "semantic">;
}
```

### Vector Serialization

Store vectors as a JSON-stringified number array:

```ts
// Write
const vectorJson = JSON.stringify(vector);        // "[0.123, -0.456, ...]"

// Read
const vector: number[] = JSON.parse(row.vector_json) as number[];
```

`dims` is written as `vector.length` at insertion time and validated on read:

```ts
if (row.dims !== vector.length) {
  // row is corrupt or truncated — skip and flag for re-embedding
}
```

Do not use binary blobs in this phase. Add `sqlite-vec` or a blob column only
after measuring corpus size and latency against a real brain root (revisit after
Phase 2 is stable).

### Extended EmbeddingsConfig

The existing `EmbeddingsConfig` in `src/lib/embeddings/provider.ts` gains four
optional sub-objects. Existing fields are unchanged.

```ts
export interface IndexConfig {
  driver: "sqlite";
  path: string;          // default: "~/.hivematrix/brain-index.sqlite"
  chunkWords: number;    // target chunk size in words, default 500
  chunkOverlapWords: number; // overlap between adjacent chunks, default 100
}

export interface HybridConfig {
  enabled: boolean;
  textWeight: number;         // BM25 weight, default 0.45
  vectorWeight: number;       // cosine weight, default 0.55
  candidateMultiplier: number; // oversample factor, default 4
}

export interface MmrConfig {
  enabled: boolean;
  lambda: number; // relevance vs. diversity balance, default 0.7; 1.0 = pure relevance
}

export interface TemporalDecayConfig {
  enabled: boolean;
  halfLifeDays: number; // default 30; applies only to dated operational docs
}

// Extended shape (additive — existing EmbeddingsConfig fields are untouched)
export interface EmbeddingsConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  provider: string;
  pollIntervalMinutes: number;
  index?: IndexConfig;
  hybrid?: HybridConfig;
  mmr?: MmrConfig;
  temporalDecay?: TemporalDecayConfig;
}
```

`getEmbeddingsConfig()` reads these sub-objects from `config.json` with safe
defaults so a config that only sets `{enabled:true}` still works (BM25 path,
no hybrid/MMR until embeddings are available).

### Staleness Detection for Chunk-Level Embeddings

Chunks are derived deterministically from document content, so per-chunk
hashing is unnecessary. The doc-level content hash in `brain_docs.hash` is the
sole staleness signal:

| Condition | Action |
|---|---|
| `brain_docs.hash` unchanged | Skip this doc entirely — chunks and embeddings are current |
| `brain_docs.hash` changed | Delete all chunks and embeddings for this path; re-chunk and re-embed |
| Doc deleted from disk | `ON DELETE CASCADE` removes its `brain_chunks` rows, which cascade to `brain_embeddings` |
| Model name changed | `DELETE FROM brain_embeddings WHERE model != ?` before the indexing pass; all chunks need re-embedding but are not re-chunked |

This means the index always converges to the current brain state in a single
`reindexBrain()` pass without a two-pass diff.

### Reindex Plan Type

```ts
// src/lib/brain/index-db.ts
export interface ChunkIndexPlan {
  pathsToReindex: string[];  // docs whose hash changed → delete+rechunk+re-embed
  pathsToPrune: string[];    // docs deleted from disk → delete from brain_docs
  modelChanged: boolean;     // true → wipe brain_embeddings before re-embedding
  chunksToEmbed: string[];   // chunk ids needing an embedding this pass
}
```

### SQLite Schema (complete reference)

The three tables that store chunk-level embeddings (repeated here for
implementer convenience — the full schema is under Proposed Architecture):

```sql
-- Documents: one row per indexed brain file
CREATE TABLE brain_docs (
  path        TEXT PRIMARY KEY,
  hash        TEXT NOT NULL,
  title       TEXT,
  mtime_ms    INTEGER,
  size_bytes  INTEGER,
  indexed_at  TEXT NOT NULL
);

-- Chunks: text segments derived from brain_docs; cascade-deleted with their doc
CREATE TABLE brain_chunks (
  id             TEXT PRIMARY KEY,    -- "{relPath}#{chunkIndex}"
  path           TEXT NOT NULL,
  chunk_index    INTEGER NOT NULL,
  heading        TEXT,
  text           TEXT NOT NULL,
  token_estimate INTEGER,
  FOREIGN KEY(path) REFERENCES brain_docs(path) ON DELETE CASCADE
);

-- Embeddings: one row per (chunk, model) pair
CREATE TABLE brain_embeddings (
  chunk_id     TEXT NOT NULL,
  model        TEXT NOT NULL,
  dims         INTEGER NOT NULL,
  vector_json  TEXT NOT NULL,         -- JSON array of floats
  embedded_at  TEXT NOT NULL,         -- ISO 8601
  PRIMARY KEY(chunk_id, model),
  FOREIGN KEY(chunk_id) REFERENCES brain_chunks(id) ON DELETE CASCADE
);

-- Support fast lookup during staleness check and search
CREATE INDEX IF NOT EXISTS idx_chunks_path ON brain_chunks(path);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON brain_embeddings(model);
```

### Module Responsibilities

| Module | Owns |
|---|---|
| `src/lib/brain/index-db.ts` | SQLite open/init, DDL, CRUD for `brain_docs`, `brain_chunks`, `brain_embeddings`; `ChunkIndexPlan` computation; all types defined above |
| `src/lib/brain/chunking.ts` | `BrainChunk` production from raw text (heading splits, overlap, tokenEstimate) |
| `src/lib/embeddings/provider.ts` | `EmbeddingsConfig` with new sub-objects; `getEmbeddingsConfig()` extension |
| `src/lib/brain/hybrid-search.ts` | `ChunkCandidate` merge, `ChunkHit` output; calls `index-db.ts` for chunk+vector fetch |
| `src/lib/brain/mmr.ts` | MMR reranking operating on `ChunkWithEmbedding[]`, returns `ChunkHit[]` |

## Open Questions

- Which embedding model will be canonical across OpenClaw, HiveMatrix, and Brainpower?
- Should the first implementation support all `~/_GD/brain` docs, or a curated subset while the embedding endpoint stabilizes?
- Should vectors stay JSON for v1, or should v1 include binary blobs for smaller/faster storage?
- Should skills receive a ranking boost, or should skill search remain separate for now?

## Recommended First Slice

Build this in two phases:

1. **BM25 SQLite index first**
   - no embedding endpoint dependency
   - improves exact recall immediately
   - proves index schema, incremental hashing, and route compatibility

2. **Chunk embeddings + hybrid + MMR**
   - depends on local embedding endpoint being stable
   - improves semantic recall
   - keeps keyword fallback intact

