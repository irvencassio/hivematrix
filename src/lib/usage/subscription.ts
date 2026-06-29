/**
 * Claude subscription remaining - fetched from the Anthropic OAuth usage API.
 * Cached for 5 minutes so refresh ticks don't hammer the API.
 */

import { execFileSync as nodeExecFileSync } from "child_process";

export interface SubscriptionWindow {
  utilization: number;  // 0-100 percent used
  remaining: number;    // 0-100 percent left
  resetsAt: string;     // ISO timestamp
}

export interface SubscriptionUsage {
  fiveHour: SubscriptionWindow | null;
  sevenDay: SubscriptionWindow | null;
  sevenDayOpus: SubscriptionWindow | null;
  sevenDaySonnet: SubscriptionWindow | null;
  fetchedAt: string;
}

export type SubscriptionUsageState =
  | "ok"
  | "missing_credentials"
  | "missing_refresh_token"
  | "refresh_failed"
  | "usage_fetch_failed"
  | "usage_unauthorized";

export interface SubscriptionUsageStatus {
  state: SubscriptionUsageState;
  message: string;
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
  refreshed?: boolean;
}

export interface SubscriptionUsageResult {
  usage: SubscriptionUsage | null;
  status: SubscriptionUsageStatus;
}

export interface SubscriptionUsageOptions {
  bypassCache?: boolean;
}

export type UsageStatusColor = "green" | "yellow" | "red";

export const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Classifies a subscription window as green/yellow/red using both the
 * absolute utilization and the pace relative to elapsed window time.
 *
 * Early in a window (< 15% elapsed) a single task spike is expected;
 * utilization above the per-unit threshold (100 / windowUnits) triggers red.
 * After that, burn rate relative to expected pace drives the classification,
 * with an absolute floor at maxAllowable = (100/windowUnits) * (windowUnits - 1)
 * so a consistently slow burn still warns near the limit.
 */
export function classifyWindowStatus(
  win: SubscriptionWindow,
  windowDurationMs: number,
  nowMs?: number,
): UsageStatusColor {
  const now = nowMs ?? Date.now();
  const util = win.utilization;

  if (util >= 90) return "red";

  const resetsMs = new Date(win.resetsAt).getTime();
  const timeUntilResetMs = resetsMs - now;

  if (timeUntilResetMs <= 0 || windowDurationMs <= 0) {
    return util >= 80 ? "red" : util >= 60 ? "yellow" : "green";
  }

  // windowUnits = number of natural periods (days for multi-day, hours for sub-day)
  const windowUnits = windowDurationMs >= 86400000
    ? windowDurationMs / 86400000
    : windowDurationMs / 3600000;
  const dailyThreshold = 100 / windowUnits;
  const maxAllowable = dailyThreshold * (windowUnits - 1);

  const elapsedMs = Math.max(0, windowDurationMs - timeUntilResetMs);
  const elapsedFraction = elapsedMs / windowDurationMs;

  if (elapsedFraction < 0.15) {
    return util > dailyThreshold ? "red" : "green";
  }

  const expectedUtil = elapsedFraction * 100;
  const burnRatio = util / expectedUtil;

  if (burnRatio >= 1.5 || util >= maxAllowable) return "red";
  if (burnRatio >= 1.25 || util >= 60) return "yellow";
  return "green";
}

type SubscriptionExecFileSync = (
  file: string,
  args: readonly string[],
  options?: Parameters<typeof nodeExecFileSync>[2],
) => string | Buffer;

export interface SubscriptionTestDeps {
  now: () => number;
  execFileSync: SubscriptionExecFileSync;
  fetch: typeof fetch;
}

interface ClaudeOAuthCredentials {
  accessToken?: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  scopes?: string[];
  clientId?: string | null;
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
}

interface ClaudeCredentialsEnvelope {
  claudeAiOauth?: ClaudeOAuthCredentials;
  [key: string]: unknown;
}

interface ResolvedToken {
  token: string | null;
  envelope: ClaudeCredentialsEnvelope | null;
  oauth: ClaudeOAuthCredentials | null;
  status: SubscriptionUsageStatus;
}

