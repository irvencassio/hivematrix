import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate HOME so the DB is a fresh temp instance, never the developer's
// real ~/.hivematrix/hivematrix.db.
const TMP = mkdtempSync(join(tmpdir(), "hm-flash-store-test-"));
process.env.HOME = TMP;

const { createSession, getOrCreateSession, getCurrentSession, getFlashCliSessionId, setFlashCliSessionId, clearFlashCliSessionId } = await import("./store");

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
