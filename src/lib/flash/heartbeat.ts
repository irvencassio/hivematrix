/**
 * Flash Lane — heartbeat loop (W8 presence layer).
 *
 * The agent's unprompted pulse: every N minutes (default 30) run one flash turn
 * against `persona/HEARTBEAT.md` + a live status snapshot, and let the model
 * decide whether anything is worth doing or telling the operator. Silence is
 * the default — the model stands down with a sentinel token unless something
 * genuinely warrants attention, so the heartbeat never becomes a nagging cron.
 *
 * Autonomy dial (config/autonomy.ts) shapes each pass:
 *   - manual:     observe + report only; no actions beyond read-only checks.
 *   - standard:   routine low-risk actions allowed; outward/risky → report.
 *   - autonomous: act freely inside the lanes' own hard safety gates — no
 *                 extra approval friction is added by the heartbeat itself.
 *
 * Delivery is dependency-injected by the daemon (notify plane + status
 * composer) so flash/ keeps its documented import surface. Reports also land
 * as an assistant turn in the operator console session, so a proactive ping is
 * a conversation the operator can answer, not a fire-and-forget notification.
 *
 * Two daily moments ride the same loop, pinned to hours instead of the
 * interval: a morning brief (opinionated start-of-day standup) and an evening
 * recap ("what I did for you today"). Unlike the pulse they always deliver —
 * APNs push first, notify fallback. This replaces the retired Morning
 * Briefing brand (0.1.111) per NEXT-LEVEL-SPEC W8 without resurrecting it:
 * startMorningBriefingLoop stays unused (see src/daemon/index.test.ts).
 *
 * A THIRD pair of daily moments — the Day Brief ritual (2026-07-10 "system
 * shows up" spec) — rides the exact same tick/config mechanism (no second
 * scheduler): a morning contract + evening ledger, each a deterministic
 * `composeDayBrief()` assembly (day-brief.ts; no model pass, unlike the daily
 * moments above) delivered via `notify()`. It has its own enable flag
 * (`dayBriefEnabled`, default off — matching this file's off-by-default
 * posture) and minute-precision hours (07:30 / 21:00 by default) since the
 * existing daily moments only support whole hours. Idempotence is per local
 * day (`lastDayBriefMorningSentDay`/`lastDayBriefEveningSentDay`, a `YYYY-MM-DD`
 * string) rather than a timestamp compared against a hourly target, the same
 * "mark before send" ordering as the moments above.
 *
 * Two WEEKLY rituals — the Capability Ratchet + Weaver Audit (2026-07-10
 * spec) — clone that same pattern once more, at week granularity: each has
 * its own enable flag (`ratchetEnabled` / `weaverEnabled`, both default off),
 * a fixed day of week (Sunday 18:00 / Friday 17:00 by default, minute-precision
 * hour/minute config like the Day Brief ritual), and its own weekly
 * idempotence key (`lastRatchetSentWeek` / `lastWeaverSentWeek`, an ISO
 * `YYYY-Www` string from `weekKey()` below — a week-granularity sibling of
 * `localDateString()`). The clustering (ratchet.ts) and audit (weaver-audit.ts)
 * logic itself lives in its own module, same split as day-brief.ts; this file
 * only owns the due-check + dispatch + notify/mark-sent wiring.
 *
 * Config (`~/.hivematrix/config.json`):
 *   heartbeat: { enabled, intervalMinutes, quietHours?: {startHour, endHour},
 *                morningBriefHour: number|null, eveningRecapHour: number|null,
 *                lastRunAt?, lastMorningBriefAt?, lastEveningRecapAt?,
 *                dayBriefEnabled, dayBriefMorningHour, dayBriefMorningMinute,
 *                dayBriefEveningHour, dayBriefEveningMinute,
 *                lastDayBriefMorningSentDay?, lastDayBriefEveningSentDay?,
 *                ratchetEnabled, ratchetHour, ratchetMinute, lastRatchetSentWeek?,
 *                weaverEnabled, weaverHour, weaverMinute, lastWeaverSentWeek? }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { getAutonomyLevel, type AutonomyLevel } from "@/lib/config/autonomy";
import { broadcastEvent } from "@/lib/ws/broadcaster";
import { appendTurn, getOrCreateSession } from "./store";
import { READ_ONLY_FLASH_TOOLS } from "./loop";
import { runFlashTurnText } from "./index";
import { startPollLoop } from "@/lib/lanes/poll-loop";
import { composeDayBrief, type DayBriefKind } from "./day-brief";
import { runRatchetPass, type RatchetRunResult } from "./ratchet";
import { composeWeaverAudit } from "./weaver-audit";

export const HEARTBEAT_STAND_DOWN = "HEARTBEAT_STAND_DOWN";

export interface HeartbeatQuietHours {
  startHour: number; // 0-23, inclusive start
  endHour: number;   // 0-23, exclusive end; may wrap midnight (e.g. 22 -> 7)
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMinutes: number;
  quietHours?: HeartbeatQuietHours;
  lastRunAt?: string;
  /** Daily moments — persona-voice scheduled passes. null disables one. */
  morningBriefHour: number | null;   // default 8
  eveningRecapHour: number | null;   // default 21
  lastMorningBriefAt?: string;
  lastEveningRecapAt?: string;
  /** Day Brief ritual (2026-07-10 spec) — deterministic morning contract /
   * evening ledger, independent enable flag, minute-precision hours. */
  dayBriefEnabled: boolean;
  dayBriefMorningHour: number;   // default 7
  dayBriefMorningMinute: number; // default 30
  dayBriefEveningHour: number;   // default 21
  dayBriefEveningMinute: number; // default 0
  lastDayBriefMorningSentDay?: string; // local YYYY-MM-DD
  lastDayBriefEveningSentDay?: string; // local YYYY-MM-DD
  /** Capability Ratchet (2026-07-10 spec) — weekly, Sunday 18:00 by default. */
  ratchetEnabled: boolean;
  ratchetHour: number;   // default 18
  ratchetMinute: number; // default 0
  lastRatchetSentWeek?: string; // ISO YYYY-Www
  /** Weaver Audit (2026-07-10 spec) — weekly, Friday 17:00 by default. */
  weaverEnabled: boolean;
  weaverHour: number;   // default 17
  weaverMinute: number; // default 0
  lastWeaverSentWeek?: string; // ISO YYYY-Www
}

