/**
 * Voice command intent — the "Jarvis" layer for push-to-talk. Turns a spoken
 * utterance into a structured command over the daemon's real capabilities (board,
 * approvals, directives, tasks, connectivity) so voice can DRIVE the system, not
 * just chat. Pure + deterministic (no LLM round-trip), fully unit-tested; the IO
 * glue that reads state / performs actions / synthesizes the spoken reply lives in
 * command-turn.ts. Mirrors the skill-intent.ts pattern.
 *
 * Detection runs BEFORE the LLM reply; an unmatched utterance returns {kind:"none"}
 * and falls through to the conversational answer.
 */

import { detectVoiceBrowserLaneIntent, type VoiceBrowserLaneIntent } from "./browser-lane-intent";
import { detectVoiceMailDeleteIntent, type VoiceMailDeleteIntent } from "./mail-delete-intent";

export type ConnMode = "cloud-ok" | "local-only" | "offline" | "auto";

export type CommandKind =
  | "board"            // "what's on my board" — counts by lane
  | "approvalsList"    // "anything to approve" — pending queue summary
  | "approve"          // "approve it / approve the first one" — resolve latest
  | "deny"             // "deny that / reject it"
  | "directives"       // "what are my directives"
  | "briefing"          // "good morning / brief me" — operator standup
  | "usage"             // "usage" — frontier usage summary
  | "analytics"         // "analytics" — metrics summary
  | "retryFailedTask"   // "retry failed task" — retry latest failed task
  | "setTaskModel"      // "set task abc to qwen" — update task model
  | "startDirective"    // "start directive X" — activate directive
  | "pauseDirective"    // "pause directive X" — pause directive
  | "triggerReleaseVerification" // "trigger release verification"
  | "browserLaneTask"  // "use Browser Lane to search/read/open ..."
  | "mailDeleteTask"   // "delete/trash email ..." — queue review, never deletes immediately
  | "weather"          // "what's the weather today" — answered inline from saved location
  | "scheduledReminder" // "remind me at 5:35 PM to <X>" — delayed HiveMatrix task
  | "createTask"       // "create a task to <X>" / "remind me to <X>"
  | "connectivity"     // "are we online / connectivity status"
  | "setConnectivity"  // "go offline / cloud only / go local / auto"
  | "none";

export interface CommandIntent {
  kind: CommandKind;
  taskText?: string;   // createTask
  mode?: ConnMode;     // setConnectivity
  ordinal?: number;    // approve / deny target, 1-based
  taskRef?: string;    // setTaskModel target
  model?: string;      // setTaskModel model id / alias
  directiveText?: string; // startDirective / pauseDirective target
  browserLane?: VoiceBrowserLaneIntent;
  mailDelete?: VoiceMailDeleteIntent;
  weatherWhen?: "today" | "tomorrow"; // weather
  weatherCity?: string;               // weather — inline city override
  reminderWhenText?: string;           // scheduledReminder
  reminderText?: string;               // scheduledReminder
}

const CITY_STOPWORDS = new Set([
  "morning", "afternoon", "evening", "night", "tonight", "the future", "future",
  "winter", "summer", "spring", "fall", "autumn", "celsius", "fahrenheit", "here",
  "town", "general", "particular", "fact", "my area", "the area", "a bit", "a while",
  "an hour", "a minute", "a sec", "a second",
]);

/** Extract an inline "weather in <city>" override, rejecting time-of-day phrases. */
export function extractWeatherCity(orig: string): string | undefined {
  const m = orig.match(/\bin\s+(.+?)\s*[.?!]*$/i);
  if (!m) return undefined;
  let cand = m[1].trim().replace(/^the\s+/i, "");
  cand = cand.replace(/\s+(today|tomorrow|tonight|right now|now|please|this week|this weekend)$/i, "").trim();
  if (!cand || /^(a|an)\b/i.test(cand) || !/[A-Za-z]/.test(cand)) return undefined;
  if (CITY_STOPWORDS.has(cand.toLowerCase())) return undefined;
  return cand;
}

