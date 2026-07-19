/**
 * Flash Lane — DB access layer.
 *
 * Sessions are scoped per channel+peer. When a sessionId is supplied and found
 * it is resumed; otherwise the most-recent session for that channel+peer is
 * resumed (or a new one is created). console + voice share one operator session
 * when peer is "operator".
 */

import { generateId, getDb } from "@/lib/db";
import type { FlashSessionRow, FlashTurnRow } from "./types";

/**
 * Peers whose session STORAGE is unified across surface channels — currently
 * just the operator, so desktop chat ("console") and push-to-talk voice
 * ("voice") land in the same thread/row instead of two parallel sessions.
 * This is safe because per-request prompt STYLE (spoken vs text) is chosen
 * from the `channel` arg passed directly to context.ts's assembleSystemPrompt
 * on every turn, never read off the session row — see loop.ts/flash-mcp.ts
 * for how the real per-surface channel is threaded through to tool dispatch
 * (voice-origin escalation marking, learn_skill spoken-ack selection)
 * independently of this storage collapse. Widen this set if another surface
 * ever needs the same treatment; peers NOT in this set keep full
 * channel+peer scoping (e.g. birth_ritual stays its own session).
 */
const UNIFIED_SESSION_PEERS: ReadonlySet<string> = new Set(["operator"]);
export const UNIFIED_OPERATOR_CHANNEL = "operator";

function storageChannel(channel: string, peer: string): string {
  return UNIFIED_SESSION_PEERS.has(peer) ? UNIFIED_OPERATOR_CHANNEL : channel;
}

export function getOrCreateSession(
  channel: string,
  peer: string,
  sessionId?: string,
): FlashSessionRow {
  const db = getDb();
  const storedChannel = storageChannel(channel, peer);

  if (sessionId) {
    const row = db.prepare("SELECT * FROM flash_sessions WHERE id = ?").get(sessionId) as FlashSessionRow | undefined;
    if (row) {
      db.prepare("UPDATE flash_sessions SET lastActiveAt = datetime('now') WHERE id = ?").run(sessionId);
      return { ...row, lastActiveAt: new Date().toISOString() };
    }
  }

  // Resume the most-recent session for this (storage) channel+peer
  const existing = db.prepare(
    "SELECT * FROM flash_sessions WHERE channel = ? AND peer = ? ORDER BY lastActiveAt DESC LIMIT 1",
  ).get(storedChannel, peer) as FlashSessionRow | undefined;

  if (existing) {
    db.prepare("UPDATE flash_sessions SET lastActiveAt = datetime('now') WHERE id = ?").run(existing.id);
    return { ...existing, lastActiveAt: new Date().toISOString() };
  }

  const id = generateId();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO flash_sessions (id, channel, peer, summary, createdAt, lastActiveAt) VALUES (?, ?, ?, '', ?, ?)",
  ).run(id, storedChannel, peer, now, now);

  return { id, channel: storedChannel, peer, summary: "", createdAt: now, lastActiveAt: now };
}

/**
 * Always start a NEW session for this channel+peer, without resuming the most
 * recent one. Because its lastActiveAt is now, it also becomes the session that
 * a subsequent getOrCreateSession(channel, peer) call resumes — so both the
 * streamed (/flash/turn) and turn-based (/voice/turn) paths pick up the fresh
 * conversation. Used by the "New conversation" control. Subject to the same
 * storageChannel collapse as getOrCreateSession (see above).
 */
export function createSession(channel: string, peer: string): FlashSessionRow {
  const db = getDb();
  const storedChannel = storageChannel(channel, peer);
  const id = generateId();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO flash_sessions (id, channel, peer, summary, createdAt, lastActiveAt) VALUES (?, ?, ?, '', ?, ?)",
  ).run(id, storedChannel, peer, now, now);
  return { id, channel: storedChannel, peer, summary: "", createdAt: now, lastActiveAt: now };
}

/**
 * The canonical current session id for a peer — the most-recently-active
 * session at that peer's storage channel (see storageChannel). For a unified
 * peer like "operator" this is THE single shared thread regardless of which
 * surface (console/voice) is asking, letting a client hydrate on open without
 * guessing which channel created it. Returns null if the peer has never had
 * a session. `channelHint` only matters for non-unified peers (default
 * "console" — harmless since those peers pass their own real channel via
 * getOrCreateSession in practice; this is a read-only lookup, not a create).
 */
export function getCurrentSession(peer: string, channelHint = "console"): FlashSessionRow | null {
  const storedChannel = storageChannel(channelHint, peer);
  const row = getDb()
    .prepare("SELECT * FROM flash_sessions WHERE channel = ? AND peer = ? ORDER BY lastActiveAt DESC LIMIT 1")
    .get(storedChannel, peer) as FlashSessionRow | undefined;
  return row ?? null;
}

export function appendTurn(
  sessionId: string,
  role: string,
  content: string,
  toolCallsJson?: string | null,
  artifactsJson?: string | null,
): FlashTurnRow {
  const db = getDb();
  const id = generateId();
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO flash_turns (id, sessionId, role, content, toolCallsJson, artifactsJson, ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, sessionId, role, content, toolCallsJson ?? null, artifactsJson ?? null, ts);
  return { id, sessionId, role, content, toolCallsJson: toolCallsJson ?? null, artifactsJson: artifactsJson ?? null, ts };
}

export function getRecentTurns(sessionId: string, limit = 20): FlashTurnRow[] {
  return getDb()
    .prepare("SELECT * FROM flash_turns WHERE sessionId = ? ORDER BY ts DESC LIMIT ?")
    .all(sessionId, limit) as FlashTurnRow[];
}