const DEFAULT_INTERVAL_MINUTES = 30;
const MIN_INTERVAL_MINUTES = 5;
const DEFAULT_MORNING_HOUR = 8;
const DEFAULT_EVENING_HOUR = 21;
const DEFAULT_DAY_BRIEF_MORNING_HOUR = 7;
const DEFAULT_DAY_BRIEF_MORNING_MINUTE = 30;
const DEFAULT_DAY_BRIEF_EVENING_HOUR = 21;
const DEFAULT_DAY_BRIEF_EVENING_MINUTE = 0;
const CHECK_INTERVAL_MS = 60_000; // cheap 1-minute due check, same pattern as the readiness sweep

const DEFAULT_RATCHET_HOUR = 18;
const DEFAULT_RATCHET_MINUTE = 0;
const DEFAULT_WEAVER_HOUR = 17;
const DEFAULT_WEAVER_MINUTE = 0;
// JS Date#getDay(): Sunday=0 .. Saturday=6. Fixed per spec — not operator-configurable
// (only the hour/minute are), matching "(default Sunday 18:00 / Friday 17:00)".
const RATCHET_DAY_OF_WEEK = 0; // Sunday
const WEAVER_DAY_OF_WEEK = 5;  // Friday

// The proactive layer (pulse, Day Brief, Capability Ratchet, Weaver Audit) ships
// ON by default (2026-07-12 fix — it was built + tested but never actually
// enabled for new installs). This only affects installs where the `heartbeat`
// config key is entirely absent (see parseHeartbeatConfig's `!input` branch
// below) — an install that has ever called setHeartbeatConfig, including one
// that explicitly turned a flag off, always has that value persisted and is
// unaffected by this default.
const DEFAULT_CONFIG: HeartbeatConfig = {
  enabled: true,
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  morningBriefHour: DEFAULT_MORNING_HOUR,
  eveningRecapHour: DEFAULT_EVENING_HOUR,
  dayBriefEnabled: true,
  dayBriefMorningHour: DEFAULT_DAY_BRIEF_MORNING_HOUR,
  dayBriefMorningMinute: DEFAULT_DAY_BRIEF_MORNING_MINUTE,
  dayBriefEveningHour: DEFAULT_DAY_BRIEF_EVENING_HOUR,
  dayBriefEveningMinute: DEFAULT_DAY_BRIEF_EVENING_MINUTE,
  ratchetEnabled: true,
  ratchetHour: DEFAULT_RATCHET_HOUR,
  ratchetMinute: DEFAULT_RATCHET_MINUTE,
  weaverEnabled: true,
  weaverHour: DEFAULT_WEAVER_HOUR,
  weaverMinute: DEFAULT_WEAVER_MINUTE,
};

function clampHour(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(23, Math.max(0, Math.floor(value)));
}

function clampMinute(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(59, Math.max(0, Math.floor(value)));
}

/** null disables a daily moment; undefined/invalid falls back to the default. */
function parseMomentHour(value: unknown, fallback: number): number | null {
  if (value === null) return null;
  const hour = clampHour(value);
  return hour === null ? fallback : hour;
}

