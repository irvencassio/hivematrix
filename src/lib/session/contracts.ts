import { randomUUID } from "node:crypto";

import { ContractValidationError } from "@/lib/central/contracts";

export const AUTHBEE_CREDENTIAL_KINDS = [
  "oauth",
  "api_token",
  "cookie_jar",
  "session_attachment",
  "cli_auth",
  "worker_token",
] as const;
export type AuthBeeCredentialKind = (typeof AUTHBEE_CREDENTIAL_KINDS)[number];

export const AUTHBEE_SESSION_STATUSES = ["ready", "needs_reauth", "expired", "missing", "revoked"] as const;
export type AuthBeeSessionStatus = (typeof AUTHBEE_SESSION_STATUSES)[number];

export interface AuthBeeSessionRecord {
  id: string;
  provider: string;
  label: string;
  kind: AuthBeeCredentialKind;
  status: AuthBeeSessionStatus;
  project: string | null;
  sessionLabel: string | null;
  domains: string[];
  scopes: string[];
  attachedTo: string[];
  secretRef: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt: string | null;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
}

export interface AuthBeeProviderReadiness {
  provider: string;
  label: string;
  kind: AuthBeeCredentialKind;
  configured: boolean;
  status: AuthBeeSessionStatus;
  authMode: string | null;
  sessionCount: number;
  notes: string | null;
}

export interface AuthBeeSessionPlaneSummary {
  mode: "shared_session_plane";
  total: number;
  ready: number;
  needsReauth: number;
  expired: number;
  missing: number;
  revoked: number;
  providers: string[];
  attachedCapabilities: string[];
}

export interface AuthBeeHealthSnapshot {
  ok: true;
  bee: "authbee";
  counts: {
    total: number;
    ready: number;
    needsReauth: number;
    expired: number;
    missing: number;
    revoked: number;
  };
  latestVerifiedAt: string | null;
  sessionPlane: AuthBeeSessionPlaneSummary;
  providerReadiness: AuthBeeProviderReadiness[];
  sessions: AuthBeeSessionRecord[];
}

type UnknownRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new ContractValidationError(message);
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function readString(
  record: UnknownRecord,
  key: string,
  label: string,
  { required = true, allowEmpty = false }: { required?: boolean; allowEmpty?: boolean } = {},
): string | null {
  const value = record[key];
  if (value == null) {
    if (required) fail(`${label} is required`);
    return null;
  }
  if (typeof value !== "string") fail(`${label} must be a string`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    if (required) fail(`${label} is required`);
    return null;
  }
  return trimmed;
}

function readStringArray(record: UnknownRecord, key: string): string[] {
  const value = record[key];
  if (value == null) return [];
  if (!Array.isArray(value)) fail(`${key} must be an array`);
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function readMetadata(record: UnknownRecord, key: string): Record<string, unknown> {
  const value = record[key];
  if (value == null) return {};
  return asRecord(value, key);
}

function normalizeProvider(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) fail("provider is required");
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9._:-]+$/.test(normalized)) {
    fail("provider must contain only letters, numbers, dots, underscores, colons, or hyphens");
  }
  return normalized;
}

function normalizeDateString(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") fail(`${label} must be a string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`${label} must be a valid timestamp`);
  return parsed.toISOString();
}

function normalizeEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
  label: string,
): T[number] {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  const normalized = value.trim().toLowerCase();
  if ((allowed as readonly string[]).includes(normalized)) {
    return normalized as T[number];
  }
  fail(`${label} must be one of: ${allowed.join(", ")}`);
}

function deriveStatus(args: {
  explicitStatus: AuthBeeSessionStatus | null;
  expiresAt: string | null;
  now: Date;
}): AuthBeeSessionStatus {
  if (args.expiresAt && new Date(args.expiresAt).getTime() <= args.now.getTime()) {
    return "expired";
  }
  return args.explicitStatus ?? "ready";
}

export function normalizeAuthBeeSessionEntry(
  value: unknown,
  options: { existing?: AuthBeeSessionRecord; now?: Date } = {},
): AuthBeeSessionRecord {
  const now = options.now ?? new Date();
  const record = asRecord(value, "authbee session");
  const provider = normalizeProvider(record.provider);
  const label = readString(record, "label", "label")!;
  const existing = options.existing;
  const expiresAt = normalizeDateString(record.expiresAt, "expiresAt");
  const explicitStatus =
    record.status == null
      ? null
      : normalizeEnum(record.status, AUTHBEE_SESSION_STATUSES, "ready", "status");

  return {
    id:
      readString(record, "id", "id", { required: false }) ??
      existing?.id ??
      randomUUID(),
    provider,
    label,
    kind: normalizeEnum(record.kind, AUTHBEE_CREDENTIAL_KINDS, "session_attachment", "kind"),
    status: deriveStatus({ explicitStatus, expiresAt, now }),
    project: readString(record, "project", "project", { required: false }),
    sessionLabel: readString(record, "sessionLabel", "sessionLabel", { required: false }),
    domains: readStringArray(record, "domains"),
    scopes: readStringArray(record, "scopes"),
    attachedTo: readStringArray(record, "attachedTo"),
    secretRef: readString(record, "secretRef", "secretRef", { required: false }),
    notes: readString(record, "notes", "notes", { required: false, allowEmpty: true }) ?? "",
    createdAt:
      normalizeDateString(record.createdAt, "createdAt") ??
      existing?.createdAt ??
      now.toISOString(),
    updatedAt:
      normalizeDateString(record.updatedAt, "updatedAt") ??
      existing?.updatedAt ??
      now.toISOString(),
    lastVerifiedAt: normalizeDateString(record.lastVerifiedAt, "lastVerifiedAt"),
    expiresAt,
    metadata: readMetadata(record, "metadata"),
  };
}

