/**
 * Shared types, chunk ID helpers, and SQLite storage for the brain hybrid index.
 */

import Database from "better-sqlite3";

/** Stable primary key for a chunk: "{relPath}#{chunkIndex}" */
export function chunkId(relPath: string, chunkIndex: number): string {
  return `${relPath}#${chunkIndex}`;
}

/** A chunk of text derived from a brain document. */
export interface BrainChunk {
  id: string;           // "{relPath}#{chunkIndex}"
  path: string;         // brain-relative path, e.g. "projects/hive/agent-brief.md"
  chunkIndex: number;   // 0-based within the document
  heading: string | null; // nearest heading above this chunk, or null for preamble
  text: string;         // raw chunk text (overlap included)
  tokenEstimate: number; // word count ≈ token count; used to enforce size bounds
}

/** One row in brain_embeddings (chunk_id, model) pair. */
export interface StoredEmbedding {
  chunkId: string;
  model: string;
  dims: number;
  vector: number[];     // deserialized from vector_json
  embeddedAt: string;   // ISO 8601
}

/** A chunk joined with its embedding — fed into cosine ranking. */
export interface ChunkWithEmbedding {
  id: string;
  path: string;
  chunkIndex: number;
  heading: string | null;
  text: string;
  vector: number[];
}

/** Intermediate type during hybrid merge (before final ranking). */
export interface ChunkCandidate {
  id: string;
  path: string;
  heading: string | null;
  text: string;
  bm25Score: number;    // normalized to [0, 1]; 0 if absent from BM25 results
  cosineScore: number;  // normalized to [0, 1]; 0 if no embedding available
  hybridScore: number;  // textWeight * bm25Score + vectorWeight * cosineScore
}

/** Final hit shape returned from hybrid/MMR pipeline. */
export interface ChunkHit {
  id: string;
  path: string;
  heading: string | null;
  snippet: string;      // first 300 chars of chunk text, normalized whitespace
  score: number;        // hybridScore, rounded to 3 decimal places
  sources: Array<"keyword" | "semantic">;
}

/** Per-reindex pass diff — computed by index-db once SQLite CRUD is implemented. */
export interface ChunkIndexPlan {
  pathsToReindex: string[];  // docs whose hash changed → delete+rechunk+re-embed
  pathsToPrune: string[];    // docs deleted from disk → delete from brain_docs
  modelChanged: boolean;     // true → wipe brain_embeddings before re-embedding
  chunksToEmbed: string[];   // chunk ids needing an embedding this pass
}

/**
 * SQLite DDL for the brain index.
 * Executed once by the DB init function (to be implemented in a later task).
 * Listed here as the authoritative schema reference.
 */
export const BRAIN_INDEX_DDL = `
CREATE TABLE IF NOT EXISTS brain_docs (
  path        TEXT PRIMARY KEY,
  hash        TEXT NOT NULL,
  title       TEXT,
  mtime_ms    INTEGER,
  size_bytes  INTEGER,
  indexed_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_chunks (
  id             TEXT PRIMARY KEY,
  path           TEXT NOT NULL,
  chunk_index    INTEGER NOT NULL,
  heading        TEXT,
  text           TEXT NOT NULL,
  token_estimate INTEGER,
  FOREIGN KEY(path) REFERENCES brain_docs(path) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS brain_chunks_fts USING fts5(
  path,
  title,
  heading,
  text
);

CREATE TABLE IF NOT EXISTS brain_embeddings (
  chunk_id     TEXT NOT NULL,
  model        TEXT NOT NULL,
  dims         INTEGER NOT NULL,
  vector_json  TEXT NOT NULL,
  embedded_at  TEXT NOT NULL,
  PRIMARY KEY(chunk_id, model),
  FOREIGN KEY(chunk_id) REFERENCES brain_chunks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_path ON brain_chunks(path);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON brain_embeddings(model);
	`.trim();

export type BrainIndexDb = Database.Database;

export interface BrainDocInput {
  path: string;
  hash: string;
  title: string | null;
  mtimeMs: number;
  sizeBytes: number;
}

export interface RawBm25Hit {
  id: string;
  path: string;
  heading: string | null;
  text: string;
  bm25Score: number;
}

export function openBrainIndex(path: string): BrainIndexDb {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(BRAIN_INDEX_DDL);
  return db;
}

export function upsertDoc(db: BrainIndexDb, doc: BrainDocInput): void {
  db.prepare(`
    INSERT INTO brain_docs (path, hash, title, mtime_ms, size_bytes, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      hash = excluded.hash,
      title = excluded.title,
      mtime_ms = excluded.mtime_ms,
      size_bytes = excluded.size_bytes,
      indexed_at = excluded.indexed_at
  `).run(doc.path, doc.hash, doc.title, doc.mtimeMs, doc.sizeBytes, new Date().toISOString());
}