/** Pure: normalize the stored heartbeat config. */
export function parseHeartbeatConfig(input: unknown): HeartbeatConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_CONFIG };
  const obj = input as Record<string, unknown>;
  const rawInterval =
    typeof obj.intervalMinutes === "number" ? Math.floor(obj.intervalMinutes) : DEFAULT_INTERVAL_MINUTES;
  const config: HeartbeatConfig = {
    enabled: obj.enabled === true,
    intervalMinutes: Math.max(MIN_INTERVAL_MINUTES, rawInterval),
    lastRunAt: typeof obj.lastRunAt === "string" ? obj.lastRunAt : undefined,
    morningBriefHour: parseMomentHour(obj.morningBriefHour, DEFAULT_MORNING_HOUR),
    eveningRecapHour: parseMomentHour(obj.eveningRecapHour, DEFAULT_EVENING_HOUR),
    lastMorningBriefAt: typeof obj.lastMorningBriefAt === "string" ? obj.lastMorningBriefAt : undefined,
    lastEveningRecapAt: typeof obj.lastEveningRecapAt === "string" ? obj.lastEveningRecapAt : undefined,
    dayBriefEnabled: obj.dayBriefEnabled === true,
    dayBriefMorningHour: clampHour(obj.dayBriefMorningHour) ?? DEFAULT_DAY_BRIEF_MORNING_HOUR,
    dayBriefMorningMinute: clampMinute(obj.dayBriefMorningMinute) ?? DEFAULT_DAY_BRIEF_MORNING_MINUTE,
    dayBriefEveningHour: clampHour(obj.dayBriefEveningHour) ?? DEFAULT_DAY_BRIEF_EVENING_HOUR,
    dayBriefEveningMinute: clampMinute(obj.dayBriefEveningMinute) ?? DEFAULT_DAY_BRIEF_EVENING_MINUTE,
    lastDayBriefMorningSentDay: typeof obj.lastDayBriefMorningSentDay === "string" ? obj.lastDayBriefMorningSentDay : undefined,
    lastDayBriefEveningSentDay: typeof obj.lastDayBriefEveningSentDay === "string" ? obj.lastDayBriefEveningSentDay : undefined,
    ratchetEnabled: obj.ratchetEnabled === true,
    ratchetHour: clampHour(obj.ratchetHour) ?? DEFAULT_RATCHET_HOUR,
    ratchetMinute: clampMinute(obj.ratchetMinute) ?? DEFAULT_RATCHET_MINUTE,
    lastRatchetSentWeek: typeof obj.lastRatchetSentWeek === "string" ? obj.lastRatchetSentWeek : undefined,
    weaverEnabled: obj.weaverEnabled === true,
    weaverHour: clampHour(obj.weaverHour) ?? DEFAULT_WEAVER_HOUR,
    weaverMinute: clampMinute(obj.weaverMinute) ?? DEFAULT_WEAVER_MINUTE,
    lastWeaverSentWeek: typeof obj.lastWeaverSentWeek === "string" ? obj.lastWeaverSentWeek : undefined,
  };
  if (obj.quietHours && typeof obj.quietHours === "object") {
    const q = obj.quietHours as Record<string, unknown>;
    const startHour = clampHour(q.startHour);
    const endHour = clampHour(q.endHour);
    if (startHour !== null && endHour !== null && startHour !== endHour) {
      config.quietHours = { startHour, endHour };
    }
  }
  return config;
}

/**
 * Pure: is a daily moment (morning brief / evening recap) due? Fires once we
 * reach today's target hour and the last run predates that target.
 */
export function dailyMomentDue(hour: number | null, lastAt: string | undefined, now: Date): boolean {
  if (hour === null) return false;
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  if (now < target) return false;
  if (!lastAt) return true;
  return new Date(lastAt) < target;
}

export function getHeartbeatConfig(): HeartbeatConfig {
  return parseHeartbeatConfig(loadHiveConfig().heartbeat);
}

export function setHeartbeatConfig(patch: Partial<HeartbeatConfig>): HeartbeatConfig {
  const config = loadHiveConfig();
  const current = getHeartbeatConfig();
  const next = parseHeartbeatConfig({ ...current, ...patch });
  // Enabling seeds the daily-moment markers to "now": moments start at their
  // NEXT scheduled hour instead of firing a stale "morning brief" (followed one
  // tick later by the recap) the evening the feature is switched on.
  if (next.enabled && !current.enabled) {
    const nowIso = new Date().toISOString();
    if (!("lastMorningBriefAt" in patch)) next.lastMorningBriefAt = current.lastMorningBriefAt ?? nowIso;
    if (!("lastEveningRecapAt" in patch)) next.lastEveningRecapAt = current.lastEveningRecapAt ?? nowIso;
  }
  // Same seeding rationale for the Day Brief ritual: enabling it mid-evening
  // must not immediately fire the morning contract from a stale/absent marker.
  if (next.dayBriefEnabled && !current.dayBriefEnabled) {
    const today = localDateString(new Date());
    if (!("lastDayBriefMorningSentDay" in patch)) next.lastDayBriefMorningSentDay = current.lastDayBriefMorningSentDay ?? today;
    if (!("lastDayBriefEveningSentDay" in patch)) next.lastDayBriefEveningSentDay = current.lastDayBriefEveningSentDay ?? today;
  }
  // Same seeding rationale, week-granularity: enabling Ratchet/Weaver must not
  // immediately fire this week's pass from a stale/absent marker.
  if (next.ratchetEnabled && !current.ratchetEnabled) {
    const week = weekKey(new Date());
    if (!("lastRatchetSentWeek" in patch)) next.lastRatchetSentWeek = current.lastRatchetSentWeek ?? week;
  }
  if (next.weaverEnabled && !current.weaverEnabled) {
    const week = weekKey(new Date());
    if (!("lastWeaverSentWeek" in patch)) next.lastWeaverSentWeek = current.lastWeaverSentWeek ?? week;
  }
  config.heartbeat = next;
  saveHiveConfig(config);
  return next;
}

