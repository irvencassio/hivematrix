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
