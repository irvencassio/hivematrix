import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = mkdtempSync(join(tmpdir(), "hm-mbstore-test-"));
process.env.HIVEMATRIX_DB_PATH = join(TMP, "test.db");

const { getDb, _resetDbForTests } = await import("@/lib/db");
const store = await import("./store");

_resetDbForTests();
getDb();

test.after(() => {
  _resetDbForTests();
  delete process.env.HIVEMATRIX_DB_PATH;
  rmSync(TMP, { recursive: true, force: true });
});

test("done-notify dedup: a result is only texted back once per run key", () => {
  const key = "task1:2026-06-13T00:00:00Z";
  assert.equal(store.wasDoneNotified(key), false);
  store.markDoneNotified(key);
  assert.equal(store.wasDoneNotified(key), true);
  // A different run (new updatedAt) is a distinct key → re-notifies.
  assert.equal(store.wasDoneNotified("task1:2026-06-13T01:00:00Z"), false);
});

test("self handles: loop-guard matches the agent's own identities both ways", () => {
  assert.deepEqual(store.getSelfHandles(), [], "empty by default");
  assert.equal(store.isSelf("+15136595163"), false, "nothing is self until configured");

  // Store raw/formatted forms; they normalize on write.
  store.setSelfHandles(["+1 (513) 659-5163", "Cassio.Irv@gmail.com", ""]);
  const self = store.getSelfHandles();
  assert.equal(self.length, 2, "empty entry dropped, both kept");

  // Phone matches by last-10 regardless of formatting/country code; email exact.
  assert.equal(store.isSelf("5136595163"), true, "phone matches by last-10");
  assert.equal(store.isSelf("+15136595163"), true, "e.164 phone matches");
  assert.equal(store.isSelf("cassio.irv@gmail.com"), true, "email matches case-insensitively");
  assert.equal(store.isSelf("+15550001111"), false, "an unrelated number is not self");

  store.setSelfHandles([]); // reset so later tests see a clean slate
  assert.equal(store.isSelf("5136595163"), false);
});

test("ignored senders: recorded, deduped by address (latest wins), clearable", () => {
  store.recordIgnoredSender("you@icloud.com", "what is the weather", "2026-06-13T00:00:00Z");
  store.recordIgnoredSender("+15551234567", "hi", "2026-06-13T00:01:00Z");
  store.recordIgnoredSender("you@icloud.com", "actually, what time is it", "2026-06-13T00:02:00Z");
  const list = store.listIgnoredSenders();
  assert.equal(list.length, 2, "deduped by address");
  assert.equal(list[0].address, "you@icloud.com", "latest moved to front");
  assert.equal(list[0].text, "actually, what time is it", "keeps the newest message");
  store.clearIgnoredSender("you@icloud.com");
  const after = store.listIgnoredSenders();
  assert.equal(after.length, 1);
  assert.equal(after[0].address, "+15551234567");
});

test("blocked identities match the blocklist without becoming allowlisted", () => {
  store.upsertIdentity("+1 (408) 396-7431", "blocked");
  assert.equal(store.isBlocked("+14083967431"), true, "blocked phone matches by normalized form");
  assert.equal(store.isAllowed("+14083967431"), false, "blocked phone is not allowlisted");

  store.upsertIdentity("+14083967431", "allowed");
  assert.equal(store.isBlocked("4083967431"), false, "status changes remove block behavior");
  assert.equal(store.isAllowed("4083967431"), true, "same identity can be allowed later");
});