/** Pure: local (not UTC) `YYYY-MM-DD` for a Date — the Day Brief ritual's
 * once-per-day idempotence key. */
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Pure: is a Day Brief ritual moment (morning contract / evening ledger) due?
 * Minute-precision sibling of `dailyMomentDue` above — fires once we reach
 * today's target hour:minute and it hasn't already been sent today (a
 * day-string comparison, not a timestamp one, since the ritual can be minutes
 * off the hour and a restart just after firing must not double-send).
 */
export function dayBriefMomentDue(hour: number, minute: number, lastSentDay: string | undefined, now: Date): boolean {
  if (lastSentDay === localDateString(now)) return false;
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  return now >= target;
}

/**
 * Pure: local ISO-8601 week string (`YYYY-Www`, Monday-start, Thursday-anchored)
 * for a Date — the weekly rituals' (Ratchet/Weaver) once-per-week idempotence
 * key, the week-granularity sibling of `localDateString()`. Computed entirely
 * from local calendar fields (no UTC conversion) so it agrees with the local
 * `now` the rest of this file reasons about.
 */
export function weekKey(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayNum = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - dayNum + 3); // Thursday of this ISO week
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  const weekNo = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Pure: is a weekly ritual (Ratchet / Weaver) moment due? Fires once we reach
 * the configured day-of-week (`Date#getDay()` convention: Sun=0..Sat=6) at
 * its target hour:minute, and it hasn't already been sent this ISO week —
 * the week-granularity sibling of `dayBriefMomentDue` above.
 */
export function weeklyMomentDue(dayOfWeek: number, hour: number, minute: number, lastSentWeek: string | undefined, now: Date): boolean {
  if (now.getDay() !== dayOfWeek) return false;
  if (lastSentWeek === weekKey(now)) return false;
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  return now >= target;
}

/** Pure: is `now` inside the quiet window? Handles wrap-around (22 -> 7). */
export function inQuietHours(quiet: HeartbeatQuietHours | undefined, now: Date): boolean {
  if (!quiet) return false;
  const hour = now.getHours();
  return quiet.startHour < quiet.endHour
    ? hour >= quiet.startHour && hour < quiet.endHour
    : hour >= quiet.startHour || hour < quiet.endHour;
}

/** Pure: should a heartbeat pass fire now? */
export function heartbeatDue(config: HeartbeatConfig, now: Date = new Date()): boolean {
  if (!config.enabled) return false;
  if (inQuietHours(config.quietHours, now)) return false;
  if (!config.lastRunAt) return true;
  const elapsed = now.getTime() - new Date(config.lastRunAt).getTime();
  return elapsed >= config.intervalMinutes * 60_000;
}

// ------------------------------------------------------------------
// Checklist seed + prompt assembly
// ------------------------------------------------------------------

const DEFAULT_CHECKLIST = `# Heartbeat checklist

The heartbeat runs this checklist on its own schedule. This file is yours —
edit it as your standing "when idle, care about these" list.

- Anything failed, stuck, or waiting for input that the operator hasn't been told about?
- Any pending approval sitting unanswered for hours?
- Anything in today's daily note that needs follow-up?
- Anything on WISHLIST.md worth an opportunistic check?
- Goals: run daily_review (or goals_list). For a goal that's due/overdue or has
  gone cold, is there ONE concrete next step the operator could do in under 30
  minutes? If so, name that single step — not the whole goal. Favour the one with
  the most momentum to keep (a live streak) or the most at risk of slipping.

Message the operator only when it is genuinely useful — at most one goal nudge
per pulse, and don't repeat a nudge the operator already saw today. Silence is fine.
`;

/** Ensure persona/HEARTBEAT.md exists; seed the default checklist if missing. Returns its content. */
export function ensureHeartbeatChecklist(brainRoot: string): string {
  const dir = join(brainRoot, "persona");
  const path = join(dir, "HEARTBEAT.md");
  try {
    if (!existsSync(path)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, DEFAULT_CHECKLIST, "utf-8");
      return DEFAULT_CHECKLIST;
    }
    return readFileSync(path, "utf-8").slice(0, 6000);
  } catch {
    return DEFAULT_CHECKLIST;
  }
}