let _cache: { data: SubscriptionUsageResult; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const CREDENTIAL_SERVICE = "Claude Code-credentials";
const CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const DEFAULT_SCOPES = [
  "user:file_upload",
  "user:inference",
  "user:mcp_servers",
  "user:profile",
  "user:sessions:claude_code",
];

const defaultDeps: SubscriptionTestDeps = {
  now: () => Date.now(),
  execFileSync: (file, args, options) => nodeExecFileSync(file, [...args], options),
  fetch: globalThis.fetch.bind(globalThis),
};

function planLabel(oauth: ClaudeOAuthCredentials | null): string {
  if (oauth?.subscriptionType === "max" && oauth.rateLimitTier === "default_claude_max_5x") return "Claude Max 5x";
  if (oauth?.subscriptionType) return `Claude ${oauth.subscriptionType}`;
  return "Claude subscription";
}

function status(
  state: SubscriptionUsageState,
  message: string,
  oauth?: ClaudeOAuthCredentials | null,
  refreshed = false,
): SubscriptionUsageStatus {
  return {
    state,
    message,
    subscriptionType: oauth?.subscriptionType ?? null,
    rateLimitTier: oauth?.rateLimitTier ?? null,
    refreshed,
  };
}

function readCredentials(deps: SubscriptionTestDeps): ClaudeCredentialsEnvelope | null {
  try {
    const raw = deps.execFileSync("security", ["find-generic-password", "-s", CREDENTIAL_SERVICE, "-w"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).toString().trim();
    return JSON.parse(raw) as ClaudeCredentialsEnvelope;
  } catch {
    return null;
  }
}

function keychainAccount(): string | null {
  return process.env.USER || process.env.LOGNAME || null;
}

function writeCredentials(deps: SubscriptionTestDeps, envelope: ClaudeCredentialsEnvelope): void {
  const account = keychainAccount();
  const args = ["add-generic-password"];
  if (account) args.push("-a", account);
  args.push("-s", CREDENTIAL_SERVICE, "-w", JSON.stringify(envelope), "-U");
  deps.execFileSync("security", args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
  });
}

function subscriptionTypeFromOrganization(value: unknown): string | null {
  switch (value) {
    case "claude_max": return "max";
    case "claude_pro": return "pro";
    case "claude_enterprise": return "enterprise";
    case "claude_team": return "team";
    default: return null;
  }
}

async function refreshCredentials(
  deps: SubscriptionTestDeps,
  envelope: ClaudeCredentialsEnvelope,
  oauth: ClaudeOAuthCredentials,
): Promise<ClaudeOAuthCredentials | null> {
  if (!oauth.refreshToken) return null;
  const scopes = oauth.scopes?.length ? oauth.scopes : DEFAULT_SCOPES;
  const res = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: oauth.refreshToken,
      client_id: oauth.clientId ?? CLAUDE_CODE_CLIENT_ID,
      scope: scopes.join(" "),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  const data = await res.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    organization?: {
      organization_type?: string | null;
      rate_limit_tier?: string | null;
    };
  };
  if (!data.access_token || typeof data.expires_in !== "number") return null;

  const refreshed: ClaudeOAuthCredentials = {
    ...oauth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? oauth.refreshToken,
    expiresAt: deps.now() + data.expires_in * 1000,
    scopes: data.scope?.split(/\s+/).filter(Boolean) ?? scopes,
    clientId: oauth.clientId,
    subscriptionType: subscriptionTypeFromOrganization(data.organization?.organization_type) ?? oauth.subscriptionType ?? null,
    rateLimitTier: data.organization?.rate_limit_tier ?? oauth.rateLimitTier ?? null,
  };
  writeCredentials(deps, { ...envelope, claudeAiOauth: refreshed });
  return refreshed;
}

