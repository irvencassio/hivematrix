import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  // so Message Lane replies silently never delivered.
  assert.match(SEND_SCRIPT, /account whose service type = iMessage/);
  assert.match(SEND_SCRIPT, /participant targetHandle of targetAccount/);
  assert.doesNotMatch(SEND_SCRIPT, /buddy .* of targetService/);
  assert.match(SEND_SCRIPT, /with timeout of \d+ seconds/, "send is bounded");
});

test("send script pins the sending account to sendAs, falling back to the 1st account", () => {
  // On a multi-account box (e.g. a dedicated agent Apple ID next to a personal
  // one), the send must come from a deterministic identity, not "1st account".
  assert.match(SEND_SCRIPT, /set sendAs to item 3 of argv/);
  assert.match(SEND_SCRIPT, /\(id of acct\) contains sendAs/, "matches an account by its id");
  assert.match(SEND_SCRIPT, /if targetAccount is missing value then/, "falls back when no match");
  // Attachments now start at item 4 (item 3 is sendAs).
  assert.match(SEND_SCRIPT, /repeat with i from 4 to \(count of argv\)/);
});

test("appleDateToIso handles seconds and nanoseconds since 2001", () => {
  // 0 seconds since 2001 epoch
  assert.equal(appleDateToIso(0), new Date(0).toISOString());
  // 631_152_000 seconds after 2001-01-01 == 2021-01-01
  assert.equal(appleDateToIso(631_152_000).slice(0, 4), "2021");
  // nanoseconds form (same instant ×1e9) resolves to the same year
  assert.equal(appleDateToIso(631_152_000 * 1e9).slice(0, 4), "2021");
});

/** Build a minimal chat.db (message + handle + attachment tables) for the reader test. */
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
    CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, filename TEXT);
    CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
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

/** Same as makeChatDb, plus a photo-only message (empty/placeholder text + one
 *  image attachment) and a captioned photo message, to exercise attachment
 *  extraction and the "don't drop a photo-only message" behavior. */
function makeChatDbWithAttachments(): string {
  const dir = mkdtempSync(join(tmpdir(), "mb-chatdb-attach-"));
  const path = join(dir, "chat.db");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY, text TEXT, is_from_me INTEGER,
      date INTEGER, handle_id INTEGER, service TEXT
    );
    CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, filename TEXT);
    CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
    INSERT INTO handle (ROWID, id) VALUES (1, '+15551234567');
    -- photo-only: text is the U+FFFC object-replacement placeholder
    INSERT INTO message (ROWID, text, is_from_me, date, handle_id, service) VALUES
      (20, '￼', 0, 631152000000000000, 1, 'iMessage'),
      (21, 'check this out', 0, 631152001000000000, 1, 'iMessage'),
      (22, 'a voice note, no image', 0, 631152002000000000, 1, 'iMessage');
    INSERT INTO attachment (ROWID, filename) VALUES
      (1, '~/Library/Messages/Attachments/aa/00/guid1/photo.heic'),
      (2, '~/Library/Messages/Attachments/bb/00/guid2/pic.jpg'),
      (3, '~/Library/Messages/Attachments/cc/00/guid3/note.caf');
    INSERT INTO message_attachment_join (message_id, attachment_id) VALUES
      (20, 1),
      (21, 2),
      (22, 3);
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

test("probeChatDbAccess open_failed detail names the daemon, not a HiveMatrix app restart", () => {
  // A directory can't be opened as a sqlite file — better-sqlite3 throws
  // synchronously in the constructor, which is exactly the open_failed path
  // (as opposed to schema_failed, which fails later at the query step).
  const dir = mkdtempSync(join(tmpdir(), "mb-open-failed-"));
  const path = join(dir, "chat.db");
  mkdirSync(path);
  try {
    const probe = probeChatDbAccess(path);
    assert.equal(probe.ok, false);
    assert.equal(probe.reason, "open_failed");
    // Names the actual daemon binary and explains the HiveMatrix app FDA
    // toggle doesn't cover it (root cause: separately-signed launchd process).
    assert.match(probe.detail, /daemon/i);
    assert.match(probe.detail, /Full Disk Access to "HiveMatrix".*does not cover/i);
    assert.doesNotMatch(probe.detail, /restart HiveMatrix/i);
    // Names the exact daemon binary path for the user to grant FDA to.
    assert.match(probe.detail, /Contents\/Resources\/daemon\/bin\/node/i);
    // Instructs to restart the daemon after granting FDA.
    assert.match(probe.detail, /restart the daemon/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("probeChatDbAccess transitions from failed to readable without cache persistence", () => {
  // Regression: FDA granted to daemon binary + daemon restart should flip
  // status to readable without the caller having to bust any cache. Each call
  // to probeChatDbAccess should re-probe live, not return a cached stale result.
  const dir = mkdtempSync(join(tmpdir(), "mb-state-change-"));
  const path = join(dir, "chat.db");
  try {
    // Initially inaccessible (directory, not a valid DB file).
    mkdirSync(path);
    let probe = probeChatDbAccess(path);
    assert.equal(probe.ok, false);
    assert.equal(probe.reason, "open_failed");

    // User grants FDA to daemon binary + daemon restarts.
    // (Simulate this by replacing the inaccessible file with a valid one.)
    rmSync(path, { recursive: true, force: true });
    const db = new Database(path);
    db.exec(`
      CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, is_from_me INTEGER, date INTEGER);
      INSERT INTO message (ROWID, text, is_from_me, date) VALUES (1, 'test', 0, 631152000000000000);
    `);
    db.close();

    // Probe again — should succeed without any cache busting needed.
    probe = probeChatDbAccess(path);
    assert.equal(probe.ok, true, "probe should succeed after valid DB is in place");
    assert.match(probe.detail, /readable/i);
    assert.equal(canReadChatDb(path), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
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

test("readInboundSince extracts image attachments and does not drop a photo-only message", () => {
  const path = makeChatDbWithAttachments();
  try {
    const { messages, maxRowid } = readInboundSince(0, 50, path);
    assert.equal(maxRowid, 22);
    assert.deepEqual(messages.map((m) => m.rowid), [20, 21, 22]);

    // Photo-only: the U+FFFC placeholder is stripped down to an empty string,
    // but the message survives (not dropped as "empty") and carries the image.
    const photoOnly = messages[0];
    assert.equal(photoOnly.text, "");
    assert.equal(photoOnly.attachments?.length, 1);
    // imessage.ts only expands the path; HEIC→JPEG conversion happens later in flash/images.ts.
    assert.match(photoOnly.attachments![0], /photo\.heic$/);
    assert.ok(!photoOnly.attachments![0].startsWith("~"), "the leading ~ is expanded to an absolute path");

    // Captioned photo: text is kept AND the image attachment is present.
    const captioned = messages[1];
    assert.equal(captioned.text, "check this out");
    assert.deepEqual(captioned.attachments, [captioned.attachments![0]]);
    assert.match(captioned.attachments![0], /pic\.jpg$/);

    // Non-image attachment (a .caf voice note) is not surfaced as an image attachment.
    const nonImage = messages[2];
    assert.equal(nonImage.text, "a voice note, no image");
    assert.deepEqual(nonImage.attachments, []);
  } finally {
    rmSync(join(path, ".."), { recursive: true, force: true });
  }
});
