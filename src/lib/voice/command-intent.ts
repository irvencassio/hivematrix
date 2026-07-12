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
  | "openclawAsk"      // "ask Vale / hey Vale / ask OpenClaw / hey OpenClaw <prompt>"
  | "weather"          // "what's the weather today" — answered inline from saved location
  | "scheduledReminder" // "remind me at 5:35 PM to <X>" — delayed HiveMatrix task
  | "createTask"       // "create a task to <X>" / "remind me to <X>"
  | "connectivity"     // "are we online / connectivity status"
  | "setConnectivity"  // "go offline / cloud only / go local / auto"
  | "deepThink"        // "think hard about X" — multi-attempt local reasoning, read back when ready
  | "goals"            // "what are my goals" — read persona/GOALS.md
  | "addGoal"          // "add a goal to X / my goal is X" — append to persona/GOALS.md
  | "remember"         // "remember that X / note that X" — append to persona daily memory
  | "heartbeatNow"     // "run a pulse / heartbeat now" — fire one heartbeat pass
  | "none";

export interface CommandIntent {
  kind: CommandKind;
  thinkText?: string;  // deepThink
  goalText?: string;   // addGoal
  rememberText?: string; // remember
  taskText?: string;   // createTask
  mode?: ConnMode;     // setConnectivity
  ordinal?: number;    // approve / deny target, 1-based
  /** approve / deny target by kind keyword or a substring of its title (e.g.
   * "the mail draft", "the browser step on chase"), verb/ordinal words
   * stripped. Undefined for a bare "approve it" with no descriptive text. */
  matchText?: string;
  taskRef?: string;    // setTaskModel target
  model?: string;      // setTaskModel model id / alias
  directiveText?: string; // startDirective / pauseDirective target
  browserLane?: VoiceBrowserLaneIntent;
  mailDelete?: VoiceMailDeleteIntent;
  openclaw?: {
    assistant: "vale" | "openclaw";
    prompt: string;
    sessionKey: string;
  };
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

/**
 * Match "ask Vale/OpenClaw [to] ..." and "hey Vale/OpenClaw[,] ...".
 * Must run before Jarvis intents so "ask Vale to retry..." routes to Vale, not retryFailedTask.
 */
export function detectOpenClawIntent(text: string): CommandIntent | null {
  const m = (text || "").match(
    /^(?:ask\s+(vale|openclaw)(?:\s+to)?|hey\s+(vale|openclaw))\s*,?\s*(.+)$/i,
  );
  if (!m) return null;
  const assistantRaw = (m[1] ?? m[2] ?? "").toLowerCase();
  const assistant: "vale" | "openclaw" = assistantRaw === "openclaw" ? "openclaw" : "vale";
  const prompt = clean(m[3]);
  if (!prompt) return null;
  return {
    kind: "openclawAsk",
    openclaw: { assistant, prompt, sessionKey: "agent:main:main" },
  };
}

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

// Words that carry no identifying content for an approve/deny target: the verb
// itself, pronouns/articles, and the ordinal/cardinal/"number N" vocabulary
// parseOrdinal() already extracts into `ordinal`. Whatever words remain after
// stripping these become `matchText` — the phrase the matcher compares
// against a candidate's kind ("checkpoint"/"content"/"tool"/"stuck") or as a
// substring of its title.
const APPROVAL_MATCH_STOPWORDS = new Set([
  "approve", "deny", "reject", "decline", "disapprove",
  "the", "a", "an", "that", "this", "it", "please", "now",
  "number", "option", "item",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
]);

/** Extract the descriptive remainder of an approve/deny utterance (lowercased
 * `t`), e.g. "approve the mail draft" -> "mail draft". Undefined when nothing
 * but the verb/pronoun/ordinal vocabulary was said ("approve it", "deny the
 * second one"). */
export function extractApprovalMatchText(t: string): string | undefined {
  const words = t
    .replace(/[.?!,]/g, "")
    .split(/\s+/)
    .filter((w) => w && !APPROVAL_MATCH_STOPWORDS.has(w) && !/^\d+(st|nd|rd|th)?$/.test(w));
  const text = words.join(" ").trim();
  return text.length > 0 ? text : undefined;
}

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

  // --- Self-improvement / self-teaching requests are handled AGENTICALLY by
  // Flash (which escalates them to the HiveMatrix repo via escalate_to_task,
  // P3.2) — never let the generic createTask/reminder regexes (or any other
  // intent below) swallow them. Placed FIRST, before every other branch, so a
  // future regex tweak elsewhere can't silently start capturing these. ---
  if (/\b(update|improve|teach|upgrade)\b[\s\S]*(yourself|hivematrix|hive matrix)/i.test(orig)) {
    return { kind: "none" };
  }

