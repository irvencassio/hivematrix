/**
 * Message Lane I/O against macOS Messages — self-contained (no external CLI).
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
import { attemptReserve, markSent, alreadySent, isSlotClaimed } from "./send-cap";

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

// Image extensions we'll forward to Flash as vision attachments. Other
// attachment kinds (audio notes, vcards, etc.) are intentionally excluded —
// there's no Read-based vision path for them yet.
const IMAGE_ATTACHMENT_RE = /\.(jpe?g|png|gif|heic|heif|webp)$/i;

function isImageAttachment(filename: string): boolean {
  return IMAGE_ATTACHMENT_RE.test(filename);
}

// chat.db attachment.filename stores a literal `~/Library/Messages/Attachments/...`
// path (tilde un-expanded) — expand it against the current user's home so it's
// directly readable.
function expandTilde(path: string): string {
  return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

// A photo-only iMessage carries the Unicode "object replacement character"
// (U+FFFC) in m.text as a placeholder for the inline attachment — strip it so
// callers see a clean empty string (not a mystery character) for photo-only text.
const ATTACHMENT_PLACEHOLDER_RE = /￼/g;

function stripAttachmentPlaceholder(text: string): string {
  return text.replace(ATTACHMENT_PLACEHOLDER_RE, "").trim();
}

/** Fetch image-only attachment paths for a batch of message ROWIDs, grouped by message. */
function fetchImageAttachments(db: Database.Database, rowids: number[]): Map<number, string[]> {
  if (rowids.length === 0) return new Map();
  const placeholders = rowids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT maj.message_id AS messageId, a.filename AS filename
         FROM message_attachment_join maj
         JOIN attachment a ON a.ROWID = maj.attachment_id
        WHERE maj.message_id IN (${placeholders})`,
    )
    .all(...rowids) as Array<{ messageId: number; filename: string | null }>;

  const byMessage = new Map<number, string[]>();
  for (const row of rows) {
    if (!row.filename || !isImageAttachment(row.filename)) continue;
    const list = byMessage.get(row.messageId) ?? [];
    list.push(expandTilde(row.filename));
    byMessage.set(row.messageId, list);
  }
  return byMessage;
}

/**
 * Diagnose whether the daemon can read chat.db. Opening and schema probing are
 * split so the UI can avoid blaming Full Disk Access for schema/drift failures.
 */
export function probeChatDbAccess(path = chatDbPath()): ChatDbAccessProbe {
  if (!existsSync(path)) {
    return { ok: false, reason: "missing", detail: `Messages database not found: ${path}` };
  }
  let db: Database.Database;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (error) {
    return {
      ok: false,
      reason: "open_failed",
      detail: `Cannot open Messages database. The daemon that reads chat.db (Contents/Resources/daemon/bin/node) runs as its own separately-signed process, independent of the HiveMatrix app — granting Full Disk Access to "HiveMatrix" in System Settings does not cover it. Reveal the daemon binary in Finder and add it to Full Disk Access directly, then restart the daemon: ${errorDetail(error)}`,
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
 * Read inbound (is_from_me = 0) messages with ROWID > sinceRowid — text
 * messages as before, PLUS photo-only messages (empty/placeholder text but at
 * least one attachment): `message_attachment_join` is LEFT JOINed so a row
 * with a non-empty text OR any attachment survives the WHERE clause; image
 * attachment paths are fetched in a second query (fetchImageAttachments) to
 * avoid GROUP_CONCAT separator/escaping headaches. Returns rows ascending
 * plus the new high-water ROWID. Read-only; never writes.
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
      `SELECT DISTINCT m.ROWID AS rowid, m.text AS text, m.date AS appleDate,
              h.id AS handle, m.service AS service
         FROM message m
         LEFT JOIN handle h ON m.handle_id = h.ROWID
         LEFT JOIN message_attachment_join maj ON maj.message_id = m.ROWID
        WHERE m.ROWID > ? AND m.is_from_me = 0
          AND (
            (m.text IS NOT NULL AND TRIM(m.text) != '')
            OR maj.attachment_id IS NOT NULL
          )
        ORDER BY m.ROWID ASC
        LIMIT ?`,
    ).all(sinceRowid, limit) as Array<{
      rowid: number; text: string | null; appleDate: number; handle: string | null; service: string | null;
    }>;

    const attachmentsByMessage = fetchImageAttachments(db, rows.map((r) => r.rowid));

    const messages: InboundMessage[] = rows
      .filter((r) => r.handle) // drop group/unknown-sender rows for the v1 slice
      .map((r) => ({
        rowid: r.rowid,
        handle: r.handle as string,
        text: stripAttachmentPlaceholder(r.text ?? ""),
        receivedAt: appleDateToIso(r.appleDate),
        service: r.service ?? "iMessage",
        attachments: attachmentsByMessage.get(r.rowid) ?? [],
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

// Use the modern `account` + `participant` API. The legacy `buddy … of service`
// lookup hangs on recent macOS (AppleEvent timed out / -1712), which is why
// Message Lane replies silently never delivered. `with timeout` bounds it so a
// stuck Messages can't block the whole send for the default 2 minutes.
// argv: handle, text, sendAs, then 0+ attachment file paths. Text is sent only
// when non-empty (so a voice note can be sent with no caption); each attachment
// is sent as its own message via `send (POSIX file ...)` — the iMessage
// equivalent of Mail Lane's attachment loop. Audio (.m4a) arrives as a playable
// bubble.
//
// sendAs pins WHICH of the Mac's iMessage accounts sends the message: the first
// account whose id contains sendAs (e.g. the agent's dedicated Apple ID). When
// empty — or no account matches — it falls back to the 1st iMessage account
// (the historical behavior). This matters once the box has more than one
// iMessage account signed in (e.g. the dedicated agent identity alongside a
// personal one): "1st account" is otherwise nondeterministic and could send as
// the wrong identity — including texting a shared number as a self-send.
export const SEND_SCRIPT = `on run argv
  set targetHandle to item 1 of argv
  set targetMessage to item 2 of argv
  set sendAs to item 3 of argv
  with timeout of 30 seconds
    tell application "Messages"
      set targetAccount to missing value
      if sendAs is not "" then
        repeat with acct in (every account whose service type = iMessage)
          if (id of acct) contains sendAs then
            set targetAccount to acct
            exit repeat
          end if
        end repeat
      end if
      if targetAccount is missing value then
        set targetAccount to 1st account whose service type = iMessage
      end if
      set targetParticipant to participant targetHandle of targetAccount
      if targetMessage is not "" then send targetMessage to targetParticipant
      if (count of argv) > 3 then
        repeat with i from 4 to (count of argv)
          try
            send (POSIX file (item i of argv)) to targetParticipant
          end try
        end repeat
      end if
    end tell
  end timeout
end run`;

/**
 * Send an iMessage to a handle, optionally with file attachments (e.g. a voice
 * note). Resolves false on failure (never throws). Text may be empty when only
 * attachments are being sent. `sendAs` optionally pins the sending account (see
 * SEND_SCRIPT); "" uses the first iMessage account.
 */
/**
 * Send an iMessage to the specified handle.
 *
 * CRITICAL: When runId is provided, enforces atomic per-run send cap. At most one send
 * per (runId, handle) pair can succeed. Subsequent attempts within the same run are
 * rejected immediately, blocking all retry paths (failed-task re-dispatch, internal
 * retries, daemon restarts, concurrent processes).
 *
 * @param handle The recipient handle (e.g. "+15136595163", "cassio.irv@gmail.com")
 * @param text The message text
 * @param attachments Optional attachment file paths
 * @param sendAs Optional iMessage account selector (defaults to first account)
 * @param timeoutMs Execution timeout in milliseconds
 * @param runId Optional run ID for enforcing per-run send cap (used by directive/audit runs, etc)
 * @returns true if send succeeded, false otherwise. If runId is provided and slot is
 *          already claimed, returns false without attempting to send.
 */
export function sendIMessage(
  handle: string,
  text: string,
  attachments: string[] = [],
  sendAs = "",
  timeoutMs = 30_000,
  runId?: string,
): Promise<boolean> {
  // Per-run send cap enforcement (defense-in-depth, atomic at two layers):
  // Layer 1: Dispatch layer (executeMessageBeeSend) enforces the cap via attemptReserve.
  // Layer 2: Direct callers (notify, poller) also check here as a fallback.
  //
  // Key: Only reserve if not already reserved. If already sent, reject the duplicate.
  if (runId) {
    // Check current state: reserved? sent?
    const isSentAlready = alreadySent(runId, handle);
    if (isSentAlready) {
      // Already sent in this run. Reject duplicate.
      console.warn(`[messagebee] send to ${handle} in run ${runId} rejected: already sent`);
      return Promise.resolve(false);
    }

    const isReservedAlready = isSlotClaimed(runId, handle);
    if (!isReservedAlready) {
      // Slot is free; reserve it. This fails if another process claimed it.
      const reserved = attemptReserve(runId, handle);
      if (!reserved) {
        // Another process claimed the slot (concurrent race). Reject.
        console.warn(`[messagebee] send to ${handle} in run ${runId} rejected: slot claimed by concurrent process`);
        return Promise.resolve(false);
      }
    }
    // At this point, slot is reserved (either by us or by the dispatch layer);
    // we're clear to proceed with the send.
  }

  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", SEND_SCRIPT, handle, text, sendAs, ...attachments],
      { timeout: timeoutMs },
      (err, _stdout, stderr) => {
        if (err) {
          // Surface WHY in the daemon log instead of swallowing it silently.
          console.error(`[messagebee] send to ${handle} failed: ${(stderr || err.message || "").trim()}`);
          resolve(false);
        } else {
          // Mark the send as successful (idempotent).
          if (runId) {
            markSent(runId, handle);
          }
          resolve(true);
        }
      },
    );
  });
}
