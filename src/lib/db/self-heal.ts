/**
 * Startup self-heal for silently-emptied user-data tables.
 *
 * The daemon already backs up the DB before an update and rolls back if a
 * migration THROWS (see daemon/index.ts + updater.ts). But a migration — or a
 * stray process pointed at the real DB path — can leave a table *empty* without
 * raising, so the throw-based rollback never fires and user data (goals, the
 * Message Lane allowlist) vanishes silently. This happened on 2026-07-15.
 *
 * This guard is the backstop: on boot, for a small allowlist of high-value,
 * user-authored tables, if the live table is completely empty but a recent
 * backup still has rows, restore those rows. It is deliberately conservative —
 * it only ever *adds* rows into an empty table, never overwrites or deletes, and
 * maps by shared column names so it survives schema migrations that added or
 * dropped columns since the backup was written.
 */

import type Database from "better-sqlite3";
import { readdirSync } from "fs";
import { join } from "path";

/**
 * Tables safe to auto-restore: low-volume, user-authored, "empty" == data loss,
 * and — critically — restoring them has NO outbound side effects.
 *
 * `message_identities` is deliberately EXCLUDED. Re-populating the Message Lane
 * allowlist can re-arm a backlog replay: if the channel is enabled with a stale
 * `lastRowid` (as happens right after a wipe/recreate), the poller treats all
 * historical iMessages from a freshly-restored sender as new inbound and
 * auto-replies to every one. That footgun caused a real incident on 2026-07-15.
 * The allowlist must be restored deliberately via the setup UI, which routes
 * through /messagebee/enable and advances the high-water mark first.
 */
export const HEALABLE_TABLES = ["goals"] as const;

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ATTACH_ALIAS = "heal_src";

export interface HealResult {
  table: string;
  restored: number;
  /** Backup filename the rows were restored from. */
  from: string;
}

interface HealOptions {
  db: Database.Database;
  backupsDir: string;
  tables?: readonly string[];
}

function columnsOf(db: Database.Database, table: string, schema = "main"): string[] {
  const rows = db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

function rowCount(db: Database.Database, table: string, schema = "main"): number {
  const row = db.prepare(`SELECT count(*) AS c FROM ${schema}.${table}`).get() as { c: number };
  return row.c;
}

/** Newest-first list of backup DB files (ISO-stamped names sort chronologically). */
function listBackups(backupsDir: string): string[] {
  try {
    return readdirSync(backupsDir)
      .filter((f) => f.startsWith("hivematrix-") && f.endsWith(".db"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Restore rows into any empty healable table from the most recent backup that
 * still has rows for it. Returns one HealResult per table actually healed.
 * Never throws for an individual backup/table — a bad backup is skipped.
 */
export function healEmptiedTables(opts: HealOptions): HealResult[] {
  const { db, backupsDir } = opts;
  const tables = (opts.tables ?? HEALABLE_TABLES).filter((t) => IDENT.test(t));
  const healed: HealResult[] = [];

  // Only bother scanning backups for tables that are actually empty right now.
  const empty = tables.filter((t) => {
    try {
      return rowCount(db, t) === 0;
    } catch {
      return false; // table missing in live DB — nothing we can (or should) do
    }
  });
  if (empty.length === 0) return healed;

  const backups = listBackups(backupsDir);
  const remaining = new Set(empty);

  for (const file of backups) {
    if (remaining.size === 0) break;
    const path = join(backupsDir, file);
    let attached = false;
    try {
      db.prepare(`ATTACH DATABASE ? AS ${ATTACH_ALIAS}`).run(path);
      attached = true;

      for (const table of [...remaining]) {
        try {
          const exists = db
            .prepare(`SELECT count(*) AS c FROM ${ATTACH_ALIAS}.sqlite_master WHERE type='table' AND name=?`)
            .get(table) as { c: number };
          if (!exists.c) continue;
          if (rowCount(db, table, ATTACH_ALIAS) === 0) continue;

          // Map by shared columns so a schema change since the backup is fine.
          const liveCols = new Set(columnsOf(db, table));
          const shared = columnsOf(db, table, ATTACH_ALIAS).filter((c) => liveCols.has(c));
          if (shared.length === 0) continue;
          const colList = shared.map((c) => `"${c}"`).join(", ");

          const info = db
            .prepare(`INSERT INTO main.${table} (${colList}) SELECT ${colList} FROM ${ATTACH_ALIAS}.${table}`)
            .run();
          if (info.changes > 0) {
            healed.push({ table, restored: Number(info.changes), from: file });
            remaining.delete(table);
          }
        } catch {
          // Skip this table for this backup; try an older one.
        }
      }
    } catch {
      // Unreadable/corrupt backup — move on.
    } finally {
      if (attached) {
        try {
          db.prepare(`DETACH DATABASE ${ATTACH_ALIAS}`).run();
        } catch {
          /* ignore */
        }
      }
    }
  }

  return healed;
}