/** Detect a weather request and whether it's about today or tomorrow/forecast. */
export function detectWeatherIntent(text: string): CommandIntent | null {
  const t = (text || "").toLowerCase().trim();
  const isWeather =
    /\bweather\b/.test(t) ||
    /\bforecast\b/.test(t) ||
    /\bumbrella\b/.test(t) ||
    /\bhow\s+(cold|hot|warm|chilly|windy)\s+is\s+it\b/.test(t) ||
    /\b(is it|will it|is it going to|gonna)\s+rain\b/.test(t) ||
    /\btemperature\s+(outside|today|tomorrow|right now|now)\b/.test(t);
  if (!isWeather) return null;
  const weatherWhen: "today" | "tomorrow" =
    /\btomorrow\b/.test(t) ? "tomorrow" :
    /\b(today|tonight|right now|currently|outside|now)\b/.test(t) ? "today" :
    /\bforecast\b/.test(t) ? "tomorrow" :
    "today";
  const city = extractWeatherCity((text || "").trim());
  return { kind: "weather", weatherWhen, ...(city ? { weatherCity: city } : {}) };
}

const clean = (s: string) => s.replace(/[.?!,\s]+$/g, "").trim();

function detectScheduledReminder(orig: string): CommandIntent | null {
  const time = String.raw`([0-9]{1,2}(?::[0-9]{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)`;
  const match = orig.match(new RegExp(String.raw`\bremind me\s+(?:at|for)\s+${time}\s+(?:to\s+)?(.+)$`, "i"));
  if (!match) return null;
  const reminderWhenText = clean(match[1]);
  const reminderText = clean(match[2]);
  if (!reminderWhenText || !reminderText) return null;
  return { kind: "scheduledReminder", reminderWhenText, reminderText };
}

const ORDINAL_WORDS: Array<[string, number]> = [
  ["first", 1],
  ["second", 2],
  ["third", 3],
  ["fourth", 4],
  ["fifth", 5],
  ["sixth", 6],
  ["seventh", 7],
  ["eighth", 8],
  ["ninth", 9],
  ["tenth", 10],
];

const CARDINAL_WORDS: Array<[string, number]> = [
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
];

export function parseOrdinal(text: string): number | undefined {
  const t = (text || "").toLowerCase();
  for (const [word, value] of ORDINAL_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(t)) return value;
  }
  const numeric = t.match(/\b(?:number|option|item)?\s*([1-9][0-9]*)(?:st|nd|rd|th)?\b/);
  if (numeric) return Number(numeric[1]);
  for (const [word, value] of CARDINAL_WORDS) {
    if (new RegExp(`\\b(?:number|option|item)\\s+${word}\\b`).test(t)) return value;
  }
  return undefined;
}

