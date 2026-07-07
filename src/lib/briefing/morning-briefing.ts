/**
 * Proactive morning briefing — the "▶ push" half of the Jarvis voice surface.
 *
 * The voice command "good morning" answers the same standup on demand; this loop
 * delivers it unprompted once a day. It reuses composeBriefing() (one source of
 * truth) and pushes via APNs to registered iOS devices, falling back to notify()
 * (iMessage/Telegram/email) so the operator is reached even before APNs is set up.
 *
 * Config (`~/.hivematrix/config.json`):
 *   morningBriefing: { enabled: boolean, hour: number /* 0-23 local *\/, lastRunAt?: string }
 */

import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import { startPollLoop } from "@/lib/lanes/poll-loop";

export interface MorningBriefingConfig {
  enabled: boolean;
  hour: number; // 0-23, local
  lastRunAt?: string;
}

const DEFAULT_CONFIG: MorningBriefingConfig = { enabled: false, hour: 8 };

/** Pure: normalize the stored briefing config (clamps hour to 0-23). */
export function parseMorningBriefingConfig(input: unknown): MorningBriefingConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_CONFIG };
  const obj = input as Record<string, unknown>;
  const rawHour = typeof obj.hour === "number" ? Math.floor(obj.hour) : DEFAULT_CONFIG.hour;
  const hour = Math.min(23, Math.max(0, rawHour));
  return {
    enabled: obj.enabled === true,
    hour,
    lastRunAt: typeof obj.lastRunAt === "string" ? obj.lastRunAt : undefined,
  };
}

export function getMorningBriefingConfig(): MorningBriefingConfig {
  return parseMorningBriefingConfig(loadHiveConfig().morningBriefing);
}

export function setMorningBriefingConfig(patch: Partial<MorningBriefingConfig>): MorningBriefingConfig {
  const config = loadHiveConfig();
  const next = parseMorningBriefingConfig({ ...getMorningBriefingConfig(), ...patch });
  config.morningBriefing = next;
  saveHiveConfig(config);
  return next;
}

/**
 * Pure: should the daily-at briefing fire now? Fires once we've reached today's
 * target hour (local) and haven't already run since that target. `lastRunAt` is
 * the persisted marker that prevents re-firing within the same day.
 */
export function briefingDue(config: MorningBriefingConfig, now: Date = new Date()): boolean {
  if (!config.enabled) return false;
  const target = new Date(now);
  target.setHours(config.hour, 0, 0, 0);
  if (now < target) return false; // today's hour hasn't arrived yet
  if (!config.lastRunAt) return true;
  return new Date(config.lastRunAt) < target; // last run predates today's target → due again
}

export interface BriefingDeps {
  composeBriefing?: () => Promise<string>;
  sendApnsPush?: (opts: { title: string; body: string; data?: Record<string, unknown> }) => Promise<{ sent: number }>;
  notify?: (text: string) => Promise<unknown>;
  now?: () => Date;
}

/**
 * Deliver one briefing immediately (used by the loop and the /briefing/test
 * endpoint). Tries APNs first; if no device received it, falls back to notify().
 * Returns the spoken text and how it was delivered.
 */
export async function runBriefingNow(deps: BriefingDeps = {}): Promise<{ text: string; pushed: number; fellBack: boolean }> {
  const compose = deps.composeBriefing ?? (async () => (await import("@/lib/voice/command-turn")).composeBriefing());
  const text = await compose();

  const push = deps.sendApnsPush ?? (async (o) => (await import("@/lib/notify/apns")).sendApnsPush(o));
  let pushed = 0;
  try {
    const result = await push({ title: "Morning briefing", body: text, data: { kind: "morning-briefing" } });
    pushed = result.sent;
  } catch { /* fall through to notify() */ }

  let fellBack = false;
  if (pushed === 0) {
    const notifyFn = deps.notify ?? (async (t) => (await import("@/lib/notify/notify")).notify(t));
    try { await notifyFn(`☀️ Morning briefing\n${text}`); fellBack = true; } catch { /* best effort */ }
  }
  return { text, pushed, fellBack };
}

const CHECK_INTERVAL_MS = 60_000; // re-check every minute; cheap and granular enough for an hourly target
let stopFn: (() => void) | null = null;

async function tick(deps: BriefingDeps): Promise<void> {
  const config = getMorningBriefingConfig();
  if (!config.enabled) return;
  const now = (deps.now ?? (() => new Date()))();
  if (!briefingDue(config, now)) return;
  // Offline? skip this tick — we'll catch the next one once back online.
  if (getConnectivityPolicy().mode === "offline") return;

  // Mark the run BEFORE delivery so a slow/failed send can't double-fire next tick.
  setMorningBriefingConfig({ lastRunAt: now.toISOString() });
  try {
    const { pushed, fellBack } = await runBriefingNow(deps);
    console.log(`[briefing] morning briefing delivered (apns=${pushed}, fallback=${fellBack})`);
  } catch (e) {
    console.error(`[briefing] morning briefing failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** Start the morning-briefing loop (idempotent). Self-gates on config. Returns a stop fn. */
export function startMorningBriefingLoop(deps: BriefingDeps = {}, intervalMs = CHECK_INTERVAL_MS): () => void {
  if (stopFn) return stopMorningBriefingLoop;
  stopFn = startPollLoop({ name: "briefing", intervalMs, tick: () => tick(deps) });
  return stopMorningBriefingLoop;
}

export function stopMorningBriefingLoop(): void {
  if (stopFn) { stopFn(); stopFn = null; }
}
