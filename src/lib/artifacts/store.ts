import { getDb, generateId } from "@/lib/db";

export interface ArtifactRow {
  _id: string;
  scope: "task" | "mission" | "shared";
  scopeId: string | null;
  filename: string;
  title: string | null;
  mimeType: string;
  sizeBytes: number;
  stem: string;
  versionNum: number;
  state: "active" | "superseded" | "pinned" | "archived";
  supersededBy: string | null;
  metadata: string;
  createdAt: string;
  updatedAt: string;
}

export type ArtifactDoc = Omit<ArtifactRow, "metadata"> & {
  metadata: Record<string, unknown>;
};

function rowToArtifact(row: ArtifactRow): ArtifactDoc {
  return { ...row, metadata: JSON.parse(row.metadata || "{}") };
}

export const Artifact = {
  list(query: { scope?: string; scopeId?: string | null; includeArchived?: boolean } = {}): ArtifactDoc[] {
    const db = getDb();
    const conds: string[] = [];
    const params: unknown[] = [];
    if (query.scope) { conds.push("scope = ?"); params.push(query.scope); }
    if (query.scopeId !== undefined) {
      if (query.scopeId === null) { conds.push("scopeId IS NULL"); }
      else { conds.push("scopeId = ?"); params.push(query.scopeId); }
    }
    if (!query.includeArchived) {
      conds.push("state != 'archived'");
    }
    const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
    const rows = db.prepare(
      `SELECT * FROM artifacts${where} ORDER BY (state = 'pinned') DESC, createdAt DESC`
    ).all(...params) as ArtifactRow[];
    return rows.map(rowToArtifact);
  },

  findById(id: string): ArtifactDoc | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM artifacts WHERE _id = ?").get(id) as ArtifactRow | undefined;
    return row ? rowToArtifact(row) : null;
  },

  findByFile(scope: string, scopeId: string | null, filename: string): ArtifactDoc | null {
    const db = getDb();
    const row = scopeId === null
      ? db.prepare("SELECT * FROM artifacts WHERE scope = ? AND scopeId IS NULL AND filename = ?").get(scope, filename) as ArtifactRow | undefined
      : db.prepare("SELECT * FROM artifacts WHERE scope = ? AND scopeId = ? AND filename = ?").get(scope, scopeId, filename) as ArtifactRow | undefined;
    return row ? rowToArtifact(row) : null;
  },

  nextVersion(scope: string, scopeId: string | null, stem: string): number {
    const db = getDb();
    const row = scopeId === null
      ? db.prepare("SELECT MAX(versionNum) as m FROM artifacts WHERE scope = ? AND scopeId IS NULL AND stem = ?").get(scope, stem) as { m: number | null }
      : db.prepare("SELECT MAX(versionNum) as m FROM artifacts WHERE scope = ? AND scopeId = ? AND stem = ?").get(scope, scopeId, stem) as { m: number | null };
    return (row.m ?? 0) + 1;
  },

  upsert(data: {
    _id?: string;
    scope: string;
    scopeId: string | null;
    filename: string;
    title?: string | null;
    mimeType: string;
    sizeBytes: number;
    stem: string;
    versionNum: number;
    metadata?: Record<string, unknown>;
  }): ArtifactDoc {
    const db = getDb();
    const existing = Artifact.findByFile(data.scope, data.scopeId, data.filename);
    if (existing) {
      db.prepare(`UPDATE artifacts SET
        mimeType = ?, sizeBytes = ?, title = COALESCE(?, title),
        metadata = ?, updatedAt = datetime('now')
        WHERE _id = ?`).run(
        data.mimeType, data.sizeBytes, data.title ?? null,
        JSON.stringify(data.metadata ?? existing.metadata), existing._id
      );
      return Artifact.findById(existing._id)!;
    }
    const id = data._id ?? generateId();
    db.prepare(`INSERT INTO artifacts
      (_id, scope, scopeId, filename, title, mimeType, sizeBytes, stem, versionNum, state, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(
      id, data.scope, data.scopeId, data.filename, data.title ?? null,
      data.mimeType, data.sizeBytes, data.stem, data.versionNum,
      JSON.stringify(data.metadata ?? {})
    );

    if (data.stem) {
      const prior = data.scopeId === null
        ? db.prepare(`SELECT _id FROM artifacts WHERE scope = ? AND scopeId IS NULL AND stem = ? AND state = 'active' AND _id != ?`).all(data.scope, data.stem, id) as { _id: string }[]
        : db.prepare(`SELECT _id FROM artifacts WHERE scope = ? AND scopeId = ? AND stem = ? AND state = 'active' AND _id != ?`).all(data.scope, data.scopeId, data.stem, id) as { _id: string }[];
      for (const p of prior) {
        db.prepare("UPDATE artifacts SET state = 'superseded', supersededBy = ?, updatedAt = datetime('now') WHERE _id = ?").run(id, p._id);
      }
    }

    return Artifact.findById(id)!;
  },

  delete(id: string): ArtifactDoc | null {
    const db = getDb();
    const existing = Artifact.findById(id);
    if (!existing) return null;
    db.prepare("DELETE FROM artifacts WHERE _id = ?").run(id);
    return existing;
  },

  deleteByFile(scope: string, scopeId: string | null, filename: string): ArtifactDoc | null {
    const existing = Artifact.findByFile(scope, scopeId, filename);
    if (!existing) return null;
    return Artifact.delete(existing._id);
  },

  countByScope(scope: string, scopeId: string | null): number {
    const db = getDb();
    const row = scopeId === null
      ? db.prepare("SELECT COUNT(*) as c FROM artifacts WHERE scope = ? AND scopeId IS NULL AND state != 'archived'").get(scope) as { c: number }
      : db.prepare("SELECT COUNT(*) as c FROM artifacts WHERE scope = ? AND scopeId = ? AND state != 'archived'").get(scope, scopeId) as { c: number };
    return row.c;
  },

  countsByTaskIds(taskIds: string[]): Record<string, number> {
    if (taskIds.length === 0) return {};
    const db = getDb();
    const placeholders = taskIds.map(() => "?").join(",");
    const rows = db.prepare(`SELECT scopeId, COUNT(*) as c FROM artifacts
      WHERE scope = 'task' AND scopeId IN (${placeholders}) AND state != 'archived'
      GROUP BY scopeId`).all(...taskIds) as { scopeId: string; c: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.scopeId] = r.c;
    return out;
  },

  setState(id: string, state: ArtifactDoc["state"]): void {
    const db = getDb();
    db.prepare("UPDATE artifacts SET state = ?, updatedAt = datetime('now') WHERE _id = ?").run(state, id);
  },
};