const AUTONOMY_GUIDANCE: Record<AutonomyLevel, string> = {
  manual:
    "Autonomy is MANUAL: observe and report only. Use read-only tools (inbox, search, status); " +
    "take no action that changes anything. Anything actionable belongs in your report as a proposal.",
  standard:
    "Autonomy is STANDARD: you may handle routine, low-risk items yourself. Anything outward-facing " +
    "(mail, messages to others), destructive, or unusual belongs in your report as a proposal instead.",
  autonomous:
    "Autonomy is AUTONOMOUS: act on what is genuinely useful without asking first. Your tools carry " +
    "their own hard safety gates (trust classification, protected actions); do not add extra approval " +
    "friction on top of them. Report what you did rather than what you plan.",
};

/** Pure: build the heartbeat prompt for one pass. */
export function buildHeartbeatPrompt(opts: {
  checklist: string;
  statusSnapshot: string;
  autonomy: AutonomyLevel;
  now?: Date;
}): string {
  const ts = (opts.now ?? new Date()).toISOString();
  return [
    `[Heartbeat ${ts}] This is your scheduled unprompted pass — no one sent a message.`,
    `Work through your checklist against the current status. ${AUTONOMY_GUIDANCE[opts.autonomy]}`,
    "",
    "## Your checklist (persona/HEARTBEAT.md)",
    opts.checklist.trim(),
    "",
    "## Current status snapshot",
    opts.statusSnapshot.trim() || "(no status available)",
    "",
    "## Reporting rule",
    "Check the conversation history first: do not repeat a report you already made — only changes are news.",
    "If something is genuinely worth the operator's attention (something you did, found, or need), reply with a short message addressed to them.",
    `If there is nothing worth saying, reply with exactly: ${HEARTBEAT_STAND_DOWN}`,
    "Never send filler updates. Silence is the default outcome.",
  ].join("\n");
}

/** Pure: extract the operator-facing report from a heartbeat reply; null = stood down. */
export function extractHeartbeatReport(reply: string): string | null {
  const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!cleaned) return null;
  if (cleaned.includes(HEARTBEAT_STAND_DOWN)) return null;
  return cleaned;
}

export type DailyMoment = "morning-brief" | "evening-recap";

/**
 * Pure: build the prompt for a daily moment. Unlike the pulse, these always
 * produce a message — the persona-voice brief/recap is the point.
 */
export function buildDailyMomentPrompt(opts: {
  moment: DailyMoment;
  statusSnapshot: string;
  now?: Date;
}): string {
  const ts = (opts.now ?? new Date()).toISOString();
  const shared = [
    "",
    "## Current status snapshot",
    opts.statusSnapshot.trim() || "(no status available)",
    "",
    "Write in your own persona voice, addressed directly to the operator. Be concise and concrete —",
    "a few short paragraphs or tight bullets, no headers, no filler, no restating raw numbers you were given",
    "unless they matter. This message is always delivered (no stand-down).",
  ];
  if (opts.moment === "morning-brief") {
    return [
      `[Morning brief ${ts}] This is your scheduled morning brief — no one sent a message.`,
      "Give the operator an opinionated start-of-day brief:",
      "1. What happened since yesterday evening (completed, failed, still running).",
      "2. What is blocked or waiting on them — and the ONE decision that matters most today.",
      "3. What you suggest doing today, in priority order, tied to their goals where you know them.",
      ...shared,
    ].join("\n");
  }
  return [
    `[Evening recap ${ts}] This is your scheduled end-of-day recap — no one sent a message.`,
    "Tell the operator what you did for them today, in your own voice:",
    "1. What you accomplished (from the status, today's daily note, and your own history).",
    "2. Anything you tried that failed or needs their input tomorrow.",
    "3. One thing you noticed that they might not have.",
    ...shared,
  ].join("\n");
}

// ------------------------------------------------------------------
// One pass + loop
// ------------------------------------------------------------------

export interface HeartbeatDeps {
  /** Outbound notify plane — injected by the daemon (flash/ does not import notify/). */
  notify?: (text: string) => Promise<unknown>;
  /** Compact operator standup used as the status snapshot — daemon wires composeBriefing. */
  composeStatus?: () => Promise<string>;
  /** Surface a report as an assistant turn in the operator console session. */
  appendOperatorTurn?: (text: string) => void;
  /** Push for daily moments — daemon wires notify/push. */
  sendPush?: (opts: { title: string; body: string; data?: Record<string, unknown> }) => Promise<{ sent: number }>;
  runTurn?: typeof runFlashTurnText;
  /** Day Brief assembly (day-brief.ts) — injectable for tests; defaults to the real one. */
  composeDayBrief?: typeof composeDayBrief;
  /** Capability Ratchet weekly pass (ratchet.ts) — injectable for tests; defaults to the real one. */
  runRatchetPass?: typeof runRatchetPass;
  /** Weaver Audit weekly pass (weaver-audit.ts) — injectable for tests; defaults to the real one. */
  composeWeaverAudit?: typeof composeWeaverAudit;
  now?: () => Date;
}

