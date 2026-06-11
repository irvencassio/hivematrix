import type { HiveConfig } from "@/lib/central/config";
import {
  buildAuthBeeHealthSnapshot,
  buildAuthBeeProviderReadiness,
  normalizeAuthBeeSessionEntry,
  type AuthBeeCredentialKind,
  type AuthBeeHealthSnapshot,
  type AuthBeeProviderReadiness,
  type AuthBeeSessionRecord,
  type AuthBeeSessionStatus,
} from "./contracts";
import { getAuthBeeSessionEntries, setAuthBeeSessionEntries } from "./store";

export interface AuthBeeProviderReadinessInput {
  provider: string;
  label: string;
  kind: AuthBeeCredentialKind;
  configured: boolean;
  authMode?: string | null;
  status?: AuthBeeSessionStatus | null;
  notes?: string | null;
}

export type AuthBeeBrowserSessionResolution =
  | {
      ok: true;
      matchedBy: "label" | "domain";
      session: AuthBeeSessionRecord;
    }
  | {
      ok: false;
      code: "missing" | "needs_reauth" | "expired" | "revoked" | "ambiguous";
      message: string;
      matches: AuthBeeSessionRecord[];
    };
type AuthBeeBrowserSessionFailureCode = Extract<AuthBeeBrowserSessionResolution, { ok: false }>["code"];

export function listAuthBeeSessions(config: HiveConfig): AuthBeeSessionRecord[] {
  return getAuthBeeSessionEntries(config);
}

export function upsertAuthBeeSession(
  config: HiveConfig,
  payload: unknown,
  options: { now?: Date } = {},
): { created: boolean; entry: AuthBeeSessionRecord } {
  const entries = getAuthBeeSessionEntries(config);
  const existing =
    payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as { id?: unknown }).id === "string"
      ? entries.find((entry) => entry.id === (payload as { id: string }).id.trim()) ?? null
      : null;

  const entry = normalizeAuthBeeSessionEntry(payload, {
    existing: existing ?? undefined,
    now: options.now,
  });

  const nextEntries = entries.filter((candidate) => candidate.id !== entry.id);
  nextEntries.push(entry);
  setAuthBeeSessionEntries(config, nextEntries);
  return { created: existing == null, entry };
}

export function deleteAuthBeeSession(config: HiveConfig, id: string): boolean {
  const entries = getAuthBeeSessionEntries(config);
  const nextEntries = entries.filter((entry) => entry.id !== id);
  if (nextEntries.length === entries.length) {
    return false;
  }
  setAuthBeeSessionEntries(config, nextEntries);
  return true;
}

function normalizeSessionKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function hostMatchesDomain(host: string, domain: string): boolean {
  const normalizedHost = normalizeSessionKey(host);
  const normalizedDomain = normalizeSessionKey(domain).replace(/^\.+/, "");
  if (!normalizedHost || !normalizedDomain) return false;
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function isBrowserSessionKind(kind: AuthBeeCredentialKind): boolean {
  return kind === "cookie_jar" || kind === "session_attachment" || kind === "oauth";
}

function matchesAttachmentTargets(session: AuthBeeSessionRecord, attachedTo: string[]): boolean {
  if (attachedTo.length === 0) return true;
  if (session.attachedTo.length === 0) return true;
  return attachedTo.some((target) => session.attachedTo.includes(target));
}

function statusFailureCode(matches: AuthBeeSessionRecord[]): Exclude<AuthBeeBrowserSessionFailureCode, "missing" | "ambiguous"> | "missing" {
  if (matches.some((session) => session.status === "needs_reauth")) return "needs_reauth";
  if (matches.some((session) => session.status === "expired")) return "expired";
  if (matches.some((session) => session.status === "revoked")) return "revoked";
  return "missing";
}

export function resolveAuthBeeBrowserSession(
  config: HiveConfig,
  options: {
    host?: string | null;
    sessionLabel?: string | null;
    attachedTo?: string[];
  },
): AuthBeeBrowserSessionResolution {
  const sessions = getAuthBeeSessionEntries(config).filter((session) => isBrowserSessionKind(session.kind));
  const attachedTo = (options.attachedTo ?? []).map((target) => normalizeSessionKey(target)).filter(Boolean);
  const sessionLabel = normalizeSessionKey(options.sessionLabel);
  const host = normalizeSessionKey(options.host);

  let matches = sessions.filter((session) => matchesAttachmentTargets(session, attachedTo));
  let matchedBy: "label" | "domain" = "domain";

  if (sessionLabel) {
    matchedBy = "label";
    matches = matches.filter((session) => {
      const candidateLabel = normalizeSessionKey(session.sessionLabel);
      const fallbackLabel = normalizeSessionKey(session.label);
      return candidateLabel === sessionLabel || fallbackLabel === sessionLabel;
    });
  } else if (host) {
    matches = matches.filter((session) => session.domains.some((domain) => hostMatchesDomain(host, domain)));
  } else {
    matches = [];
  }

  if (matches.length === 0) {
    return {
      ok: false,
      code: "missing",
      message: sessionLabel
        ? `No attached browser session found for "${sessionLabel}".`
        : `No ready attached browser session found for ${host || "this site"}.`,
      matches: [],
    };
  }

  const readyMatches = matches.filter((session) => session.status === "ready");
  if (readyMatches.length === 1) {
    return {
      ok: true,
      matchedBy,
      session: readyMatches[0],
    };
  }

  if (readyMatches.length > 1) {
    return {
      ok: false,
      code: "ambiguous",
      message: sessionLabel
        ? `Multiple ready browser sessions match "${sessionLabel}".`
        : `Multiple ready browser sessions match ${host || "this site"}. Specify sessionLabel explicitly.`,
      matches: readyMatches,
    };
  }

  const code = statusFailureCode(matches);
  return {
    ok: false,
    code,
    message: sessionLabel
      ? `Browser session "${sessionLabel}" is not ready (${code}).`
      : `Browser session for ${host || "this site"} is not ready (${code}).`,
    matches,
  };
}

export function buildAuthBeeHealth(
  config: HiveConfig,
  providers: AuthBeeProviderReadinessInput[],
): AuthBeeHealthSnapshot {
  const sessions = getAuthBeeSessionEntries(config);
  const providerCounts = new Map<string, number>();
  for (const session of sessions) {
    providerCounts.set(session.provider, (providerCounts.get(session.provider) ?? 0) + 1);
  }

  const readiness: AuthBeeProviderReadiness[] = providers.map((provider) =>
    buildAuthBeeProviderReadiness({
      ...provider,
      sessionCount: providerCounts.get(provider.provider) ?? 0,
    }),
  );

  const knownProviders = new Set(readiness.map((entry) => entry.provider));
  for (const session of sessions) {
    if (knownProviders.has(session.provider)) continue;
    readiness.push(
      buildAuthBeeProviderReadiness({
        provider: session.provider,
        label: session.label,
        kind: session.kind,
        configured: true,
        sessionCount: providerCounts.get(session.provider) ?? 1,
        status: session.status,
      }),
    );
    knownProviders.add(session.provider);
  }

  return buildAuthBeeHealthSnapshot({
    sessions,
    providerReadiness: readiness,
  });
}
