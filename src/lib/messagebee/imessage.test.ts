import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { appleDateToIso, readInboundSince, currentMaxRowid } from "./imessage";

test("appleDateToIso handles seconds and nanoseconds since 2001", () => {
  // 0 seconds since 2001 epoch
  assert.equal(appleDateToIso(0), new Date(0).toISOString());
  // 631_152_000 seconds after 2001-01-01 == 2021-01-01
  assert.equal(appleDateToIso(631_152_000).slice(0, 4), "2021");
  // nanoseconds form (same instant ×1e9) resolves to the same year
  assert.equal(appleDateToIso(631_152_000 * 1e9).slice(0, 4), "2021");
});

/** Build a minimal chat.db (message + handle) for the reader test. */
function makeChatDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "mb-chatdb-"));
  const path = join(dir, "chat.db");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY, text TEXT, is_from_me INTEGER,
      date INTEGER, handle_id INTEGER, service TEXT
    );
    INSERT INTO handle (ROWID, id) VALUES (1, '+15551234567'), (2, 'friend@example.com');
    INSERT INTO message (ROWID, text, is_from_me, date, handle_id, service) VALUES
      (10, 'first inbound', 0, 631152000000000000, 1, 'iMessage'),
      (11, 'sent by me',    1, 631152001000000000, 1, 'iMessage'),
      (12, 'second inbound',0, 631152002000000000, 2, 'iMessage'),
      (13, '',              0, 631152003000000000, 1, 'iMessage'),
      (14, 'no handle',     0, 631152004000000000, NULL, 'SMS');
  `);
  db.close();
  return path;
}

test("readInboundSince returns only new inbound text messages, sets high-water", () => {
  const path = makeChatDb();
  try {
    const { messages, maxRowid } = readInboundSince(0, 50, path);
    // is_from_me=1 (11), empty text (13), and NULL-handle (14) are excluded.
    assert.deepEqual(messages.map((m) => m.rowid), [10, 12]);
    assert.equal(messages[0].handle, "+15551234567");
    assert.equal(messages[1].handle, "friend@example.com");
    assert.equal(maxRowid, 14); // high-water advances past all scanned rows

    // since the last-seen rowid → nothing new
    assert.deepEqual(readInboundSince(14, 50, path).messages, []);
    assert.equal(currentMaxRowid(path), 14);
  } finally {
    rmSync(join(path, ".."), { recursive: true, force: true });
  }
});