function defaultAppendOperatorTurn(text: string): void {
  const operatorSession = getOrCreateSession("console", "operator");
  appendTurn(operatorSession.id, "assistant", text);
}

/**
 * Pure: which tools a heartbeat pulse may use at each autonomy level. Returns
 * undefined for autonomous (full set — lane gates still apply inside).
 */
export function heartbeatToolFilter(autonomy: AutonomyLevel): ((name: string) => boolean) | undefined {
  if (autonomy === "autonomous") return undefined;
  if (autonomy === "standard") {
    return (name) => READ_ONLY_FLASH_TOOLS.has(name) || name === "escalate_to_task";
  }
  return (name) => READ_ONLY_FLASH_TOOLS.has(name); // manual: observe only
}

export interface HeartbeatRunResult {
  ran: boolean;
  stoodDown: boolean;
  report: string | null;
  sessionId?: string;
}

/**
 * Run one heartbeat pass immediately (used by the loop and POST /heartbeat/run).
 * The turn runs in the dedicated heartbeat session (history = dedup memory);
 * a non-stand-down report is notified AND appended to the operator console
 * session so the operator can reply to it in place.
 */
export async function runHeartbeatOnce(deps: HeartbeatDeps = {}): Promise<HeartbeatRunResult> {
  const brainRoot = configuredBrainRootDir();
  if (!brainRoot) return { ran: false, stoodDown: false, report: null };

  const now = (deps.now ?? (() => new Date()))();
  const checklist = ensureHeartbeatChecklist(brainRoot);
  let statusSnapshot = "";
  try {
    statusSnapshot = deps.composeStatus ? await deps.composeStatus() : "";
  } catch { /* snapshot is best-effort */ }

  const autonomy = getAutonomyLevel();
  const prompt = buildHeartbeatPrompt({
    checklist,
    statusSnapshot,
    autonomy,
    now,
  });

  const runTurn = deps.runTurn ?? runFlashTurnText;
  const result = await runTurn({
    text: prompt,
    channel: "console",
    peer: "heartbeat",
    // HARD tool gate (the prompt guidance alone is not a guarantee — the prompt
    // embeds operator-editable and inbound-derived text): manual = read-only
    // observation; standard = read-only + propose work; autonomous = full set
    // (the lanes' own trust/protected-action gates still apply inside).
    allowedTools: heartbeatToolFilter(autonomy),
  });
  const report = extractHeartbeatReport(result.reply);

  // The heartbeat session never goes idle while enabled — without pruning its
  // turns (each carrying the full prompt) grow forever.
  try {
    const { pruneSessionTurns } = await import("./store");
    pruneSessionTurns(result.sessionId, 100);
  } catch { /* best effort */ }

  if (report === null) {
    broadcastEvent("flash:heartbeat", { stoodDown: true, ts: now.toISOString() });
    return { ran: true, stoodDown: true, report: null, sessionId: result.sessionId };
  }

  // Surface the report as a replyable turn in the operator's console session.
  try {
    (deps.appendOperatorTurn ?? defaultAppendOperatorTurn)(report);
  } catch { /* best effort — notify still goes out */ }

  if (deps.notify) {
    try { await deps.notify(`💓 ${report}`); } catch { /* channels are best-effort */ }
  }
  broadcastEvent("flash:heartbeat", { stoodDown: false, report, ts: now.toISOString() });
  return { ran: true, stoodDown: false, report, sessionId: result.sessionId };
}

/**
 * Run one daily moment (morning brief / evening recap) immediately. Always
 * delivers: APNs push first (when wired), then notify fallback, and the text
 * lands as a replyable operator-session turn either way.
 */
export async function runDailyMomentOnce(
  moment: DailyMoment,
  deps: HeartbeatDeps = {},
): Promise<{ text: string; pushed: number }> {
  const now = (deps.now ?? (() => new Date()))();
  let statusSnapshot = "";
  try {
    statusSnapshot = deps.composeStatus ? await deps.composeStatus() : "";
  } catch { /* snapshot is best-effort */ }

  const prompt = buildDailyMomentPrompt({ moment, statusSnapshot, now });
  const runTurn = deps.runTurn ?? runFlashTurnText;
  const result = await runTurn({
    text: prompt,
    channel: "console",
    peer: "heartbeat",
    // Daily moments are reports, not action passes — read-only tools always.
    allowedTools: (name) => READ_ONLY_FLASH_TOOLS.has(name),
  });
  const text = result.reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || statusSnapshot || "(no report)";

  try {
    (deps.appendOperatorTurn ?? defaultAppendOperatorTurn)(text);
  } catch { /* best effort */ }

  const title = moment === "morning-brief" ? "Morning brief" : "Evening recap";
  let pushed = 0;
  if (deps.sendPush) {
    try {
      pushed = (await deps.sendPush({ title, body: text, data: { kind: moment } })).sent;
    } catch { /* fall through to notify */ }
  }
  if (pushed === 0 && deps.notify) {
    const icon = moment === "morning-brief" ? "☀️" : "🌙";
    try { await deps.notify(`${icon} ${title}\n${text}`); } catch { /* best effort */ }
  }
  broadcastEvent("flash:heartbeat", { moment, report: text, ts: now.toISOString() });
  // Mark the moment as run so a manual send (console button / POST /heartbeat/run)
  // isn't followed by the scheduled one the same day.
  try {
    setHeartbeatConfig(
      moment === "morning-brief"
        ? { lastMorningBriefAt: now.toISOString() }
        : { lastEveningRecapAt: now.toISOString() },
    );
  } catch { /* best effort */ }
  return { text, pushed };
}