async function resolveOAuthToken(deps: SubscriptionTestDeps, forceRefresh = false): Promise<ResolvedToken> {
  const envelope = readCredentials(deps);
  const oauth = envelope?.claudeAiOauth ?? null;
  if (!envelope || !oauth?.accessToken) {
    return {
      token: null,
      envelope,
      oauth,
      status: status("missing_credentials", "Claude Code credentials were not found in Keychain. Run `claude auth login`.", oauth),
    };
  }
  const expiresAt = typeof oauth.expiresAt === "number" ? oauth.expiresAt : null;
  const isFresh = expiresAt === null || expiresAt - deps.now() > REFRESH_SKEW_MS;
  if (!forceRefresh && isFresh) {
    return {
      token: oauth.accessToken,
      envelope,
      oauth,
      status: status("ok", `${planLabel(oauth)} usage token is current.`, oauth),
    };
  }
  if (!oauth.refreshToken) {
    return {
      token: null,
      envelope,
      oauth,
      status: status("missing_refresh_token", `${planLabel(oauth)} token is expired and has no refresh token. Run \`claude auth login\`.`, oauth),
    };
  }
  try {
    const refreshed = await refreshCredentials(deps, envelope, oauth);
    if (!refreshed?.accessToken) {
      return {
        token: null,
        envelope,
        oauth,
        status: status("refresh_failed", `${planLabel(oauth)} token refresh failed. Run \`claude auth login\` if this persists.`, oauth),
      };
    }
    return {
      token: refreshed.accessToken,
      envelope: { ...envelope, claudeAiOauth: refreshed },
      oauth: refreshed,
      status: status("ok", `${planLabel(refreshed)} usage token refreshed.`, refreshed, true),
    };
  } catch {
    return {
      token: null,
      envelope,
      oauth,
      status: status("refresh_failed", `${planLabel(oauth)} token refresh failed. Run \`claude auth login\` if this persists.`, oauth),
    };
  }
}

function toWindow(w: { utilization?: number | null; resets_at?: string } | null | undefined): SubscriptionWindow | null {
  if (!w || w.utilization == null) return null;
  const util = Math.min(100, Math.max(0, w.utilization));
  return {
    utilization: Math.round(util * 10) / 10,
    remaining: Math.round((100 - util) * 10) / 10,
    resetsAt: w.resets_at ?? "",
  };
}

async function fetchUsage(
  deps: SubscriptionTestDeps,
  token: string,
  currentStatus: SubscriptionUsageStatus,
): Promise<SubscriptionUsageResult> {
  try {
    const res = await deps.fetch(USAGE_URL, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return {
        usage: null,
        status: status(
          res.status === 401 || res.status === 403 ? "usage_unauthorized" : "usage_fetch_failed",
          `Claude subscription usage fetch failed with HTTP ${res.status}.`,
          currentStatus,
        ),
      };
    }

    const data = await res.json() as {
      five_hour?: { utilization: number; resets_at: string } | null;
      seven_day?: { utilization: number; resets_at: string } | null;
      seven_day_opus?: { utilization: number; resets_at: string } | null;
      seven_day_sonnet?: { utilization: number; resets_at: string } | null;
    };

    const result: SubscriptionUsage = {
      fiveHour: toWindow(data.five_hour),
      sevenDay: toWindow(data.seven_day),
      sevenDayOpus: toWindow(data.seven_day_opus),
      sevenDaySonnet: toWindow(data.seven_day_sonnet),
      fetchedAt: new Date().toISOString(),
    };
    return { usage: result, status: currentStatus };
  } catch {
    return {
      usage: null,
      status: status("usage_fetch_failed", "Claude subscription usage fetch failed.", currentStatus),
    };
  }
}

export async function getSubscriptionRemainingDetailed(
  deps: SubscriptionTestDeps = defaultDeps,
  options: SubscriptionUsageOptions = {},
): Promise<SubscriptionUsageResult> {
  if (!options.bypassCache && _cache && deps === defaultDeps && deps.now() - _cache.at < CACHE_TTL_MS) return _cache.data;

  const resolved = await resolveOAuthToken(deps);
  if (!resolved.token) {
    const data = { usage: null, status: resolved.status };
    if (deps === defaultDeps) _cache = { data, at: deps.now() };
    return data;
  }

  let data = await fetchUsage(deps, resolved.token, resolved.status);
  if (data.status.state === "usage_unauthorized" && resolved.oauth?.refreshToken) {
    const retried = await resolveOAuthToken(deps, true);
    if (retried.token) data = await fetchUsage(deps, retried.token, retried.status);
  }
  if (deps === defaultDeps) _cache = { data, at: deps.now() };
  return data;
}

export async function getSubscriptionRemaining(): Promise<SubscriptionUsage | null> {
  return (await getSubscriptionRemainingDetailed()).usage;
}

export function _resetSubscriptionCacheForTests(): void {
  _cache = null;
}