export function normalizeAuthBeeSessionEntries(value: unknown): AuthBeeSessionRecord[] {
  if (!Array.isArray(value)) return [];
  const entries: AuthBeeSessionRecord[] = [];
  for (const entry of value) {
    try {
      entries.push(normalizeAuthBeeSessionEntry(entry));
    } catch {
      // Skip malformed persisted entries instead of breaking every consumer.
    }
  }
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function buildAuthBeeProviderReadiness(input: {
  provider: string;
  label: string;
  kind: AuthBeeCredentialKind;
  configured: boolean;
  authMode?: string | null;
  sessionCount?: number;
  status?: AuthBeeSessionStatus | null;
  notes?: string | null;
}): AuthBeeProviderReadiness {
  const sessionCount = input.sessionCount ?? 0;
  const configured = input.configured || sessionCount > 0;
  const authMode = typeof input.authMode === "string" && input.authMode.trim() ? input.authMode : null;

  let status = input.status ?? null;
  if (!status) {
    if (!configured) {
      status = "missing";
    } else if (authMode === "subscription" || authMode === "api-key") {
      status = "ready";
    } else if (authMode === "logged-out") {
      status = "needs_reauth";
    } else {
      status = sessionCount > 0 ? "ready" : "missing";
    }
  }

  return {
    provider: normalizeProvider(input.provider),
    label: input.label.trim(),
    kind: input.kind,
    configured,
    status,
    authMode,
    sessionCount,
    notes: input.notes?.trim() || null,
  };
}

export function buildAuthBeeSessionPlaneSummary(
  sessions: Array<Pick<AuthBeeSessionRecord, "provider" | "status" | "kind" | "attachedTo" | "domains">>,
): AuthBeeSessionPlaneSummary {
  const browserSessions = sessions.filter((session) =>
    session.kind === "cookie_jar" ||
    session.kind === "session_attachment" ||
    session.attachedTo.includes("browserbee") ||
    session.attachedTo.includes("tubebee") ||
    session.domains.length > 0,
  );

  const summary: AuthBeeSessionPlaneSummary = {
    mode: "shared_session_plane",
    total: browserSessions.length,
    ready: 0,
    needsReauth: 0,
    expired: 0,
    missing: 0,
    revoked: 0,
    providers: Array.from(new Set(browserSessions.map((session) => session.provider))).sort(),
    attachedCapabilities: Array.from(
      new Set(
        browserSessions.flatMap((session) => session.attachedTo).filter((value) => value.trim().length > 0),
      ),
    ).sort(),
  };

  for (const session of browserSessions) {
    switch (session.status) {
      case "ready":
        summary.ready += 1;
        break;
      case "needs_reauth":
        summary.needsReauth += 1;
        break;
      case "expired":
        summary.expired += 1;
        break;
      case "missing":
        summary.missing += 1;
        break;
      case "revoked":
        summary.revoked += 1;
        break;
      default:
        break;
    }
  }

  return summary;
}

export function buildAuthBeeHealthSnapshot(args: {
  sessions: AuthBeeSessionRecord[];
  providerReadiness: AuthBeeProviderReadiness[];
}): AuthBeeHealthSnapshot {
  const counts = {
    total: args.sessions.length,
    ready: 0,
    needsReauth: 0,
    expired: 0,
    missing: 0,
    revoked: 0,
  };

  let latestVerifiedAt: string | null = null;
  for (const session of args.sessions) {
    if (session.lastVerifiedAt && (!latestVerifiedAt || session.lastVerifiedAt > latestVerifiedAt)) {
      latestVerifiedAt = session.lastVerifiedAt;
    }

    switch (session.status) {
      case "ready":
        counts.ready += 1;
        break;
      case "needs_reauth":
        counts.needsReauth += 1;
        break;
      case "expired":
        counts.expired += 1;
        break;
      case "missing":
        counts.missing += 1;
        break;
      case "revoked":
        counts.revoked += 1;
        break;
      default:
        break;
    }
  }

  return {
    ok: true,
    bee: "authbee",
    counts,
    latestVerifiedAt,
    sessionPlane: buildAuthBeeSessionPlaneSummary(args.sessions),
    providerReadiness: [...args.providerReadiness].sort((a, b) => a.provider.localeCompare(b.provider)),
    sessions: [...args.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}