/**
 * Run one Day Brief ritual moment (morning contract / evening ledger)
 * immediately: a deterministic `composeDayBrief()` assembly (no model pass)
 * delivered via `notify()`. Unlike `runDailyMomentOnce`, there is no APNs
 * push or operator-session turn — this is a short ritual text, not a report.
 */
export async function runDayBriefRitualOnce(
  kind: DayBriefKind,
  deps: HeartbeatDeps = {},
): Promise<{ text: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const compose = deps.composeDayBrief ?? composeDayBrief;
  const text = await compose(kind);

  if (deps.notify) {
    try { await deps.notify(text); } catch { /* channels are best-effort */ }
  }
  broadcastEvent("flash:day-brief", { kind, text, ts: now.toISOString() });
  // Mark sent so a manual fire (POST /heartbeat/run) isn't followed by the
  // scheduled one the same day — same "mark so a duplicate can't follow" intent
  // as runDailyMomentOnce's own end-of-run mark above.
  try {
    setHeartbeatConfig(
      kind === "morning"
        ? { lastDayBriefMorningSentDay: localDateString(now) }
        : { lastDayBriefEveningSentDay: localDateString(now) },
    );
  } catch { /* best effort */ }
  return { text };
}

/**
 * Run one Capability Ratchet weekly pass immediately: fetch + cluster + (unless
 * zero escalations) create the proposal task, then `notify()` the result.
 * Unlike the Day Brief ritual there is no APNs push or operator-session turn —
 * this is a proposal notice, not a report. Zero escalations is a silent no-op
 * (no notify call at all), per spec.
 */
export async function runRatchetOnce(deps: HeartbeatDeps = {}): Promise<RatchetRunResult> {
  const now = (deps.now ?? (() => new Date()))();
  const runPass = deps.runRatchetPass ?? runRatchetPass;
  const result = await runPass();

  if (result.notifyText && deps.notify) {
    try { await deps.notify(result.notifyText); } catch { /* channels are best-effort */ }
  }
  broadcastEvent("flash:ratchet", { created: result.created, ts: now.toISOString() });
  return result;
}

/**
 * Run one Weaver Audit weekly pass immediately: assemble commitments vs
 * activity, one model pass, `notify()` the result prefixed "🌀 Weaver weekly:".
 * A null result (no signal to audit, empty reply, or model failure) sends
 * NOTHING — no fallback, no operator-session turn, no APNs.
 */
export async function runWeaverOnce(deps: HeartbeatDeps = {}): Promise<{ text: string | null }> {
  const now = (deps.now ?? (() => new Date()))();
  const compose = deps.composeWeaverAudit ?? composeWeaverAudit;
  const text = await compose();

  if (text && deps.notify) {
    try { await deps.notify(`🌀 Weaver weekly:\n${text}`); } catch { /* channels are best-effort */ }
  }
  broadcastEvent("flash:weaver", { sent: text !== null, ts: now.toISOString() });
  return { text };
}

/**
 * Day Brief ritual due-check + dispatch — folded into the shared tick so
 * there's no second scheduler. Independent of `config.enabled` (the
 * pulse/daily-moment toggle): the ritual has its own `dayBriefEnabled` flag.
 */
async function tickDayBriefRitual(config: HeartbeatConfig, now: Date, deps: HeartbeatDeps): Promise<void> {
  if (!config.dayBriefEnabled) return;

  if (dayBriefMomentDue(config.dayBriefMorningHour, config.dayBriefMorningMinute, config.lastDayBriefMorningSentDay, now)) {
    setHeartbeatConfig({ lastDayBriefMorningSentDay: localDateString(now) });
    try {
      await runDayBriefRitualOnce("morning", deps);
      console.log("[heartbeat] day-brief morning contract delivered");
    } catch (e) {
      console.error(`[heartbeat] day-brief morning contract failed: ${e instanceof Error ? e.message : e}`);
    }
    return;
  }
  if (dayBriefMomentDue(config.dayBriefEveningHour, config.dayBriefEveningMinute, config.lastDayBriefEveningSentDay, now)) {
    setHeartbeatConfig({ lastDayBriefEveningSentDay: localDateString(now) });
    try {
      await runDayBriefRitualOnce("evening", deps);
      console.log("[heartbeat] day-brief evening ledger delivered");
    } catch (e) {
      console.error(`[heartbeat] day-brief evening ledger failed: ${e instanceof Error ? e.message : e}`);
    }
    return;
  }
}

