/**
 * Claude subscription remaining — fetched from the Anthropic OAuth usage API.
 * Cached for 5 minutes so refresh ticks don't hammer the API.
 */

import { execFileSync } from "child_process";

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

let _cache: { data: SubscriptionUsage | null; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function getOAuthToken(): string | null {
  try {
    const raw = execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    const creds = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } };
    const oauth = creds?.claudeAiOauth;
    if (oauth?.accessToken && typeof oauth.expiresAt === "number" && oauth.expiresAt > Date.now()) {
      return oauth.accessToken;
    }
  } catch { /* keychain miss or parse error */ }
  return null;
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

export async function getSubscriptionRemaining(): Promise<SubscriptionUsage | null> {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.data;

  const token = getOAuthToken();
  if (!token) {
    _cache = { data: null, at: Date.now() };
    return null;
  }

  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { _cache = { data: null, at: Date.now() }; return null; }

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
    _cache = { data: result, at: Date.now() };
    return result;
  } catch {
    _cache = { data: null, at: Date.now() };
    return null;
  }
}