function deleteChunksForPath(db: BrainIndexDb, path: string): void {
  db.prepare(`
    DELETE FROM brain_chunks_fts
    WHERE rowid IN (SELECT rowid FROM brain_chunks WHERE path = ?)
  `).run(path);
  db.prepare("DELETE FROM brain_chunks WHERE path = ?").run(path);
}

export function upsertChunks(db: BrainIndexDb, chunks: BrainChunk[], title: string | null): void {
  if (!chunks.length) return;
  const path = chunks[0].path;
  const tx = db.transaction(() => {
    deleteChunksForPath(db, path);
    const chunkStmt = db.prepare(`
      INSERT INTO brain_chunks (id, path, chunk_index, heading, text, token_estimate)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const ftsStmt = db.prepare(`
      INSERT INTO brain_chunks_fts (rowid, path, title, heading, text)
      VALUES (?, ?, ?, ?, ?)
    `);
    const rowidStmt = db.prepare("SELECT rowid FROM brain_chunks WHERE id = ?");
    for (const chunk of chunks) {
      chunkStmt.run(chunk.id, chunk.path, chunk.chunkIndex, chunk.heading, chunk.text, chunk.tokenEstimate);
      const row = rowidStmt.get(chunk.id) as { rowid: number } | undefined;
      if (row) ftsStmt.run(row.rowid, chunk.path, title, chunk.heading, chunk.text);
    }
  });
  tx();
}

export function deleteDoc(db: BrainIndexDb, path: string): void {
  const tx = db.transaction(() => {
    deleteChunksForPath(db, path);
    db.prepare("DELETE FROM brain_docs WHERE path = ?").run(path);
  });
  tx();
}

export function upsertEmbedding(db: BrainIndexDb, embedding: StoredEmbedding): void {
  db.prepare(`
    INSERT INTO brain_embeddings (chunk_id, model, dims, vector_json, embedded_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id, model) DO UPDATE SET
      dims = excluded.dims,
      vector_json = excluded.vector_json,
      embedded_at = excluded.embedded_at
  `).run(
    embedding.chunkId,
    embedding.model,
    embedding.dims,
    JSON.stringify(embedding.vector),
    embedding.embeddedAt,
  );
}

export function getChunksWithEmbeddings(db: BrainIndexDb, model: string): ChunkWithEmbedding[] {
  const rows = db.prepare(`
    SELECT c.id, c.path, c.chunk_index AS chunkIndex, c.heading, c.text, e.vector_json AS vectorJson
    FROM brain_chunks c
    JOIN brain_embeddings e ON e.chunk_id = c.id
    WHERE e.model = ?
    ORDER BY c.path ASC, c.chunk_index ASC
  `).all(model) as Array<{
    id: string;
    path: string;
    chunkIndex: number;
    heading: string | null;
    text: string;
    vectorJson: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    chunkIndex: row.chunkIndex,
    heading: row.heading,
    text: row.text,
    vector: JSON.parse(row.vectorJson) as number[],
  }));
}

export function computeReindexPlan(
  db: BrainIndexDb,
  diskHashes: Map<string, string>,
  embeddingModel: string,
): ChunkIndexPlan {
  const docs = db.prepare("SELECT path, hash FROM brain_docs").all() as Array<{ path: string; hash: string }>;
  const docsByPath = new Map(docs.map((doc) => [doc.path, doc.hash]));
  const pathsToReindex: string[] = [];
  const pathsToPrune: string[] = [];

  for (const [path, hash] of diskHashes.entries()) {
    if (docsByPath.get(path) !== hash) pathsToReindex.push(path);
  }
  for (const path of docsByPath.keys()) {
    if (!diskHashes.has(path)) pathsToPrune.push(path);
  }

  const modelRows = db.prepare("SELECT DISTINCT model FROM brain_embeddings").all() as Array<{ model: string }>;
  const modelChanged = modelRows.length > 0 && modelRows.some((row) => row.model !== embeddingModel);
  const chunksToEmbed = (db.prepare(`
    SELECT c.id
    FROM brain_chunks c
    LEFT JOIN brain_embeddings e ON e.chunk_id = c.id AND e.model = ?
    WHERE e.chunk_id IS NULL
    ORDER BY c.path ASC, c.chunk_index ASC
  `).all(embeddingModel) as Array<{ id: string }>).map((row) => row.id);

  return {
    pathsToReindex,
    pathsToPrune,
    modelChanged,
    chunksToEmbed,
  };
}

export function fts5Search(db: BrainIndexDb, query: string, limit: number): RawBm25Hit[] {
  if (!query.trim() || limit <= 0) return [];
  try {
    const rows = db.prepare(`
      SELECT
        c.id,
        c.path,
        c.heading,
        c.text,
        bm25(brain_chunks_fts) AS bm25Score
      FROM brain_chunks_fts
      JOIN brain_chunks c ON c.rowid = brain_chunks_fts.rowid
      WHERE brain_chunks_fts MATCH ?
      ORDER BY bm25Score ASC
      LIMIT ?
    `).all(query, limit) as RawBm25Hit[];
    return rows;
  } catch {
    return [];
  }
}