/**
 * Capability Ratchet due-check + dispatch — same "own enable flag, folded into
 * the shared tick" shape as `tickDayBriefRitual`, at week granularity.
 */
async function tickRatchet(config: HeartbeatConfig, now: Date, deps: HeartbeatDeps): Promise<void> {
  if (!config.ratchetEnabled) return;
  if (!weeklyMomentDue(RATCHET_DAY_OF_WEEK, config.ratchetHour, config.ratchetMinute, config.lastRatchetSentWeek, now)) return;

  // Mark BEFORE the pass so a slow model call can't double-fire later this week.
  setHeartbeatConfig({ lastRatchetSentWeek: weekKey(now) });
  try {
    const result = await runRatchetOnce(deps);
    console.log(`[heartbeat] capability ratchet pass complete (created=${result.created})`);
  } catch (e) {
    console.error(`[heartbeat] capability ratchet pass failed: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Weaver Audit due-check + dispatch — same shape as `tickRatchet`.
 */
async function tickWeaver(config: HeartbeatConfig, now: Date, deps: HeartbeatDeps): Promise<void> {
  if (!config.weaverEnabled) return;
  if (!weeklyMomentDue(WEAVER_DAY_OF_WEEK, config.weaverHour, config.weaverMinute, config.lastWeaverSentWeek, now)) return;

  // Mark BEFORE the pass so a slow model call can't double-fire later this week.
  setHeartbeatConfig({ lastWeaverSentWeek: weekKey(now) });
  try {
    const result = await runWeaverOnce(deps);
    console.log(`[heartbeat] weaver audit pass complete (sent=${result.text !== null})`);
  } catch (e) {
    console.error(`[heartbeat] weaver audit pass failed: ${e instanceof Error ? e.message : e}`);
  }
}

let stopFn: (() => void) | null = null;

async function tick(deps: HeartbeatDeps): Promise<void> {
  const config = getHeartbeatConfig();
  const now = (deps.now ?? (() => new Date()))();

  // Day Brief ritual — own enable flag, runs regardless of the pulse toggle.
  await tickDayBriefRitual(config, now, deps);
  // Capability Ratchet + Weaver Audit — own enable flags, weekly, likewise
  // independent of the pulse toggle.
  await tickRatchet(config, now, deps);
  await tickWeaver(config, now, deps);

  if (!config.enabled) return;

  // Daily moments take precedence over the pulse and ignore quiet hours —
  // they are pinned to explicit hours the operator chose.
  if (dailyMomentDue(config.morningBriefHour, config.lastMorningBriefAt, now)) {
    setHeartbeatConfig({ lastMorningBriefAt: now.toISOString() });
    try {
      const { pushed } = await runDailyMomentOnce("morning-brief", deps);
      console.log(`[heartbeat] morning brief delivered (apns=${pushed})`);
    } catch (e) {
      console.error(`[heartbeat] morning brief failed: ${e instanceof Error ? e.message : e}`);
    }
    return;
  }
  if (dailyMomentDue(config.eveningRecapHour, config.lastEveningRecapAt, now)) {
    setHeartbeatConfig({ lastEveningRecapAt: now.toISOString() });
    try {
      const { pushed } = await runDailyMomentOnce("evening-recap", deps);
      console.log(`[heartbeat] evening recap delivered (apns=${pushed})`);
    } catch (e) {
      console.error(`[heartbeat] evening recap failed: ${e instanceof Error ? e.message : e}`);
    }
    return;
  }

  if (!heartbeatDue(config, now)) return;

  // Mark BEFORE the pass so a slow model call can't double-fire the next tick.
  setHeartbeatConfig({ lastRunAt: now.toISOString() });
  try {
    const result = await runHeartbeatOnce(deps);
    console.log(
      `[heartbeat] pass complete (stoodDown=${result.stoodDown}${result.report ? `, report=${result.report.slice(0, 80)}` : ""})`,
    );
  } catch (e) {
    console.error(`[heartbeat] pass failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** Start the heartbeat loop (idempotent). Self-gates on config. Returns a stop fn. */
export function startHeartbeatLoop(deps: HeartbeatDeps = {}, intervalMs = CHECK_INTERVAL_MS): () => void {
  if (stopFn) return stopHeartbeatLoop;
  stopFn = startPollLoop({ name: "heartbeat", intervalMs, tick: () => tick(deps) });
  return stopHeartbeatLoop;
}

export function stopHeartbeatLoop(): void {
  if (stopFn) { stopFn(); stopFn = null; }
}