/** Detect a system command in a spoken utterance. Pure; order = specific first. */
export function detectCommandIntent(text: string): CommandIntent {
  const t = (text || "").toLowerCase().trim();
  if (!t) return { kind: "none" };
  const orig = (text || "").trim();

  const browserLane = detectVoiceBrowserLaneIntent(orig);
  if (browserLane) return { kind: "browserLaneTask", browserLane };

  const mailDelete = detectVoiceMailDeleteIntent(orig);
  if (mailDelete) return { kind: "mailDeleteTask", mailDelete };

  // --- Jarvis V2 operator intents ---
  if (/\b(good morning|brief me|briefing|morning briefing|what needs me|what needs my attention|standup|status briefing)\b/.test(t)) {
    return { kind: "briefing" };
  }
  if (/^(usage|frontier usage|model usage)$/.test(t) || /\b(usage|spend|token|tokens|cost)\s+(status|summary|report)?\b/.test(t)) {
    return { kind: "usage" };
  }
  if (/^(analytics|metrics)$/.test(t) || /\b(show|open|read|summarize)\s+(analytics|metrics)\b/.test(t)) {
    return { kind: "analytics" };
  }
  if (/\bretry\b.*\bfailed\s+task\b/.test(t) || /\b(retry|rerun)\s+(the\s+)?last\s+failed\b/.test(t)) {
    return { kind: "retryFailedTask" };
  }
  const setTaskModel = orig.match(/\bset\s+task\s+([^\s]+)(?:\s+model)?\s+(?:to|as|on)\s+([^\s.?!,]+)\b/i)
    ?? orig.match(/\buse\s+([^\s.?!,]+)\s+for\s+task\s+([^\s]+)\b/i);
  if (setTaskModel) {
    const useForm = /^use\b/i.test(setTaskModel[0]);
    return {
      kind: "setTaskModel",
      taskRef: clean(useForm ? setTaskModel[2] : setTaskModel[1]),
      model: clean(useForm ? setTaskModel[1] : setTaskModel[2]),
    };
  }
  const directiveAction = orig.match(/\b(start|resume|activate|pause|stop|sleep)\s+(?:the\s+)?directive\s+(.+)$/i);
  if (directiveAction && clean(directiveAction[2])) {
    const action = directiveAction[1].toLowerCase();
    return {
      kind: action === "pause" || action === "stop" || action === "sleep" ? "pauseDirective" : "startDirective",
      directiveText: clean(directiveAction[2]),
    };
  }
  if (/\b(trigger|run|start|queue)\b.*\brelease\s+verification\b/.test(t) || /\brelease:verify\b/.test(t)) {
    return { kind: "triggerReleaseVerification" };
  }

  // --- Connectivity SET (verbs) — before the query form ---
  if (/\b(go|switch to|set)\b.*\boffline\b/.test(t) || /^offline$/.test(t)) return { kind: "setConnectivity", mode: "offline" };
  if (/\b(go|switch to|set)\b.*\b(local[\s-]?only|local)\b/.test(t)) return { kind: "setConnectivity", mode: "local-only" };
  if (/\b(go|switch to|set|back)\b.*\b(online|cloud([\s-]?ok)?)\b/.test(t) || /\bcloud[\s-]?ok\b/.test(t)) return { kind: "setConnectivity", mode: "cloud-ok" };
  if (/\b(automatic|auto)\b.*\bconnectivity\b/.test(t) || /\bconnectivity\b.*\bauto(matic)?\b/.test(t)) return { kind: "setConnectivity", mode: "auto" };

  // --- Connectivity QUERY ---
  if (/\b(connectivity|are we online|am i online|are we connected|connection status|what mode)\b/.test(t)) return { kind: "connectivity" };

  // --- Create task / reminder (verb forms). Match case-insensitively but extract
  // the task text from the ORIGINAL string so the title keeps its capitalization.
  const scheduledReminder = detectScheduledReminder(orig);
  if (scheduledReminder) return scheduledReminder;

  const taskMatch = orig.match(/\b(?:create|add|make|new|start|open|queue)\s+(?:a\s+|an\s+|another\s+)?task\b(?:\s+(?:to|that|for|about|:|-))?\s*(.+)$/i);
  if (taskMatch && clean(taskMatch[1])) return { kind: "createTask", taskText: clean(taskMatch[1]) };
  const remind = orig.match(/\b(?:remind me to|remember to|have the team|get someone to|make sure to)\s+(.+)$/i);
  if (remind && clean(remind[1])) return { kind: "createTask", taskText: clean(remind[1]) };

  // --- Weather (answered inline from saved location; runs after create-task so
  // "create a task to check the weather" stays a task) ---
  const weather = detectWeatherIntent(orig);
  if (weather) return weather;

  // --- Approvals: query BEFORE the approve/deny verbs ---
  if (/\b(any|pending|outstanding|waiting)\s+approvals?\b/.test(t)
      || /\bwhat('?s| is|s)?\b[^.?!]*\bapprov/.test(t)
      || /\banything\s+(?:to\s+approve|waiting\s+for\s+(?:my\s+)?approval)\b/.test(t)
      || /\bneed\w*\s+(?:my\s+)?approv/.test(t)
      || /^approvals?\??$/.test(t)) {
    return { kind: "approvalsList" };
  }
  if (/\b(deny|reject|decline|disapprove)\b/.test(t)) {
    return { kind: "deny", ordinal: parseOrdinal(t) };
  }
  if (/\bapprove\b/.test(t)) {
    return { kind: "approve", ordinal: parseOrdinal(t) };
  }

  // --- Scheduled items (formerly "directives") / standing goals ---
  if (/\b(directives?|standing goals?|what.*standing|what are you watching|scheduled items?|what.*scheduled)\b/.test(t)) return { kind: "directives" };

  // --- Board / task status ---
  if (/\b(board|task status|how many tasks|what('?s| is) (queued|in progress|pending)|what are you working on|what('?s| is) running|status report)\b/.test(t)) {
    return { kind: "board" };
  }

  return { kind: "none" };
}

// --- Spoken-reply builders (pure; given already-fetched data) -----------------

const plural = (n: number, one: string, many = one + "s") => (n === 1 ? `${n} ${one}` : `${n} ${many}`);

export function boardReply(counts: Record<string, number>): string {
  const queued = (counts.backlog || 0);
  const inProgress = (counts.assigned || 0) + (counts.in_progress || 0);
  const review = (counts.review || 0);
  const done = (counts.done || 0);
  const failed = (counts.failed || 0);
  const total = queued + inProgress + review;
  if (total === 0 && done === 0 && failed === 0) return "Your board is empty — nothing queued or running.";
  const parts: string[] = [];
  if (queued) parts.push(plural(queued, "queued", "queued"));
  if (inProgress) parts.push(`${inProgress} in progress`);
  if (review) parts.push(`${review} in review`);
  if (failed) parts.push(plural(failed, "failed", "failed"));
  const head = parts.length ? parts.join(", ") : "nothing active";
  return `On the board: ${head}. ${done} done.`;
}

export interface SpokenApproval { title: string; kind: string }
export function approvalsReply(items: SpokenApproval[]): string {
  if (!items.length) return "Nothing is waiting for your approval.";
  const first = items[0];
  if (items.length === 1) return `One approval waiting: ${first.title}. Say "approve it" or "deny it".`;
  return `${items.length} approvals waiting. First up: ${first.title}. Say "approve it" or "deny it".`;
}

export function resolvedReply(decision: "approve" | "deny", title: string | null): string {
  const verb = decision === "approve" ? "Approved" : "Denied";
  return title ? `${verb}: ${title}.` : `${verb} the latest request.`;
}
export function noApprovalToResolveReply(): string {
  return "There's nothing waiting for approval right now.";
}

export interface SpokenDirective { goal: string; status: string }
export function directivesReply(rows: SpokenDirective[]): string {
  const active = rows.filter((r) => r.status === "active");
  if (!rows.length) return "You have no scheduled items.";
  if (!active.length) return `No active scheduled items (${rows.length} total, none running).`;
  const names = active.slice(0, 3).map((r) => r.goal).join("; ");
  const more = active.length > 3 ? `, and ${active.length - 3} more` : "";
  return `${plural(active.length, "active scheduled item")}: ${names}${more}.`;
}

export function createdTaskReply(title: string): string {
  return `Done — I queued a task: ${title}.`;
}

export function connectivityReply(mode: string): string {
  switch (mode) {
    case "cloud-ok": return "We're online — cloud models are available.";
    case "local-only": return "Running local-only — on-device models, no cloud.";
    case "offline": return "We're offline — no network calls.";
    default: return `Connectivity mode is ${mode}.`;
  }
}
export function setConnectivityReply(mode: ConnMode): string {
  if (mode === "auto") return "Connectivity set to automatic.";
  return "Set. " + connectivityReply(mode);
}
