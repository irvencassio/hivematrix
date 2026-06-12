/**
 * MessageBee state over the v5 messaging tables (message_channels,
 * message_identities). One channel row ("imessage") holds enable/status + a
 * metadata blob with the read high-water mark and the set of needs_input
 * prompts already texted out. Identities are the sender allowlist.
 */

import { getDb, generateId } from "@/lib/db";
import { handlesMatch, normalizeHandle } from "./contracts";

const CHANNEL = "imessage";

export type IdentityStatus = "pending" | "allowed" | "paired" | "blocked";

export interface ChannelMeta {
  lastRowid: number;
  notifiedStuck: string[]; // "taskId:timestamp" keys already sent to the sender
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
  if (!row) return { lastRowid: 0, notifiedStuck: [] };
  try {
    const m = JSON.parse(row.metadata) as Partial<ChannelMeta>;
    return { lastRowid: m.lastRowid ?? 0, notifiedStuck: m.notifiedStuck ?? [] };
  } catch {
    return { lastRowid: 0, notifiedStuck: [] };
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
  return (getRow()?.enabled ?? 0) === 1;
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

// ── sender allowlist (identities) ────────────────────────────────────────────

const ALLOWED_STATUSES: IdentityStatus[] = ["allowed", "paired"];

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
