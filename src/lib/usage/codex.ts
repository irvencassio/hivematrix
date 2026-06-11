import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type CodexAuthMode = "subscription" | "api-key" | "logged-out" | "unknown";

export interface CodexAuthState {
  authMode: CodexAuthMode;
  accountName: string;
  accountEmail: string;
  planType: string;
}

export interface CodexUsageProfile {
  profile: string;
  accountName: string;
  accountEmail: string;
  planType: string;
  provider: "codex";
  fiveHour: { utilization: number; resetsAt: string } | null;
  sevenDay: { utilization: number; resetsAt: string } | null;
  sevenDayOpus: null;
  sevenDaySonnet: null;
  extraUsage: null;
  fetchedAt: string;
  error?: string;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function normalizeAuthMode(rawMode: string, hasApiKey: boolean): CodexAuthMode {
  const mode = rawMode.toLowerCase();
  if (mode === "chatgpt") return "subscription";
  if (mode === "apikey" || mode === "api_key" || hasApiKey) return "api-key";
  if (!mode) return "logged-out";
  return "unknown";
}

export function parseCodexAuthStateFromText(authJsonText: string): CodexAuthState {
  const auth = parseJsonObject(authJsonText);
  if (!auth) {
    return { authMode: "logged-out", accountName: "", accountEmail: "", planType: "" };
  }

  const tokens = (auth.tokens && typeof auth.tokens === "object") ? auth.tokens as Record<string, unknown> : {};
  const idToken = decodeJwtPayload(tokens.id_token);
  const accessToken = decodeJwtPayload(tokens.access_token);
  const idAuth = idToken?.["https://api.openai.com/auth"];
  const accessAuth = accessToken?.["https://api.openai.com/auth"];
  const idAuthData = idAuth && typeof idAuth === "object" ? idAuth as Record<string, unknown> : {};
  const accessAuthData = accessAuth && typeof accessAuth === "object" ? accessAuth as Record<string, unknown> : {};
  const hasApiKey = typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.trim().length > 0;

  return {
    authMode: normalizeAuthMode(String(auth.auth_mode ?? ""), hasApiKey),
    accountName: firstString(idToken?.name, accessToken?.name),
    accountEmail: firstString(idToken?.email, accessToken?.email),
    planType: firstString(
      accessAuthData.chatgpt_plan_type,
      idAuthData.chatgpt_plan_type,
      accessAuthData.chatgpt_subscription_plan_type,
      idAuthData.chatgpt_subscription_plan_type,
    ),
  };
}

interface CodexRateLimitWindow {
  used_percent?: number;
  resets_at?: number | string;
}

interface CodexRateLimitsSnapshot {
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  planType: string;
}

function toIsoString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return "";
}

function toWindow(value: unknown): CodexRateLimitWindow | null {
  if (!value || typeof value !== "object") return null;
  const window = value as Record<string, unknown>;
  const resetsAt = window.resets_at;
  return {
    used_percent: typeof window.used_percent === "number" ? window.used_percent : 0,
    resets_at: typeof resetsAt === "number" || typeof resetsAt === "string" ? resetsAt : undefined,
  };
}

function parseRateLimitsEvent(line: string): CodexRateLimitsSnapshot | null {
  const parsed = parseJsonObject(line);
  const payload = parsed?.payload;
  if (!payload || typeof payload !== "object") return null;
  const message = payload as Record<string, unknown>;
  if (message.type !== "token_count") return null;
  const rateLimits = message.rate_limits;
  if (!rateLimits || typeof rateLimits !== "object") return null;
  const data = rateLimits as Record<string, unknown>;
  return {
    primary: toWindow(data.primary),
    secondary: toWindow(data.secondary),
    planType: firstString(data.plan_type),
  };
}

function extractLatestRateLimitsFromText(sessionJsonlText: string): CodexRateLimitsSnapshot | null {
  const lines = sessionJsonlText.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const rateLimits = parseRateLimitsEvent(line);
    if (rateLimits) return rateLimits;
  }
  return null;
}

export function extractCodexUsageProfileFromText({
  authJsonText,
  sessionJsonlText,
  fetchedAt,
}: {
  authJsonText: string;
  sessionJsonlText: string;
  fetchedAt: string;
}): CodexUsageProfile | null {
  const authState = parseCodexAuthStateFromText(authJsonText);
  if (authState.authMode !== "subscription") return null;

  const rateLimits = extractLatestRateLimitsFromText(sessionJsonlText);

  return {
    profile: "chatgpt",
    accountName: authState.accountName,
    accountEmail: authState.accountEmail,
    planType: rateLimits?.planType || authState.planType,
    provider: "codex",
    fiveHour: rateLimits?.primary
      ? {
          utilization: rateLimits.primary.used_percent ?? 0,
          resetsAt: toIsoString(rateLimits.primary.resets_at),
        }
      : null,
    sevenDay: rateLimits?.secondary
      ? {
          utilization: rateLimits.secondary.used_percent ?? 0,
          resetsAt: toIsoString(rateLimits.secondary.resets_at),
        }
      : null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    extraUsage: null,
    fetchedAt,
    error: rateLimits ? undefined : "Usage unavailable",
  };
}

function collectSessionFiles(dir: string, acc: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSessionFiles(fullPath, acc);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      acc.push(fullPath);
    }
  }
}

function readLatestSessionJsonlText(): string {
  const sessionsDir = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsDir)) return "";

  const files: string[] = [];
  collectSessionFiles(sessionsDir, files);
  files.sort((a, b) => {
    try {
      return statSync(b).mtimeMs - statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });

  for (const file of files.slice(0, 20)) {
    try {
      const text = readFileSync(file, "utf-8");
      if (extractLatestRateLimitsFromText(text)) return text;
    } catch {
      // try next file
    }
  }

  return "";
}

export function readCodexAuthState(): CodexAuthState {
  const authPath = join(homedir(), ".codex", "auth.json");
  if (!existsSync(authPath)) {
    return { authMode: "logged-out", accountName: "", accountEmail: "", planType: "" };
  }
  try {
    return parseCodexAuthStateFromText(readFileSync(authPath, "utf-8"));
  } catch {
    return { authMode: "unknown", accountName: "", accountEmail: "", planType: "" };
  }
}

export function readCodexUsageProfile(fetchedAt = new Date().toISOString()): CodexUsageProfile | null {
  const authPath = join(homedir(), ".codex", "auth.json");
  if (!existsSync(authPath)) return null;

  try {
    return extractCodexUsageProfileFromText({
      authJsonText: readFileSync(authPath, "utf-8"),
      sessionJsonlText: readLatestSessionJsonlText(),
      fetchedAt,
    });
  } catch {
    return null;
  }
}
