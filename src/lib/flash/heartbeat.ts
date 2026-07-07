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
 * Config (`~/.hivematrix/config.json`):
 *   heartbeat: { enabled, intervalMinutes, quietHours?: {startHour, endHour},
 *                morningBriefHour: number|null, eveningRecapHour: number|null,
 *                lastRunAt?, lastMorningBriefAt?, lastEveningRecapAt? }
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
}

const DEFAULT_INTERVAL_MINUTES = 30;
const MIN_INTERVAL_MINUTES = 5;
const DEFAULT_MORNING_HOUR = 8;
const DEFAULT_EVENING_HOUR = 21;
const CHECK_INTERVAL_MS = 60_000; // cheap 1-minute due check, same pattern as the readiness sweep

const DEFAULT_CONFIG: HeartbeatConfig = {
  enabled: false,
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  morningBriefHour: DEFAULT_MORNING_HOUR,
  eveningRecapHour: DEFAULT_EVENING_HOUR,
};

function clampHour(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(23, Math.max(0, Math.floor(value)));
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
  config.heartbeat = next;
  saveHiveConfig(config);
  return next;
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

Message the operator only when it is genuinely useful. Silence is fine.
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
  /** APNs push for daily moments — daemon wires notify/apns. */
  sendApnsPush?: (opts: { title: string; body: string; data?: Record<string, unknown> }) => Promise<{ sent: number }>;
  runTurn?: typeof runFlashTurnText;
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
  if (deps.sendApnsPush) {
    try {
      pushed = (await deps.sendApnsPush({ title, body: text, data: { kind: moment } })).sent;
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

let stopFn: (() => void) | null = null;

async function tick(deps: HeartbeatDeps): Promise<void> {
  const config = getHeartbeatConfig();
  if (!config.enabled) return;
  const now = (deps.now ?? (() => new Date()))();

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
