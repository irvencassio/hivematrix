import { ContractValidationError } from "@/lib/central/contracts";

export const BROWSER_READINESS_STATUSES = [
  "ready",
  "maintenance",
  "needs_reauth",
  "human_required",
  "probe_failed",
  "blocked",
  "unknown",
] as const;
export type BrowserReadinessStatus = (typeof BROWSER_READINESS_STATUSES)[number];
export type BrowserReadinessColor = "green" | "yellow" | "orange" | "red" | "gray";

export const READINESS_ASSERTION_KINDS = ["text", "selector", "url_contains", "account_text", "visual"] as const;
export type ReadinessAssertionKind = (typeof READINESS_ASSERTION_KINDS)[number];

export interface BrowserSite {
  id: string;
  displayName: string;
  homeUrl: string;
  loginUrl: string | null;
  allowedDomains: string[];
  credentialRef: string | null;
  profileRef: string | null;
  authStrategy: "manual_session" | "keychain_password" | "google_sso" | "microsoft_sso";
  providerAccount: string | null;
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ReadinessAssertion {
  kind: ReadinessAssertionKind;
  value: string;
  optional: boolean;
}

export interface ReadinessProbe {
  id: string;
  siteId: string;
  name: string;
  url: string;
  assertions: ReadinessAssertion[];
  requiresAuth: boolean;
}

export interface BrowserReadinessState {
  status: BrowserReadinessStatus;
  color: BrowserReadinessColor;
  label: string;
}

type UnknownRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new ContractValidationError(message);
}

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as UnknownRecord;
}

function rejectInlineSecrets(record: UnknownRecord, label: string): void {
  for (const key of Object.keys(record)) {
    if (/password|secret|token|cookie|totp/i.test(key) && key !== "credentialRef") {
      fail(`${label} must not include inline secret field "${key}"; use credentialRef`);
    }
  }
}

function readString(record: UnknownRecord, key: string, options: { required?: boolean; allowEmpty?: boolean } = {}): string | null {
  const required = options.required ?? true;
  const value = record[key];
  if (value == null) {
    if (required) fail(`${key} is required`);
    return null;
  }
  if (typeof value !== "string") fail(`${key} must be a string`);
  const trimmed = value.trim();
  if (!options.allowEmpty && trimmed.length === 0) {
    if (required) fail(`${key} is required`);
    return null;
  }
  return trimmed;
}

function readBoolean(record: UnknownRecord, key: string, fallback: boolean): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(record: UnknownRecord, key: string): string[] {
  const value = record[key];
  if (value == null) return [];
  if (!Array.isArray(value)) fail(`${key} must be an array`);
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)));
}

function normalizeUrl(value: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${key} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail(`${key} must use http or https`);
  return parsed.toString();
}

function normalizeId(value: string, label: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9._:-]+$/.test(normalized)) fail(`${label} must contain only letters, numbers, dots, underscores, colons, or hyphens`);
  return normalized;
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number], label: string): T[number] {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") fail(`${label} must be a string`);
  const normalized = value.trim().toLowerCase();
  if ((allowed as readonly string[]).includes(normalized)) return normalized as T[number];
  fail(`${label} must be one of: ${allowed.join(", ")}`);
}

export function normalizeBrowserSite(input: unknown): BrowserSite {
  const record = asRecord(input, "browser site");
  rejectInlineSecrets(record, "browser site");
  const homeUrl = normalizeUrl(readString(record, "homeUrl")!, "homeUrl");
  const loginUrlRaw = readString(record, "loginUrl", { required: false });
  const homeHost = new URL(homeUrl).hostname;
  const allowedDomains = Array.from(new Set([homeHost, ...readStringArray(record, "allowedDomains")].map((domain) => domain.toLowerCase())));
  return {
    id: normalizeId(readString(record, "id")!, "id"),
    displayName: readString(record, "displayName")!,
    homeUrl,
    loginUrl: loginUrlRaw ? normalizeUrl(loginUrlRaw, "loginUrl") : null,
    allowedDomains,
    credentialRef: readString(record, "credentialRef", { required: false }),
    profileRef: readString(record, "profileRef", { required: false }),
    authStrategy: normalizeEnum(record.authStrategy, ["manual_session", "keychain_password", "google_sso", "microsoft_sso"] as const, "manual_session", "authStrategy"),
    providerAccount: readString(record, "providerAccount", { required: false }),
    notes: readString(record, "notes", { required: false, allowEmpty: true }) ?? "",
    createdAt: readString(record, "createdAt", { required: false }),
    updatedAt: readString(record, "updatedAt", { required: false }),
  };
}

export function normalizeReadinessProbe(input: unknown): ReadinessProbe {
  const record = asRecord(input, "readiness probe");
  const assertionsValue = record.assertions;
  if (!Array.isArray(assertionsValue)) fail("assertions must be an array");
  return {
    id: normalizeId(readString(record, "id")!, "id"),
    siteId: normalizeId(readString(record, "siteId")!, "siteId"),
    name: readString(record, "name")!,
    url: normalizeUrl(readString(record, "url")!, "url"),
    requiresAuth: readBoolean(record, "requiresAuth", true),
    assertions: assertionsValue.map((entry) => {
      const assertion = asRecord(entry, "readiness assertion");
      return {
        kind: normalizeEnum(assertion.kind, READINESS_ASSERTION_KINDS, "text", "assertion.kind"),
        value: readString(assertion, "value")!,
        optional: readBoolean(assertion, "optional", false),
      };
    }),
  };
}

export function normalizeBrowserReadinessState(value: unknown): BrowserReadinessState {
  const status = normalizeEnum(value, BROWSER_READINESS_STATUSES, "unknown", "readiness status");
  switch (status) {
    case "ready":
      return { status, color: "green", label: "Ready" };
    case "maintenance":
    case "probe_failed":
      return { status, color: "yellow", label: status === "maintenance" ? "Needs maintenance" : "Probe failed" };
    case "needs_reauth":
    case "human_required":
      return { status, color: "orange", label: status === "needs_reauth" ? "Needs reauth" : "Human required" };
    case "blocked":
      return { status, color: "red", label: "Blocked" };
    case "unknown":
      return { status, color: "gray", label: "Unknown" };
  }
}
