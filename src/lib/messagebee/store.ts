/**
 * Message Lane state over the v5 messaging tables (message_channels,
 * message_identities). One channel row ("imessage") holds enable/status + a
 * metadata blob with the read high-water mark and the set of needs_input
 * prompts already texted out. Identities are the sender allowlist.
 */

import { getDb, generateId } from "@/lib/db";
import { handlesMatch, normalizeHandle } from "./contracts";
import { isFeaturePermitted } from "@/lib/license/gates";

const CHANNEL = "imessage";

export type IdentityStatus = "pending" | "allowed" | "paired" | "blocked";

export interface IgnoredSender {
  address: string;
  text: string;
  at: string;
}

export interface ChannelMeta {
  lastRowid: number;
  notifiedStuck: string[]; // "taskId:timestamp" keys already sent to the sender
  notifiedDone: string[];  // "taskId:updatedAt" keys whose RESULT was texted back
  recentIgnored: IgnoredSender[]; // non-allowlisted senders, for one-click allow
  // The agent's OWN iMessage handles on this box (email + phone). When the daemon
  // runs on the same Apple ID a human also uses, sending to one of these creates a
  // Note-to-Self: the send lands as is_from_me=1 AND echoes back as is_from_me=0,
  // which the is_from_me=0 inbound filter does NOT catch. Reading that echo as a
  // fresh operator message would loop forever. selfHandles gates both directions:
  // never route inbound that matches self, never send outbound to self.
  selfHandles: string[];
}

export interface MessageIdentity {
  address: string;
  displayName: string | null;
  status: IdentityStatus;
}

interface ChannelRow {
  _id: string;
  enabled: number;
  status: string;
  metadata: string;
}

function readMeta(row: ChannelRow | undefined): ChannelMeta {
  const empty: ChannelMeta = { lastRowid: 0, notifiedStuck: [], notifiedDone: [], recentIgnored: [], selfHandles: [] };
  if (!row) return empty;
  try {
    const m = JSON.parse(row.metadata) as Partial<ChannelMeta>;
    return {
      lastRowid: m.lastRowid ?? 0,
      notifiedStuck: m.notifiedStuck ?? [],
      notifiedDone: m.notifiedDone ?? [],
      recentIgnored: m.recentIgnored ?? [],
      selfHandles: m.selfHandles ?? [],
    };
  } catch {
    return empty;
  }
}

function getRow(): ChannelRow | undefined {
  return getDb().prepare("SELECT * FROM message_channels WHERE channel = ?").get(CHANNEL) as ChannelRow | undefined;
}

/** Create the imessage channel row if absent. Returns it. */
export function ensureChannel(): ChannelRow {
  const existing = getRow();
  if (existing) return existing;
  getDb().prepare(
    `INSERT INTO message_channels (_id, channel, enabled, transport, status, metadata)
     VALUES (?, ?, 0, 'chatdb+osascript', 'off', '{"lastRowid":0,"notifiedStuck":[]}')`,
  ).run(generateId(), CHANNEL);
  return getRow()!;
}

export function isChannelEnabled(): boolean {
  return (getRow()?.enabled ?? 0) === 1 && isFeaturePermitted("channel_message");
}

export function setChannelEnabled(enabled: boolean, status = enabled ? "running" : "off"): void {
  ensureChannel();
  getDb().prepare(
    "UPDATE message_channels SET enabled = ?, status = ?, updatedAt = datetime('now') WHERE channel = ?",
  ).run(enabled ? 1 : 0, status, CHANNEL);
}

function writeMeta(meta: ChannelMeta): void {
  getDb().prepare(
    "UPDATE message_channels SET metadata = ?, updatedAt = datetime('now') WHERE channel = ?",
  ).run(JSON.stringify(meta), CHANNEL);
}

export function getLastRowid(): number {
  return readMeta(getRow()).lastRowid;
}

export function setLastRowid(rowid: number): void {
  ensureChannel();
  const meta = readMeta(getRow());
  meta.lastRowid = rowid;
  writeMeta(meta);
}

export function recordInbound(): void {
  getDb().prepare("UPDATE message_channels SET lastInboundAt = datetime('now') WHERE channel = ?").run(CHANNEL);
}

export function recordOutbound(): void {
  getDb().prepare("UPDATE message_channels SET lastOutboundAt = datetime('now') WHERE channel = ?").run(CHANNEL);
}

export function recordError(message: string): void {
  getDb().prepare("UPDATE message_channels SET lastError = ?, updatedAt = datetime('now') WHERE channel = ?")
    .run(message.slice(0, 500), CHANNEL);
}

// ── needs_input notify de-dup ────────────────────────────────────────────────

export function wasStuckNotified(key: string): boolean {
  return readMeta(getRow()).notifiedStuck.includes(key);
}

