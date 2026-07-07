import { generateId, getDb } from "@/lib/db";
import { laneDisplayName } from "@/lib/lanes/contracts";
import {
  normalizeTerminalProfile,
  normalizeTerminalReadinessState,
  terminalAuthCapability,
  type TerminalAuthMethod,
  type TerminalProfile,
  type TerminalReadinessColor,
  type TerminalReadinessStatus,
} from "./contracts";

interface TerminalProfileRow {
  _id: string;
  displayName: string;
  kind: TerminalProfile["kind"];
  authMethod: TerminalAuthMethod | null;
  host: string | null;
  user: string | null;
  port: number | null;
  shell: string | null;
  cwd: string | null;
  keyPath: string | null;
  credentialRef: string | null;
  openCommand: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface TerminalProbeRow {
  _id: string;
  profileId: string;
  name: string;
  command: string | null;
  enabled: number;
}

interface LatestRunRow {
  _id: string;
  profileId: string;
  probeId: string | null;
  status: TerminalReadinessStatus;
  color: TerminalReadinessColor;
  summary: string;
  startedAt: string;
  completedAt: string | null;
  metadata: string;
}

interface AuditRow {
  _id: string;
  profileId: string | null;
  sessionId: string | null;
  event: string;
  command: string | null;
  metadata: string;
  createdAt: string;
}

export interface TerminalReadinessProbe {
  id: string;
  profileId: string;
  name: string;
  command: string | null;
}

export interface TerminalReadinessRunRecord {
  id: string;
  profileId: string;
  probeId: string | null;
  status: TerminalReadinessStatus;
  color: TerminalReadinessColor;
  summary: string;
}

export interface TerminalReadinessRunInput {
  profileId: string;
  probeId?: string | null;
  status: TerminalReadinessStatus;
  color?: TerminalReadinessColor;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface TerminalProfileSummary {
  id: string;
  displayName: string;
  kind: TerminalProfile["kind"];
  authMethod: TerminalAuthMethod;
  host: string | null;
  user: string | null;
  port: number | null;
  shell: string | null;
  cwd: string | null;
  keyPath: string | null;
  credentialRef: string | null;
  /** Whether a Keychain credential reference is attached — never the secret value. */
  credentialPresent: boolean;
  /** Honest auto-connectability (password_keychain is false until a native runtime lands). */
  autoConnect: boolean;
  openCommand: string;
  status: string;
  probeCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TerminalSessionAuditEntry {
  id: string;
  profileId: string | null;
  sessionId: string | null;
  event: string;
  command: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function upsertTerminalProfile(input: unknown): TerminalProfile {
  const profile = normalizeTerminalProfile(input);
  // createdAt is intentionally NOT in the UPDATE set, so it is preserved across
  // edits; only updatedAt is bumped.
  getDb().prepare(`
    INSERT INTO terminal_profiles (_id, displayName, kind, authMethod, host, user, port, shell, cwd, keyPath, credentialRef, openCommand, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(_id) DO UPDATE SET
      displayName = excluded.displayName,
      kind = excluded.kind,
      authMethod = excluded.authMethod,
      host = excluded.host,
      user = excluded.user,
      port = excluded.port,
      shell = excluded.shell,
      cwd = excluded.cwd,
      keyPath = excluded.keyPath,
      credentialRef = excluded.credentialRef,
      openCommand = excluded.openCommand,
      notes = excluded.notes,
      updatedAt = datetime('now')
  `).run(
    profile.id,
    profile.displayName,
    profile.kind,
    profile.authMethod,
    profile.host,
    profile.user,
    profile.port,
    profile.shell,
    profile.cwd,
    profile.keyPath,
    profile.credentialRef,
    profile.openCommand,
    profile.notes,
  );
  // Stale credential rows: if the (edited) profile no longer references a
  // credential, drop the orphaned metadata so credentialPresent stays honest.
  if (!profile.credentialRef) {
    getDb().prepare("DELETE FROM terminal_credentials WHERE profileId = ?").run(profile.id);
  }

  if (profile.credentialRef) {
    getDb().prepare(`
      INSERT INTO terminal_credentials (_id, profileId, credentialRef, kind, status)
      VALUES (?, ?, ?, 'keychain_secret', 'unknown')
      ON CONFLICT(credentialRef) DO UPDATE SET
        profileId = excluded.profileId,
        updatedAt = datetime('now')
    `).run(generateId(), profile.id, profile.credentialRef);
  }
  return getTerminalProfile(profile.id)!;
}

export function getTerminalProfile(id: string): TerminalProfile | null {
  const row = getDb().prepare("SELECT * FROM terminal_profiles WHERE _id = ?").get(id) as TerminalProfileRow | undefined;
  return row ? rowToProfile(row) : null;
}

export function listTerminalProfiles(): TerminalProfile[] {
  const rows = getDb().prepare("SELECT * FROM terminal_profiles ORDER BY displayName COLLATE NOCASE ASC").all() as TerminalProfileRow[];
  return rows.map(rowToProfile);
}

export function listTerminalProfileSummaries(): TerminalProfileSummary[] {
  const rows = getDb().prepare(`
    SELECT
      p.*,
      (SELECT COUNT(*) FROM terminal_readiness_probes rp WHERE rp.profileId = p._id AND rp.enabled = 1) AS probeCount
    FROM terminal_profiles p
    ORDER BY p.displayName COLLATE NOCASE ASC
  `).all() as Array<TerminalProfileRow & { status: string; probeCount: number }>;
  return rows.map((row) => {
    const profile = rowToProfile(row);
    return {
      ...profile,
      credentialPresent: !!profile.credentialRef,
      autoConnect: terminalAuthCapability(profile).autoConnect,
      status: row.status,
      probeCount: Number(row.probeCount ?? 0),
    };
  });
}

export function deleteTerminalProfile(id: string): boolean {
  const normalized = String(id ?? "").trim().toLowerCase();
  if (normalized === "local") throw new Error("Cannot delete the local default profile.");
  const db = getDb();
  const existing = db.prepare("SELECT _id FROM terminal_profiles WHERE _id = ?").get(normalized);
  if (!existing) return false;
  const tx = db.transaction((profileId: string) => {
    db.prepare("DELETE FROM terminal_readiness_runs WHERE profileId = ?").run(profileId);
    db.prepare("DELETE FROM terminal_readiness_probes WHERE profileId = ?").run(profileId);
    db.prepare("DELETE FROM terminal_credentials WHERE profileId = ?").run(profileId);
    db.prepare("DELETE FROM terminal_session_audit WHERE profileId = ?").run(profileId);
    db.prepare("DELETE FROM terminal_profiles WHERE _id = ?").run(profileId);
  });
  tx(normalized);
  return true;
}

export function upsertTerminalReadinessProbe(input: unknown): TerminalReadinessProbe {
  const record = normalizeProbe(input);
  getDb().prepare(`
    INSERT INTO terminal_readiness_probes (_id, profileId, name, command, enabled)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(_id) DO UPDATE SET
      profileId = excluded.profileId,
      name = excluded.name,
      command = excluded.command,
      enabled = 1,
      updatedAt = datetime('now')
  `).run(record.id, record.profileId, record.name, record.command);
  return record;
}

export function listEnabledTerminalReadinessProbes(profileId: string): TerminalReadinessProbe[] {
  const rows = getDb().prepare(`
    SELECT * FROM terminal_readiness_probes
    WHERE profileId = ? AND enabled = 1
    ORDER BY name COLLATE NOCASE ASC, _id ASC
  `).all(profileId) as TerminalProbeRow[];
  return rows.map((row) => ({ id: row._id, profileId: row.profileId, name: row.name, command: row.command }));
}

export function recordTerminalReadinessRun(input: TerminalReadinessRunInput): TerminalReadinessRunRecord {
  const state = normalizeTerminalReadinessState(input.status);
  const id = generateId();
  getDb().prepare(`
    INSERT INTO terminal_readiness_runs (_id, profileId, probeId, status, color, summary, completedAt, metadata)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).run(id, input.profileId, input.probeId ?? null, state.status, input.color ?? state.color, input.summary ?? "", JSON.stringify(redact(input.metadata ?? {})));
  return {
    id,
    profileId: input.profileId,
    probeId: input.probeId ?? null,
    status: state.status,
    color: input.color ?? state.color,
    summary: input.summary ?? "",
  };
}

export function getTerminalLaneReadinessDashboard(): {
  lane: "terminal";
  laneDisplayName: string;
  totals: { profiles: number; byColor: Record<TerminalReadinessColor, number>; needsAttention: number };
  profiles: Array<TerminalProfileSummary & { readiness: { status: TerminalReadinessStatus; color: TerminalReadinessColor; summary: string; lastRunAt: string | null } }>;
} {
  const profiles = listTerminalProfileSummaries();
  const byColor: Record<TerminalReadinessColor, number> = { green: 0, yellow: 0, orange: 0, red: 0, gray: 0 };
  const items = profiles.map((profile) => {
    const latest = latestRun(profile.id);
    const readiness = latest
      ? { status: latest.status, color: latest.color, summary: latest.summary, lastRunAt: latest.completedAt ?? latest.startedAt }
      : { status: "unknown" as const, color: "gray" as const, summary: "No readiness run recorded.", lastRunAt: null };
    byColor[readiness.color] += 1;
    return { ...profile, readiness };
  });
  return {
    lane: "terminal",
    laneDisplayName: laneDisplayName("terminal"),
    totals: {
      profiles: items.length,
      byColor,
      needsAttention: byColor.orange + byColor.red + byColor.gray,
    },
    profiles: items,
  };
}

export function recordTerminalSessionAudit(input: { profileId?: string | null; sessionId?: string | null; event: string; command?: string | null; metadata?: Record<string, unknown> }): TerminalSessionAuditEntry {
  const id = generateId();
  getDb().prepare(`
    INSERT INTO terminal_session_audit (_id, profileId, sessionId, event, command, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.profileId ?? null, input.sessionId ?? null, input.event, input.command ?? null, JSON.stringify(redact(input.metadata ?? {})));
  return listTerminalSessionAudit({ limit: 1 })[0];
}

export function listTerminalSessionAudit(input: { limit?: number } = {}): TerminalSessionAuditEntry[] {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 20)));
  const rows = getDb().prepare(`
    SELECT * FROM terminal_session_audit
    ORDER BY createdAt DESC, rowid DESC
    LIMIT ?
  `).all(limit) as AuditRow[];
  return rows.map((row) => ({
    id: row._id,
    profileId: row.profileId,
    sessionId: row.sessionId,
    event: row.event,
    command: row.command,
    metadata: safeJson(row.metadata),
    createdAt: row.createdAt,
  }));
}

function latestRun(profileId: string): LatestRunRow | null {
  return (getDb().prepare(`
    SELECT * FROM terminal_readiness_runs
    WHERE profileId = ?
    ORDER BY startedAt DESC, rowid DESC
    LIMIT 1
  `).get(profileId) as LatestRunRow | undefined) ?? null;
}

function rowToProfile(row: TerminalProfileRow): TerminalProfile {
  const inferred: TerminalAuthMethod = row.kind === "local" ? "local" : row.credentialRef ? "password_keychain" : "ssh_key_agent";
  let authMethod = (row.authMethod ?? inferred) as TerminalAuthMethod;
  // Heal legacy rows whose kind and authMethod disagree (e.g. kind=ssh with
  // authMethod=local). Contract normalization derives kind from authMethod, so
  // an unhealed mismatch makes every readiness run for the row fail.
  if ((row.kind === "ssh") !== (authMethod !== "local")) authMethod = inferred;
  return {
    id: row._id,
    displayName: row.displayName,
    kind: row.kind,
    authMethod,
    host: row.host,
    user: row.user,
    port: row.port,
    shell: row.shell,
    cwd: row.cwd,
    keyPath: row.keyPath,
    credentialRef: row.credentialRef,
    openCommand: row.openCommand,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeProbe(input: unknown): TerminalReadinessProbe {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("terminal readiness probe must be an object");
  const record = input as Record<string, unknown>;
  const id = readRequired(record, "id").toLowerCase().replace(/\s+/g, "-");
  const profileId = readRequired(record, "profileId").toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9._:-]+$/.test(id)) throw new Error("id is invalid");
  if (!/^[a-z0-9._:-]+$/.test(profileId)) throw new Error("profileId is invalid");
  return {
    id,
    profileId,
    name: readRequired(record, "name"),
    command: typeof record.command === "string" && record.command.trim() ? record.command.trim() : null,
  };
}

function readRequired(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = /password|passphrase|private.?key|secret|token|cookie/i.test(key) ? "[redacted]" : redact(entry);
  }
  return out;
}
