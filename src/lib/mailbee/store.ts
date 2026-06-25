/**
 * Mail Lane state over the v5 messaging tables (channel = "email"). Mirrors the
 * Message Lane store: one channel row (enable/status + metadata high-water by Mail
 * message id) and identities as the trusted-sender allowlist. Plus a
 * config-driven trusted-domains list for the authenticatedDomain trust hint.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getDb, generateId } from "@/lib/db";
import { emailDomain } from "./contracts";

const CHANNEL = "email";

interface ChannelRow { _id: string; enabled: number; status: string; metadata: string }

interface Meta { lastId: number }

function readMeta(row: ChannelRow | undefined): Meta {
  if (!row) return { lastId: 0 };
  try { return { lastId: (JSON.parse(row.metadata)?.lastId as number) ?? 0 }; } catch { return { lastId: 0 }; }
}

function getRow(): ChannelRow | undefined {
  return getDb().prepare("SELECT * FROM message_channels WHERE channel = ?").get(CHANNEL) as ChannelRow | undefined;
}

export function ensureChannel(): ChannelRow {
  const existing = getRow();
  if (existing) return existing;
  getDb().prepare(
    `INSERT INTO message_channels (_id, channel, enabled, transport, status, metadata)
     VALUES (?, ?, 0, 'applemail+osascript', 'off', '{"lastId":0}')`,
  ).run(generateId(), CHANNEL);
  return getRow()!;
}

export function isChannelEnabled(): boolean { return (getRow()?.enabled ?? 0) === 1; }

export function setChannelEnabled(enabled: boolean): void {
  ensureChannel();
  getDb().prepare("UPDATE message_channels SET enabled = ?, status = ?, updatedAt = datetime('now') WHERE channel = ?")
    .run(enabled ? 1 : 0, enabled ? "running" : "off", CHANNEL);
}

export function getLastId(): number { return readMeta(getRow()).lastId; }

export function setLastId(id: number): void {
  ensureChannel();
  getDb().prepare("UPDATE message_channels SET metadata = ?, updatedAt = datetime('now') WHERE channel = ?")
    .run(JSON.stringify({ lastId: id }), CHANNEL);
}

export function recordInbound(): void {
  getDb().prepare("UPDATE message_channels SET lastInboundAt = datetime('now') WHERE channel = ?").run(CHANNEL);
}
export function recordError(message: string): void {
  getDb().prepare("UPDATE message_channels SET lastError = ?, updatedAt = datetime('now') WHERE channel = ?")
    .run(message.slice(0, 500), CHANNEL);
}

// ── trusted-sender allowlist ─────────────────────────────────────────────────

const ALLOWED = ["allowed", "paired"];

export interface MailIdentity { address: string; displayName: string | null; status: string }

export function listIdentities(): MailIdentity[] {
  const rows = getDb().prepare(
    "SELECT address, displayName, status FROM message_identities WHERE channel = ? ORDER BY address",
  ).all(CHANNEL) as Array<{ address: string; displayName: string | null; status: string }>;
  return rows.map((r) => ({ address: r.address, displayName: r.displayName, status: r.status }));
}

/** Known/trusted sender (on the allowlist)? Email match is exact (lowercased). */
export function isKnownSender(address: string): boolean {
  const a = address.trim().toLowerCase();
  return listIdentities().filter((i) => ALLOWED.includes(i.status)).some((i) => i.address === a);
}

export function upsertIdentity(address: string, status: string, displayName?: string | null): void {
  const norm = address.trim().toLowerCase();
  if (!norm) return;
  const db = getDb();
  const existing = db.prepare("SELECT _id FROM message_identities WHERE channel = ? AND address = ?")
    .get(CHANNEL, norm) as { _id: string } | undefined;
  if (existing) {
    db.prepare("UPDATE message_identities SET status = ?, displayName = COALESCE(?, displayName), updatedAt = datetime('now') WHERE _id = ?")
      .run(status, displayName ?? null, existing._id);
  } else {
    db.prepare(
      `INSERT INTO message_identities (_id, channel, address, displayName, status, pairedAt)
       VALUES (?, ?, ?, ?, ?, CASE WHEN ? IN ('allowed','paired') THEN datetime('now') ELSE NULL END)`,
    ).run(generateId(), CHANNEL, norm, displayName ?? null, status, status);
  }
}

/** Configured trusted domains (config.mailbee.trustedDomains) for the authenticatedDomain hint. */
export function trustedDomains(): string[] {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const d = cfg?.mailbee?.trustedDomains;
    return Array.isArray(d) ? d.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : [];
  } catch { return []; }
}

export function isAuthenticatedDomain(address: string): boolean {
  const dom = emailDomain(address);
  return dom.length > 0 && trustedDomains().includes(dom);
}

/** Whether to create triage tasks for non-allowlisted senders (config.mailbee.triageAll). */
export function triageAll(): boolean {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    return cfg?.mailbee?.triageAll === true;
  } catch { return false; }
}