export function markStuckNotified(key: string): void {
  ensureChannel();
  const meta = readMeta(getRow());
  if (!meta.notifiedStuck.includes(key)) {
    meta.notifiedStuck.push(key);
    // bound the set so metadata can't grow without limit
    if (meta.notifiedStuck.length > 500) meta.notifiedStuck = meta.notifiedStuck.slice(-500);
    writeMeta(meta);
  }
}

// ── completed-result notify de-dup (text the answer back once per run) ────────

export function wasDoneNotified(key: string): boolean {
  return readMeta(getRow()).notifiedDone.includes(key);
}

export function markDoneNotified(key: string): void {
  ensureChannel();
  const meta = readMeta(getRow());
  if (!meta.notifiedDone.includes(key)) {
    meta.notifiedDone.push(key);
    if (meta.notifiedDone.length > 500) meta.notifiedDone = meta.notifiedDone.slice(-500);
    writeMeta(meta);
  }
}

// ── recently-ignored (non-allowlisted) senders, for one-click allow ───────────

export function recordIgnoredSender(address: string, text: string, at = new Date().toISOString()): void {
  ensureChannel();
  const meta = readMeta(getRow());
  // De-dup by address: keep the latest message, move to front.
  meta.recentIgnored = meta.recentIgnored.filter((i) => i.address !== address);
  meta.recentIgnored.unshift({ address, text: text.slice(0, 120), at });
  if (meta.recentIgnored.length > 20) meta.recentIgnored = meta.recentIgnored.slice(0, 20);
  writeMeta(meta);
}

export function listIgnoredSenders(): IgnoredSender[] {
  return readMeta(getRow()).recentIgnored;
}

export function clearIgnoredSender(address: string): void {
  ensureChannel();
  const meta = readMeta(getRow());
  meta.recentIgnored = meta.recentIgnored.filter((i) => i.address !== address);
  writeMeta(meta);
}

// ── self handles (the agent's own iMessage identities) ───────────────────────

/** The agent's own handles on this box. Sending to any of these self-echoes and
 *  loops (see ChannelMeta.selfHandles). */
export function getSelfHandles(): string[] {
  return readMeta(getRow()).selfHandles;
}

/** Replace the self-handle set (normalized, de-duped). Empty entries dropped. */
export function setSelfHandles(handles: string[]): void {
  ensureChannel();
  const meta = readMeta(getRow());
  const norm = handles.map((h) => normalizeHandle(h)).filter(Boolean);
  meta.selfHandles = [...new Set(norm)];
  writeMeta(meta);
}

/** Whether a handle is one of the agent's own identities (loop-guard both ways). */
export function isSelf(handle: string): boolean {
  const self = readMeta(getRow()).selfHandles;
  return self.some((s) => handlesMatch(s, handle));
}

// ── sender allowlist (identities) ────────────────────────────────────────────

const ALLOWED_STATUSES: IdentityStatus[] = ["allowed", "paired"];
const BLOCKED_STATUSES: IdentityStatus[] = ["blocked"];

export function listIdentities(): MessageIdentity[] {
  const rows = getDb().prepare(
    "SELECT address, displayName, status FROM message_identities WHERE channel = ? ORDER BY address",
  ).all(CHANNEL) as Array<{ address: string; displayName: string | null; status: string }>;
  return rows.map((r) => ({ address: r.address, displayName: r.displayName, status: r.status as IdentityStatus }));
}

/** Whether a raw inbound handle is allowlisted (matches a paired/allowed identity). */
export function isAllowed(handle: string): boolean {
  return listIdentities()
    .filter((i) => ALLOWED_STATUSES.includes(i.status))
    .some((i) => handlesMatch(i.address, handle));
}

/** Whether a raw inbound handle is blocked from surfacing in setup prompts. */
export function isBlocked(handle: string): boolean {
  return listIdentities()
    .filter((i) => BLOCKED_STATUSES.includes(i.status))
    .some((i) => handlesMatch(i.address, handle));
}

/** Upsert an identity (keyed by normalized address). */
export function upsertIdentity(address: string, status: IdentityStatus, displayName?: string | null): void {
  const norm = normalizeHandle(address);
  if (!norm) return;
  const db = getDb();
  const existing = db.prepare(
    "SELECT _id FROM message_identities WHERE channel = ? AND address = ?",
  ).get(CHANNEL, norm) as { _id: string } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE message_identities SET status = ?, displayName = COALESCE(?, displayName), updatedAt = datetime('now') WHERE _id = ?",
    ).run(status, displayName ?? null, existing._id);
  } else {
    db.prepare(
      `INSERT INTO message_identities (_id, channel, address, displayName, status, pairedAt)
       VALUES (?, ?, ?, ?, ?, CASE WHEN ? IN ('allowed','paired') THEN datetime('now') ELSE NULL END)`,
    ).run(generateId(), CHANNEL, norm, displayName ?? null, status, status);
  }
}