export function getSession(sessionId: string): FlashSessionRow | null {
  return (getDb().prepare("SELECT * FROM flash_sessions WHERE id = ?").get(sessionId) as FlashSessionRow) ?? null;
}

export function listSessions(limit = 50): FlashSessionRow[] {
  return getDb()
    .prepare("SELECT * FROM flash_sessions ORDER BY lastActiveAt DESC LIMIT ?")
    .all(limit) as FlashSessionRow[];
}

export function getTurnsForSession(sessionId: string, limit = 100, sinceIso?: string): FlashTurnRow[] {
  if (sinceIso) {
    return getDb()
      .prepare("SELECT * FROM flash_turns WHERE sessionId = ? AND ts > ? ORDER BY ts ASC LIMIT ?")
      .all(sessionId, sinceIso, limit) as FlashTurnRow[];
  }
  // Secondary `rowid` tiebreaker (ASC/DESC matching each half's primary `ts`
  // direction) makes ordering deterministic when two turns share the same
  // millisecond-resolution `ts` — e.g. back-to-back appends in a tight loop —
  // so the newest-page query can't silently reverse tied rows relative to
  // their true insertion order. `rowid` is selected only inside the derived
  // table (as `_rid`) purely to sort by; the outer SELECT lists the real
  // FlashTurnRow columns explicitly so `_rid` never leaks into the result.
  return getDb()
    .prepare(
      "SELECT id, sessionId, role, content, toolCallsJson, artifactsJson, ts FROM " +
        "(SELECT *, rowid AS _rid FROM flash_turns WHERE sessionId = ? ORDER BY ts DESC, rowid DESC LIMIT ?) " +
        "ORDER BY ts ASC, _rid ASC",
    )
    .all(sessionId, limit) as FlashTurnRow[];
}

export function updateSessionSummary(sessionId: string, summary: string): void {
  getDb()
    .prepare("UPDATE flash_sessions SET summary = ?, lastActiveAt = datetime('now') WHERE id = ?")
    .run(summary, sessionId);
}

/**
 * Return sessions that are distillable and have been inactive longer than
 * `olderThanMs` milliseconds. Distillable = never distilled OR active again
 * since the last distillation — sessions are everlasting (one per
 * channel+peer), so a plain "distilledAt IS NULL" would make learning a
 * once-per-lifetime event; the re-distill condition keeps operator modeling
 * continuous. Used by the learning loop scheduler.
 */
export function getColdSessions(olderThanMs: number): FlashSessionRow[] {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  return getDb()
    .prepare(
      "SELECT * FROM flash_sessions WHERE (distilledAt IS NULL OR lastActiveAt > distilledAt) AND lastActiveAt < ? ORDER BY lastActiveAt ASC",
    )
    .all(cutoff) as FlashSessionRow[];
}

/** Keep only the newest `keep` turns of a session (heartbeat sessions never go idle and would otherwise grow forever). */
export function pruneSessionTurns(sessionId: string, keep: number): number {
  const result = getDb()
    .prepare(
      "DELETE FROM flash_turns WHERE sessionId = ? AND id NOT IN (SELECT id FROM flash_turns WHERE sessionId = ? ORDER BY ts DESC LIMIT ?)",
    )
    .run(sessionId, sessionId, keep);
  return result.changes;
}

/** Mark a session as distilled so the scheduler skips it on future passes. */
export function markSessionDistilled(sessionId: string, distilledAt?: string): void {
  getDb()
    .prepare("UPDATE flash_sessions SET distilledAt = ? WHERE id = ?")
    .run(distilledAt ?? new Date().toISOString(), sessionId);
}

/** The `claude` CLI's own session id for this flash session, or null if none is stored yet
 *  (first turn, or a stale one was cleared after a failed `--resume`). */
export function getFlashCliSessionId(sessionId: string): string | null {
  const row = getDb()
    .prepare("SELECT cliSessionId FROM flash_sessions WHERE id = ?")
    .get(sessionId) as { cliSessionId: string | null } | undefined;
  return row?.cliSessionId ?? null;
}

/** Persist the CLI session id captured from this turn's stream-json `session` event. */
export function setFlashCliSessionId(sessionId: string, cliSessionId: string): void {
  getDb().prepare("UPDATE flash_sessions SET cliSessionId = ? WHERE id = ?").run(cliSessionId, sessionId);
}

/** Drop a stale/expired CLI session id so the next turn falls back to full-history serialization. */
export function clearFlashCliSessionId(sessionId: string): void {
  getDb().prepare("UPDATE flash_sessions SET cliSessionId = NULL WHERE id = ?").run(sessionId);
}

/**
 * Record how full the context window was on this session's last completed turn.
 *
 * Deliberately does NOT touch lastActiveAt: this is an observation about a turn
 * that already happened, and bumping activity here would keep an idle session
 * looking warm and starve the learning loop's cold-session sweep
 * (getColdSessions above).
 */
export function setSessionContextTokens(sessionId: string, tokens: number, model: string | null): void {
  getDb()
    .prepare("UPDATE flash_sessions SET contextTokens = ?, contextModel = ? WHERE id = ?")
    .run(tokens, model, sessionId);
}

export function appendFeedbackToTurn(turnId: string, rating: "good" | "bad"): FlashTurnRow {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flash_turns WHERE id = ?").get(turnId) as FlashTurnRow | undefined;
  if (!row) throw new Error(`Flash turn ${turnId} not found`);

  const current = row.artifactsJson ? (JSON.parse(row.artifactsJson) as Record<string, unknown>) : {};
  current.feedback = rating;
  current.feedbackAt = new Date().toISOString();
  const updated = JSON.stringify(current);

  db.prepare("UPDATE flash_turns SET artifactsJson = ? WHERE id = ?").run(updated, turnId);
  return { ...row, artifactsJson: updated };
}
