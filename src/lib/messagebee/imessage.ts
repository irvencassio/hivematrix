/**
 * MessageBee I/O against macOS Messages — self-contained (no external CLI).
 *
 *   read:  ~/Library/Messages/chat.db via better-sqlite3 (read-only), needs
 *          Full Disk Access for the daemon process.
 *   send:  osascript AppleScript `tell application "Messages" … send`, with the
 *          recipient + text passed as `on run` argv so nothing is string-escaped
 *          into the script body.
 *
 * The send path is independent of the read path on purpose: a chat.db schema
 * drift (Apple changes it across macOS versions) can break reading without
 * breaking the ability to reply.
 */

import Database from "better-sqlite3";
import { execFile } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { type InboundMessage } from "./contracts";

const APPLE_EPOCH_UNIX_SECONDS = 978_307_200; // 2001-01-01T00:00:00Z

export type ChatDbAccessReason = "missing" | "open_failed" | "schema_failed";

export type ChatDbAccessProbe =
  | { ok: true; detail: string }
  | { ok: false; reason: ChatDbAccessReason; detail: string };

export function chatDbPath(): string {
  return join(homedir(), "Library", "Messages", "chat.db");
}

/** Convert a chat.db `message.date` (seconds OR nanoseconds since 2001) to ISO. */
export function appleDateToIso(appleDate: number): string {
  if (!appleDate || appleDate <= 0) return new Date(0).toISOString();
  // Modern macOS stores nanoseconds (values ~1e18); older stored seconds.
  const unixSeconds = appleDate > 1e12 ? appleDate / 1e9 + APPLE_EPOCH_UNIX_SECONDS
    : appleDate + APPLE_EPOCH_UNIX_SECONDS;
  return new Date(unixSeconds * 1000).toISOString();
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Diagnose whether the daemon can read chat.db. Opening and schema probing are
 * split so the UI can avoid blaming Full Disk Access for schema/drift failures.
 */
export function probeChatDbAccess(path = chatDbPath()): ChatDbAccessProbe {
  if (!existsSync(path)) {
    return { ok: false, reason: "missing", detail: `Messages database not found: ${path}` };
  }
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (error) {
    return {
      ok: false,
      reason: "open_failed",
      detail: `Cannot open Messages database; grant Full Disk Access to the running HiveMatrix app/daemon, then restart HiveMatrix: ${errorDetail(error)}`,
    };
  }

  try {
    db.prepare("SELECT 1 FROM message LIMIT 1").get();
    return { ok: true, detail: "Messages database readable" };
  } catch (error) {
    return {
      ok: false,
      reason: "schema_failed",
      detail: `Messages database opened, but the message table check failed: ${errorDetail(error)}`,
    };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/**
 * Can the daemon read chat.db? False when the file is missing, inaccessible, or
 * the Messages schema probe fails. Use probeChatDbAccess when user-facing detail
 * matters.
 */
export function canReadChatDb(path = chatDbPath()): boolean {
  return probeChatDbAccess(path).ok;
}

/**
 * Read inbound (is_from_me = 0) text messages with ROWID > sinceRowid.
 * Returns them ascending plus the new high-water ROWID. Read-only; never writes.
 */
export function readInboundSince(
  sinceRowid: number,
  limit = 50,
  path = chatDbPath(),
): { messages: InboundMessage[]; maxRowid: number } {
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      `SELECT m.ROWID AS rowid, m.text AS text, m.date AS appleDate,
              h.id AS handle, m.service AS service
         FROM message m
         LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.ROWID > ? AND m.is_from_me = 0
          AND m.text IS NOT NULL AND TRIM(m.text) != ''
        ORDER BY m.ROWID ASC
        LIMIT ?`,
    ).all(sinceRowid, limit) as Array<{
      rowid: number; text: string; appleDate: number; handle: string | null; service: string | null;
    }>;

    const messages: InboundMessage[] = rows
      .filter((r) => r.handle) // drop group/unknown-sender rows for the v1 slice
      .map((r) => ({
        rowid: r.rowid,
        handle: r.handle as string,
        text: r.text,
        receivedAt: appleDateToIso(r.appleDate),
        service: r.service ?? "iMessage",
      }));

    const maxRowid = rows.reduce((mx, r) => Math.max(mx, r.rowid), sinceRowid);
    return { messages, maxRowid };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/** Current max message ROWID — used to set the initial high-water mark so we
 *  don't replay the entire message history on first enable. */
export function currentMaxRowid(path = chatDbPath()): number {
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT MAX(ROWID) AS mx FROM message").get() as { mx: number | null };
    return row?.mx ?? 0;
  } catch {
    return 0;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

const SEND_SCRIPT = `on run argv
  set targetHandle to item 1 of argv
  set targetMessage to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy targetHandle of targetService
    send targetMessage to targetBuddy
  end tell
end run`;

/** Send an iMessage to a handle. Resolves false on failure (never throws). */
export function sendIMessage(handle: string, text: string, timeoutMs = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", SEND_SCRIPT, handle, text],
      { timeout: timeoutMs },
      (err) => resolve(!err),
    );
  });
}