  const browserLane = detectVoiceBrowserLaneIntent(orig);
  if (browserLane) return { kind: "browserLaneTask", browserLane };

  const mailDelete = detectVoiceMailDeleteIntent(orig);
  if (mailDelete) return { kind: "mailDeleteTask", mailDelete };

  const openclawIntent = detectOpenClawIntent(orig);
  if (openclawIntent) return openclawIntent;

  // --- Deep think: multi-attempt reasoning on the local model, read back when
  // ready. Runs early so "think hard about the briefing" deep-thinks. The
  // trailing (?!\w) stops "deep thinking about X" from matching mid-word. ---
  const think = orig.match(
    /^(?:think\s+(?:hard|deep|deeply|carefully|longer)\s+(?:about|on|through)?|deep\s*think(?!\w)(?:\s+about)?|give\s+me\s+your\s+best\s+thinking\s+on)\s*[:,]?\s*(.+)$/i,
  );
  if (think && clean(think[1])) return { kind: "deepThink", thinkText: clean(think[1]) };

  // --- Persona memory: goals + notes. "remember to X" stays a task (below);
  // "remember that X" is a memory (and must carry substance — "note that down"
  // is not a note). ---
  const addGoal = orig.match(
    /^(?:add\s+(?:a\s+)?(?:new\s+)?goal(?:\s+(?:to|of))?|my\s+goal\s+is(?:\s+to)?|new\s+goal|set\s+a\s+goal(?:\s+to)?)\s*[:,-]?\s*(.+)$/i,
  );
  if (addGoal && clean(addGoal[1])) return { kind: "addGoal", goalText: clean(addGoal[1]) };
  const remember = orig.match(/^(?:remember|note)\s+(?:that\s+|this[:,]?\s+)(.+)$/i)
    ?? orig.match(/^take\s+a\s+note[:,]?\s+(.+)$/i);
  if (remember && clean(remember[1]) && clean(remember[1]).split(/\s+/).length >= 2) {
    return { kind: "remember", rememberText: clean(remember[1]) };
  }

  // --- Goals query (before the directives/"standing goals" match) ---
  if (!/\b(standing|scheduled)\b/.test(t) &&
      (/\bwhat\s+are\s+my\s+goals\b/.test(t) || /\bread\s+(?:me\s+)?my\s+goals\b/.test(t) ||
       /\bwhat\s+am\s+i\s+working\s+towards?\b/.test(t) || /^(?:my\s+)?goals\??$/.test(t))) {
    return { kind: "goals" };
  }

  // --- Heartbeat: fire one unprompted pass now. ANCHORED whole-utterance match
  // only — "create a task to run a heartbeat check" must stay a task. ---
  if (/^(?:(?:run|do|fire)\s+(?:a\s+|the\s+)?(?:heartbeat|pulse)|pulse|heartbeat)(?:\s+(?:now|check(?:\s+now)?))?\s*[.!?]*$/.test(t)) {
    return { kind: "heartbeatNow" };
  }

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
    const matchText = extractApprovalMatchText(t);
    return { kind: "deny", ordinal: parseOrdinal(t), ...(matchText ? { matchText } : {}) };
  }
  if (/\bapprove\b/.test(t)) {
    const matchText = extractApprovalMatchText(t);
    return { kind: "approve", ordinal: parseOrdinal(t), ...(matchText ? { matchText } : {}) };
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

const SPOKEN_COUNT = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const MAX_SPOKEN_APPROVALS = 5;

export interface SpokenApproval { title: string; kind: string }
export function approvalsReply(items: SpokenApproval[]): string {
  if (!items.length) return "Nothing is waiting for your approval.";
  if (items.length === 1) {
    return `One approval waiting: ${items[0].title}. Say "approve it" or "deny it".`;
  }
  const spoken = items.slice(0, MAX_SPOKEN_APPROVALS);
  const list = spoken.map((item, i) => `${SPOKEN_COUNT[i] ?? String(i + 1)}, ${item.title}`).join("; ");
  const more = items.length > spoken.length ? `, and ${items.length - spoken.length} more` : "";
  return `${items.length} approvals waiting: ${list}${more}. Say "approve" or "deny" by number, or say which one.`;
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
