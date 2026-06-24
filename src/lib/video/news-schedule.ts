/**
 * Weekly AI-news video draft — the "▶ push" half of the video factory. Once a week
 * at the configured day/hour it drafts the script and PAUSES at the review checkpoint
 * (it never renders/publishes unattended — that's the operator's call via the review
 * task). It then pings the operator that "this week's script is ready for review".
 * Mirrors the morning-briefing loop: pure config + due() + a self-gating interval.
 *
 * Config (`~/.hivematrix/config.json`):
 *   videoSchedule: { enabled, weekday /* 0=Sun..6=Sat *\/, hour /* 0-23 local *\/, privacy, lastRunAt? }
 */

import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";

export interface VideoScheduleConfig {
  enabled: boolean;
  weekday: number; // 0=Sun .. 6=Sat, local
  hour: number;    // 0-23, local
  privacy: string; // youtube privacy used when the draft is approved
  lastRunAt?: string;
}

const DEFAULT_CONFIG: VideoScheduleConfig = { enabled: false, weekday: 1, hour: 8, privacy: "unlisted" };

/** Pure: normalize the stored schedule config (clamps weekday 0-6 + hour 0-23). */
export function parseVideoScheduleConfig(input: unknown): VideoScheduleConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_CONFIG };
  const obj = input as Record<string, unknown>;
  const weekday = Math.min(6, Math.max(0, typeof obj.weekday === "number" ? Math.floor(obj.weekday) : DEFAULT_CONFIG.weekday));
  const hour = Math.min(23, Math.max(0, typeof obj.hour === "number" ? Math.floor(obj.hour) : DEFAULT_CONFIG.hour));
  const privacy = obj.privacy === "public" || obj.privacy === "private" || obj.privacy === "unlisted" ? obj.privacy : DEFAULT_CONFIG.privacy;
  return {
    enabled: obj.enabled === true,
    weekday,
    hour,
    privacy,
    lastRunAt: typeof obj.lastRunAt === "string" ? obj.lastRunAt : undefined,
  };
}

export function getVideoScheduleConfig(): VideoScheduleConfig {
  return parseVideoScheduleConfig(loadHiveConfig().videoSchedule);
}

export function setVideoScheduleConfig(patch: Partial<VideoScheduleConfig>): VideoScheduleConfig {
  const config = loadHiveConfig();
  const next = parseVideoScheduleConfig({ ...getVideoScheduleConfig(), ...patch });
  config.videoSchedule = next;
  saveHiveConfig(config);
  return next;
}

/**
 * Pure: should the weekly draft fire now? Fires once on the target weekday after the
 * target hour (local), guarded by `lastRunAt` so it can't re-fire the same week.
 */
export function weeklyDraftDue(config: VideoScheduleConfig, now: Date = new Date()): boolean {
  if (!config.enabled) return false;
  if (now.getDay() !== config.weekday) return false;
  const target = new Date(now);
  target.setHours(config.hour, 0, 0, 0);
  if (now < target) return false;            // today's hour hasn't arrived yet
  if (!config.lastRunAt) return true;
  return new Date(config.lastRunAt) < target; // last run predates this week's target → due
}

export interface VideoScheduleDeps {
  draft?: (opts: { privacy: string }) => Promise<{ id: string; title: string; taskId?: string }>;
  sendApnsPush?: (opts: { title: string; body: string; data?: Record<string, unknown> }) => Promise<{ sent: number }>;
  notify?: (text: string) => Promise<unknown>;
  now?: () => Date;
}

/** Draft this week's video now and ping the operator. Used by the loop + a test endpoint. */
export async function runWeeklyDraftNow(deps: VideoScheduleDeps = {}): Promise<{ draftId: string; title: string; pushed: number; fellBack: boolean }> {
  const cfg = getVideoScheduleConfig();
  const draftFn = deps.draft ?? (async (o) => {
    const d = await (await import("./news-review")).draftNewsVideo({ privacy: o.privacy });
    return { id: d.id, title: d.title, taskId: d.taskId };
  });
  const draft = await draftFn({ privacy: cfg.privacy });

  const body = `This week's AI-news video script is ready for your review: "${draft.title}". Reply "approve" to render + publish, or tell me what to change.`;
  const push = deps.sendApnsPush ?? (async (o) => (await import("@/lib/notify/apns")).sendApnsPush(o));
  let pushed = 0;
  try { pushed = (await push({ title: "Video script ready", body, data: { kind: "video-review", draftId: draft.id, taskId: draft.taskId } })).sent; } catch { /* fall back */ }

  let fellBack = false;
  if (pushed === 0) {
    const notifyFn = deps.notify ?? (async (t) => (await import("@/lib/notify/notify")).notify(t));
    try { await notifyFn(`🎬 ${body}`); fellBack = true; } catch { /* best effort */ }
  }
  return { draftId: draft.id, title: draft.title, pushed, fellBack };
}

const CHECK_INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(deps: VideoScheduleDeps): Promise<void> {
  const config = getVideoScheduleConfig();
  if (!config.enabled) return;
  const now = (deps.now ?? (() => new Date()))();
  if (!weeklyDraftDue(config, now)) return;
  if (getConnectivityPolicy().mode === "offline") return;
  // Mark BEFORE drafting so a slow/failed draft can't double-fire this week.
  setVideoScheduleConfig({ lastRunAt: now.toISOString() });
  try {
    const { draftId, pushed, fellBack } = await runWeeklyDraftNow(deps);
    console.log(`[video] weekly draft ready for review: ${draftId} (apns=${pushed}, fallback=${fellBack})`);
  } catch (e) {
    console.error(`[video] weekly draft failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** Start the weekly-draft loop (idempotent). Self-gates on config. Returns a stop fn. */
export function startWeeklyVideoLoop(deps: VideoScheduleDeps = {}, intervalMs = CHECK_INTERVAL_MS): () => void {
  if (timer) return stopWeeklyVideoLoop;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void tick(deps).finally(() => { running = false; });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return stopWeeklyVideoLoop;
}

export function stopWeeklyVideoLoop(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
