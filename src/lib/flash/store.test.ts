import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate HOME so the DB is a fresh temp instance, never the developer's
// real ~/.hivematrix/hivematrix.db.
const TMP = mkdtempSync(join(tmpdir(), "hm-flash-store-test-"));
process.env.HOME = TMP;

const { createSession, getFlashCliSessionId, setFlashCliSessionId, clearFlashCliSessionId } = await import("./store");

test.after(() => rmSync(TMP, { recursive: true, force: true }));

test("cliSessionId: a fresh session has no CLI session id on file", () => {
  const session = createSession("console", "cli-session-test-fresh");
  assert.equal(getFlashCliSessionId(session.id), null);
});

test("cliSessionId: set persists the value and get round-trips it", () => {
  const session = createSession("console", "cli-session-test-roundtrip");
  setFlashCliSessionId(session.id, "cli-abc-123");
  assert.equal(getFlashCliSessionId(session.id), "cli-abc-123");
});

test("cliSessionId: set again overwrites the previous value (store the latest)", () => {
  const session = createSession("console", "cli-session-test-overwrite");
  setFlashCliSessionId(session.id, "cli-first");
  setFlashCliSessionId(session.id, "cli-second");
  assert.equal(getFlashCliSessionId(session.id), "cli-second");
});

test("cliSessionId: clear drops it back to null", () => {
  const session = createSession("console", "cli-session-test-clear");
  setFlashCliSessionId(session.id, "cli-to-clear");
  clearFlashCliSessionId(session.id);
  assert.equal(getFlashCliSessionId(session.id), null);
});

test("cliSessionId: get/set/clear on an unknown session id are no-ops, not errors", () => {
  assert.equal(getFlashCliSessionId("does-not-exist"), null);
  assert.doesNotThrow(() => setFlashCliSessionId("does-not-exist", "cli-x"));
  assert.doesNotThrow(() => clearFlashCliSessionId("does-not-exist"));
});
