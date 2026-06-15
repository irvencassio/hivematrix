import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  appleDateToIso,
  canReadChatDb,
  currentMaxRowid,
  probeChatDbAccess,
  readInboundSince,
  SEND_SCRIPT,
} from "./imessage";

test("send script uses the modern account/participant API, not the timing-out buddy/service one", () => {
  // Regression: `buddy … of service` hangs on recent macOS (AppleEvent -1712),
  // so MessageBee replies silently never delivered.
  assert.match(SEND_SCRIPT, /account whose service type = iMessage/);
  assert.match(SEND_SCRIPT, /participant targetHandle of targetAccount/);
  assert.doesNotMatch(SEND_SCRIPT, /buddy .* of targetService/);
  assert.match(SEND_SCRIPT, /with timeout of \d+ seconds/, "send is bounded");
});

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

/** Build a chat.db that opens but is missing the message schema. */
function makeSchemaFailedChatDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "mb-schema-"));
  const path = join(dir, "chat.db");
  writeFileSync(path, "");
  const db = new Database(path);
  db.exec("CREATE TABLE not_message (id INTEGER PRIMARY KEY)");
  db.close();
  return path;
}

test("probeChatDbAccess reports a missing chat database", () => {
  const dir = mkdtempSync(join(tmpdir(), "mb-missing-"));
  const path = join(dir, "chat.db");
  try {
    const probe = probeChatDbAccess(path);
    assert.equal(probe.ok, false);
    assert.equal(probe.reason, "missing");
    assert.equal(canReadChatDb(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("probeChatDbAccess reports readable chat database", () => {
  const path = makeChatDb();
  try {
    const probe = probeChatDbAccess(path);
    assert.equal(probe.ok, true);
    assert.match(probe.detail, /readable/i);
    assert.equal(canReadChatDb(path), true);
  } finally {
    rmSync(join(path, ".."), { recursive: true, force: true });
  }
});

test("probeChatDbAccess distinguishes schema failures from permission failures", () => {
  const path = makeSchemaFailedChatDb();
  try {
    const probe = probeChatDbAccess(path);
    assert.equal(probe.ok, false);
    assert.equal(probe.reason, "schema_failed");
    assert.match(probe.detail, /opened/i);
    assert.equal(canReadChatDb(path), false);
  } finally {
    rmSync(join(path, ".."), { recursive: true, force: true });
  }
});

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