test("resetLastRowid: resets high-water mark to currentMaxRowid to guard against backlog replay after restore", async () => {
  const { currentMaxRowid } = await import("./imessage");

  // Simulate pre-update state: identities are allowed and lastRowid is tracked.
  store.upsertIdentity("+15551234567", "allowed", "Alice");
  store.setLastRowid(12345);
  assert.equal(store.getLastRowid(), 12345, "lastRowid set to 12345");
  assert.equal(store.isAllowed("+15551234567"), true, "identity is allowed");

  // Simulate post-restore: identities have been healed but we need to reset the
  // high-water mark to prevent replaying old messages from freshly-restored senders.
  // The high-water mark should be set to currentMaxRowid() so the poller (readInboundSince
  // with WHERE m.ROWID > since) treats only messages arriving AFTER the heal as new.
  store.resetLastRowid();
  const expected = currentMaxRowid();
  assert.equal(store.getLastRowid(), expected, `high-water mark reset to currentMaxRowid (${expected})`);
  assert.equal(store.isAllowed("+15551234567"), true, "identities still present and allowed");
});

test("self-handles persist in ChannelMeta across message_channels table state changes", () => {
  // Set up self-handles in the channel metadata.
  store.setSelfHandles(["+15136595163", "cassio@example.com"]);
  let handles = store.getSelfHandles();
  assert.equal(handles.length, 2, "self-handles set");

  // Simulate message_channels table being recreated (e.g., by a migration).
  // The metadata should still contain the self-handles.
  const db = getDb();
  const channelRow = db.prepare("SELECT _id, metadata FROM message_channels WHERE channel = 'imessage'").get() as
    | { _id: string; metadata: string }
    | undefined;
  assert(channelRow, "channel row exists");
  const meta = JSON.parse(channelRow.metadata) as { selfHandles?: string[] };
  assert.deepEqual(meta.selfHandles, handles, "self-handles persisted in metadata JSON");

  // Verify the handles are still readable via the API.
  handles = store.getSelfHandles();
  assert.equal(handles.length, 2);
  assert.equal(store.isSelf("+15136595163"), true);
  assert.equal(store.isSelf("cassio@example.com"), true);
});

test("poller-level regression: no historical messages routed after message_identities self-heal", async () => {
  const { readInboundSince, currentMaxRowid: getMaxRowid } = await import("./imessage");
  const Database = (await import("better-sqlite3")).default;
  const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  // Create a temporary chat.db with test messages.
  const dir = mkdtempSync(join(tmpdir(), "mb-heal-test-"));
  const chatPath = join(dir, "chat.db");
  try {
    const db = new Database(chatPath);
    db.exec(`
      CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
      CREATE TABLE message (
        ROWID INTEGER PRIMARY KEY, text TEXT, is_from_me INTEGER,
        date INTEGER, handle_id INTEGER, service TEXT
      );
      CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, filename TEXT);
      CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
      INSERT INTO handle (ROWID, id) VALUES (1, '+15551234567');
      INSERT INTO message (ROWID, text, is_from_me, date, handle_id, service) VALUES
        (10, 'old message before heal', 0, 631152000000000000, 1, 'iMessage'),
        (20, 'new message after heal', 0, 631152010000000000, 1, 'iMessage');
    `);
    db.close();

    // Before heal: lastRowid is old (e.g., from a prior session)
    store.setLastRowid(5);
    assert.equal(store.getLastRowid(), 5, "lastRowid set to old value (5)");

    // Simulate heal: identities restored, reset the high-water mark.
    // Point resetLastRowid at the temp chat.db (prod reads the real Messages DB).
    store.resetLastRowid(chatPath);
    const afterHealRowid = store.getLastRowid();
    const maxRowid = getMaxRowid(chatPath);
    assert.equal(afterHealRowid, maxRowid, `after heal, lastRowid equals currentMaxRowid (${maxRowid})`);

    // Poller uses lastRowid as the cutoff: readInboundSince(lastRowid)
    // should NOT return historical messages (ROWID <= maxRowid at heal time).
    // Since maxRowid is 20 after heal, readInboundSince(20) should return only
    // messages with ROWID > 20, i.e., nothing (the heal happened at max, so no new arrivals yet).
    const { messages } = readInboundSince(afterHealRowid, 50, chatPath);
    assert.deepEqual(messages, [], "poller returns no historical messages after heal (afterHealRowid = maxRowid)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
