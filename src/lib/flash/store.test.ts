import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate HOME so the DB is a fresh temp instance, never the developer's
// real ~/.hivematrix/hivematrix.db.
const TMP = mkdtempSync(join(tmpdir(), "hm-flash-store-test-"));
process.env.HOME = TMP;

const { createSession, getOrCreateSession, getCurrentSession, getFlashCliSessionId, setFlashCliSessionId, clearFlashCliSessionId, appendTurn, getTurnsForSession } = await import("./store");
const { getDb } = await import("@/lib/db");

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

// ---------------------------------------------------------------------------
// Unified operator session — console + voice (any channel) share ONE session
// row when peer is "operator"; other peers keep full channel+peer scoping.
// ---------------------------------------------------------------------------

test("getOrCreateSession: a console turn and a voice turn for peer 'operator' land in the SAME session row", () => {
  const consoleSession = getOrCreateSession("console", "operator");
  const voiceSession = getOrCreateSession("voice", "operator");
  assert.equal(voiceSession.id, consoleSession.id);
  // The stored channel is the unified constant, not either surface's literal name.
  assert.equal(consoleSession.channel, "operator");
  assert.equal(voiceSession.channel, "operator");
});

test("getOrCreateSession: unification is keyed on peer, not channel — a different peer stays fully separate", () => {
  const operatorConsole = getOrCreateSession("console", "operator");
  const otherPeerConsole = getOrCreateSession("console", "birth_ritual");
  const otherPeerVoice = getOrCreateSession("voice", "birth_ritual");
  assert.notEqual(otherPeerConsole.id, operatorConsole.id);
  // Non-unified peers keep per-channel scoping — console and voice differ.
  assert.notEqual(otherPeerVoice.id, otherPeerConsole.id);
  assert.equal(otherPeerConsole.channel, "console");
  assert.equal(otherPeerVoice.channel, "voice");
});

test("createSession: 'New conversation' for voice/operator also lands in the unified operator channel", () => {
  const fresh = createSession("voice", "operator");
  assert.equal(fresh.channel, "operator");
  // And a subsequent console getOrCreateSession resumes that same fresh session.
  const resumed = getOrCreateSession("console", "operator");
  assert.equal(resumed.id, fresh.id);
});

test("getCurrentSession: returns the canonical operator session id regardless of channel hint", () => {
  const created = getOrCreateSession("voice", "operator");
  assert.equal(getCurrentSession("operator", "console")?.id, created.id);
  assert.equal(getCurrentSession("operator", "voice")?.id, created.id);
});

test("getCurrentSession: returns null for a peer that has never had a session", () => {
  assert.equal(getCurrentSession("never-seen-peer"), null);
});

// ---------------------------------------------------------------------------
// getTurnsForSession: the no-sinceIso page must be the NEWEST `limit` turns,
// in ascending (chronological) order — not the oldest `limit` turns.
// ---------------------------------------------------------------------------

test("getTurnsForSession: with no sinceIso, returns the newest `limit` turns in ascending order (not the oldest)", () => {
  const session = createSession("console", "history-truncation-test");
  const db = getDb();

  // Insert 105 turns, then force each row's `ts` to a distinct, deterministic,
  // strictly increasing value — appendTurn's real-clock timestamps aren't
  // reliably distinct at millisecond resolution in a tight synchronous loop,
  // so set them explicitly instead of relying on wall-clock timing.
  const total = 105;
  for (let i = 0; i < total; i++) {
    const turn = appendTurn(session.id, "user", `turn-${i}`);
    const ts = new Date(2026, 0, 1, 0, 0, i).toISOString(); // 2026-01-01T00:00:0i.000Z
    db.prepare("UPDATE flash_turns SET ts = ? WHERE id = ?").run(ts, turn.id);
  }

  const page = getTurnsForSession(session.id, 100);

  assert.equal(page.length, 100);
  // Newest 100 of 105 means turn-5 .. turn-104 survive; turn-0..turn-4 are dropped.
  assert.equal(page[0].content, "turn-5");
  assert.equal(page[page.length - 1].content, "turn-104");
  // Ascending order: every ts strictly increases across the returned page.
  for (let i = 1; i < page.length; i++) {
    assert.ok(page[i].ts > page[i - 1].ts, `expected ts to increase at index ${i}`);
  }
});

test("getTurnsForSession: with fewer than `limit` turns, returns all of them in ascending order (unchanged behavior)", () => {
  const session = createSession("console", "history-truncation-small-test");
  appendTurn(session.id, "user", "first");
  appendTurn(session.id, "assistant", "second");
  appendTurn(session.id, "user", "third");

  const page = getTurnsForSession(session.id, 100);

  assert.equal(page.length, 3);
  assert.deepEqual(page.map((t) => t.content), ["first", "second", "third"]);
});
