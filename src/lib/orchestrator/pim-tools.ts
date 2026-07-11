/**
 * PIM lane tools — the operator's personal information, live from this Mac.
 *
 * Contacts, today's calendar, and Reminders (read + CREATE) as lane tools, so
 * every agent surface that speaks lane-tools — Flash chat, live voice, watch
 * /voice/turn, full agent tasks — can answer "what's John's number", "what's
 * on my calendar", and "remind me to call mom at 5" LIVE, without detouring
 * through a background task. Mirrors voice-sidecar/llm.py's osascript tools
 * (the sidecar keeps its copies for the dev CLI paths); keep the two in sync.
 *
 * reminder_create and calendar_create are deliberately the writes here:
 * both are local, instant, low-risk, and user-visible (a Reminder or Calendar
 * event appears on all the operator's devices). Everything heavier (send
 * mail/text, browse, files) stays in its own lane.
 *
 * Structured actions: contacts_lookup output is machine-parseable ("phone:"
 * lines), and extractPimActions() turns any phone numbers a turn surfaced
 * into client-renderable tap-to-dial/text actions for iOS + Watch.
 */

import { execFile } from "child_process";
import type { ChatTool } from "./tool-bridge";

// ---------------------------------------------------------------------------
// osascript runner — bounded so a slow app launch never stalls a spoken turn.

function osascript(script: string, timeoutMs = 12_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile("osascript", ["-e", script], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, out: (stderr || err.message || "").trim().slice(0, 200) });
      else resolve({ ok: true, out: (stdout || "").trim() });
    });
  });
}

const clamp = (v: unknown, def: number, lo: number, hi: number): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(n, hi)) : def;
};

// ---------------------------------------------------------------------------
// Due-phrase parsing — deterministic TS port of voice-sidecar/llm.py _parse_due.
// The model only relays the user's own words ("tomorrow at 5"); Python/TS does
// the date math, because a small model doing calendar arithmetic is a coin flip.

const WEEKDAY_IDX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
const DAYPART_HOUR: Record<string, number> = {
  morning: 9, noon: 12, afternoon: 15, evening: 18, tonight: 20, night: 20, midnight: 0,
};

export function parseDuePhrase(text: string, now: Date = new Date()): Date | null {
  const t = (text || "").trim().toLowerCase();
  if (!t) return null;

  // "in N minutes/hours/days/weeks" — relative wins outright.
  const rel = t.match(/\bin\s+(\d+|a|an)\s+(minute|min|hour|hr|day|week)s?\b/);
  if (rel) {
    const n = rel[1] === "a" || rel[1] === "an" ? 1 : parseInt(rel[1], 10);
    const ms = { minute: 60_000, min: 60_000, hour: 3_600_000, hr: 3_600_000, day: 86_400_000, week: 604_800_000 }[rel[2]]!;
    return new Date(now.getTime() + n * ms);
  }

  // Day: today / tonight / tomorrow / a weekday name. Default = today.
  const day = new Date(now);
  let explicitDay = false;
  if (/\btomorrow\b/.test(t)) {
    day.setDate(day.getDate() + 1);
    explicitDay = true;
  } else {
    for (const [name, idx] of Object.entries(WEEKDAY_IDX)) {
      if (new RegExp(`\\b${name}\\b`).test(t)) {
        const ahead = (idx - now.getDay() + 7) % 7 || 7; // "friday" = the NEXT friday
        day.setDate(day.getDate() + ahead);
        explicitDay = true;
        break;
      }
    }
    if (!explicitDay && /\btoday\b|\btonight\b|\bthis\b/.test(t)) explicitDay = true;
  }

  // Time: "at 5", "5:30 pm", "17:45", noon/midnight/morning/evening…
  let hour: number | null = null;
  let minute = 0;
  const tm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/);
  if (tm) {
    let h = parseInt(tm[1], 10);
    if (h >= 0 && h <= 23) {
      minute = parseInt(tm[2] || "0", 10);
      const ampm = (tm[3] || "").replace(/\./g, "");
      if (ampm === "pm" && h < 12) h += 12;
      else if (ampm === "am" && h === 12) h = 0;
      else if (!ampm && h <= 7) h += 12; // bare "at 5" almost always means 5 PM in speech
      hour = h;
    }
  }
  if (hour === null) {
    for (const [word, h] of Object.entries(DAYPART_HOUR)) {
      if (new RegExp(`\\b${word}\\b`).test(t)) { hour = h; break; }
    }
  }
  if (hour === null && !explicitDay) return null; // nothing usable ("someday", "later")
  if (hour === null) hour = 9; // a day with no time → 9 AM

  const due = new Date(day);
  due.setHours(hour, minute, 0, 0);
  if (due <= now && !explicitDay) due.setDate(due.getDate() + 1); // "at 5" said at 6 PM → tomorrow
  return due;
}

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI function-tool shape, lane-tools conventions).

export const PIM_TOOL_DEFINITIONS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "contacts_lookup",
      description:
        "Contacts: look up a person in the operator's macOS Contacts by name — returns their phone numbers and email addresses. Use for \"what's John's number\", \"my wife's email\", or to resolve a name to a phone number/email before sending or dialing. The phone numbers you return become tap-to-call buttons on the operator's iPhone/Watch, so include them in your reply.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The person's name (or part of it) to look up" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calendar_today",
      description:
        "Calendar: read TODAY'S events from the operator's macOS Calendar — each event's title and start time. Use for \"what's on my calendar\", \"my schedule\", \"next meeting\", \"am I free\".",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max events to return (default 8, max 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reminders_list",
      description:
        "Reminders: read the operator's OPEN (incomplete) Apple Reminders — each one's name and due date. Use for \"what's on my to-do list\", \"what reminders do I have\".",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max reminders to return (default 10, max 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reminder_create",
      description:
        "Reminders: CREATE a real Apple Reminder on the operator's devices, live. Use when they say \"remind me to X\", \"set a reminder for X at 5\". Pass what to be reminded of in 'name' (without the words \"remind me to\") and their own words about when in 'due' (e.g. \"tomorrow at 5pm\", \"in 20 minutes\", \"friday morning\") — omit 'due' if no time was given. This completes the request immediately; do NOT also create a task for it.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "What to remind the operator about" },
          due: { type: "string", description: "When, in the user's words (optional): \"tomorrow 5pm\", \"in 2 hours\", \"monday at noon\"" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calendar_create",
      description:
        "Calendar: CREATE a real event on the operator's macOS Calendar, live. Use when they say \"put lunch with Sam on Friday at noon\", \"add a dentist appointment tomorrow at 2\", \"schedule X for Y\". Pass the event title in 'title' and their own words about when it starts in 'when' (e.g. \"friday at noon\", \"tomorrow at 2pm\", \"in an hour\") — an event needs a start time, so ask the operator for one if they didn't give it; never guess an all-day event. Optional 'durationMinutes' (default 60). This completes the request immediately; do NOT also create a task for it.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The event title" },
          when: { type: "string", description: "When it starts, in the user's words: \"tomorrow at 2pm\", \"friday at noon\", \"in an hour\"" },
          durationMinutes: { type: "number", description: "Event length in minutes (default 60)" },
        },
        required: ["title", "when"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Executors.

async function executeContactsLookup(args: Record<string, unknown>): Promise<string> {
  const q = String(args.name ?? "").replace(/["\\]/g, "").trim().slice(0, 60);
  if (!q) return "No name was given to look up.";
  const script = [
    'tell application "Contacts"',
    `  set ppl to (every person whose name contains "${q}")`,
    '  set out to ""',
    "  set lim to (count of ppl)",
    "  if lim > 5 then set lim to 5",
    "  repeat with i from 1 to lim",
    "    set p to item i of ppl",
    "    set out to out & (name of p) & linefeed",
    "    repeat with ph in phones of p",
    '      set out to out & "  phone: " & (value of ph) & linefeed',
    "    end repeat",
    "    repeat with em in emails of p",
    '      set out to out & "  email: " & (value of em) & linefeed',
    "    end repeat",
    "  end repeat",
    "  return out",
    "end tell",
  ].join("\n");
  const { ok, out } = await osascript(script);
  if (!ok) return `Could not look up contacts: ${out}`;
  return out || `No contact found matching ${q}.`;
}

async function executeCalendarToday(args: Record<string, unknown>): Promise<string> {
  const limit = clamp(args.limit, 8, 1, 20);
  const script = [
    "set d0 to (current date)",
    "set hours of d0 to 0",
    "set minutes of d0 to 0",
    "set seconds of d0 to 0",
    "set d1 to d0 + (1 * days)",
    'tell application "Calendar"',
    '  set out to ""',
    "  set n to 0",
    "  repeat with c in calendars",
    "    set evs to (every event of c whose start date >= d0 and start date < d1)",
    "    repeat with e in evs",
    `      if n < ${limit} then`,
    '        set out to out & (summary of e) & " — " & (start date of e as string) & linefeed',
    "        set n to n + 1",
    "      end if",
    "    end repeat",
    "  end repeat",
    "  return out",
    "end tell",
  ].join("\n");
  const { ok, out } = await osascript(script, 15_000);
  if (!ok) return `Could not read the calendar: ${out}`;
  return out || "Nothing on the calendar today.";
}

/**
 * Pure: the AppleScript for "is there a calendar event starting within the
 * next N hours" — the filtering happens INSIDE the script (date comparison is
 * native there) so the caller never has to reparse AppleScript's locale-formatted
 * date-as-string output in JS. Returns just the first match's title, or "" for
 * none. Used by the voice greeting's "next meeting" fact (day-brief.ts) — not
 * exposed as a model-facing tool (not in PIM_TOOL_DEFINITIONS), since it exists
 * purely for that deterministic assembly path.
 */
export function buildCalendarNextWithinScript(hours: number): string {
  return [
    "set d0 to (current date)",
    `set d1 to d0 + (${hours} * hours)`,
    'tell application "Calendar"',
    '  set out to ""',
    "  repeat with c in calendars",
    "    set evs to (every event of c whose start date >= d0 and start date < d1)",
    "    repeat with e in evs",
    '      if out is "" then set out to (summary of e)',
    "    end repeat",
    "  end repeat",
    "  return out",
    "end tell",
  ].join("\n");
}

async function executeCalendarNextWithin(args: Record<string, unknown>): Promise<string> {
  const hours = clamp(args.hours, 3, 1, 24);
  const { ok, out } = await osascript(buildCalendarNextWithinScript(hours), 15_000);
  return ok ? out : "";
}

async function executeRemindersList(args: Record<string, unknown>): Promise<string> {
  const limit = clamp(args.limit, 10, 1, 20);
  const script = [
    'tell application "Reminders"',
    '  set out to ""',
    "  set rs to (reminders whose completed is false)",
    `  set lim to ${limit}`,
    "  if (count of rs) < lim then set lim to (count of rs)",
    "  repeat with i from 1 to lim",
    "    set r to item i of rs",
    '    set out to out & "- " & (name of r)',
    "    try",
    '      if (due date of r) is not missing value then set out to out & " (due " & ((due date of r) as string) & ")"',
    "    end try",
    "    set out to out & linefeed",
    "  end repeat",
    "  return out",
    "end tell",
  ].join("\n");
  const { ok, out } = await osascript(script, 15_000);
  if (!ok) return `Could not read reminders: ${out}`;
  return out || "No open reminders.";
}

async function executeReminderCreate(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? "").replace(/["\\]/g, "").trim().slice(0, 120);
  if (!name) return "No reminder text was given.";
  const due = parseDuePhrase(String(args.due ?? ""));
  const lines: string[] = [];
  if (due) {
    lines.push(
      "set d to current date",
      `set year of d to ${due.getFullYear()}`,
      `set month of d to ${due.getMonth() + 1}`,
      `set day of d to ${due.getDate()}`,
      `set hours of d to ${due.getHours()}`,
      `set minutes of d to ${due.getMinutes()}`,
      "set seconds of d to 0",
      `tell application "Reminders" to make new reminder with properties {name:"${name}", due date:d, remind me date:d}`,
    );
  } else {
    lines.push(`tell application "Reminders" to make new reminder with properties {name:"${name}"}`);
  }
  const { ok, out } = await osascript(lines.join("\n"));
  if (!ok) return `Could not set the reminder: ${out}`;
  if (due) {
    const when = due.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `Reminder set: "${name}" for ${when}.`;
  }
  return `Reminder set: "${name}" (no due time).`;
}

// ---------------------------------------------------------------------------
// calendar_create — the one Calendar write. Injectable osascript IO so the
// AppleScript generation (date-component correctness) and failure surface
// are unit-testable without touching a live Calendar.app.

export interface CalendarCreateIO {
  runOsascript(script: string): Promise<{ ok: boolean; out: string }>;
}

/**
 * Build the AppleScript that creates one Calendar.app event. Start/end are
 * built from explicit date components — never a locale date string — same
 * style as executeReminderCreate's `d`, just for two dates (start + end).
 *
 * Target calendar: a deterministic fallback chain resolved INSIDE the script
 * (one round trip, like reminder_create) so no live calendar list has to be
 * fetched into Node first: (1) the first calendar whose `writable` property
 * is true — covers every operator regardless of what they've named their
 * calendars; (2) a calendar literally named "Home" (macOS's default personal
 * calendar on a fresh iCloud account); (3) a calendar named "Calendar" (the
 * other common default name); (4) failing all of that, the first calendar at
 * all. This choice is documented here because it can't be inspected from the
 * tool's TypeScript signature — only from this comment and the script below.
 */
export function buildCalendarCreateScript(title: string, start: Date, end: Date): string {
  const dateLines = (v: string, d: Date): string[] => [
    `set ${v} to current date`,
    `set year of ${v} to ${d.getFullYear()}`,
    `set month of ${v} to ${d.getMonth() + 1}`,
    `set day of ${v} to ${d.getDate()}`,
    `set hours of ${v} to ${d.getHours()}`,
    `set minutes of ${v} to ${d.getMinutes()}`,
    `set seconds of ${v} to 0`,
  ];
  return [
    ...dateLines("d1", start),
    ...dateLines("d2", end),
    'tell application "Calendar"',
    "  set targetCal to missing value",
    "  repeat with c in calendars",
    "    if writable of c is true then",
    "      set targetCal to c",
    "      exit repeat",
    "    end if",
    "  end repeat",
    "  if targetCal is missing value then",
    "    try",
    '      set targetCal to calendar "Home"',
    "    end try",
    "  end if",
    "  if targetCal is missing value then",
    "    try",
    '      set targetCal to calendar "Calendar"',
    "    end try",
    "  end if",
    "  if targetCal is missing value and (count of calendars) > 0 then set targetCal to item 1 of calendars",
    '  if targetCal is missing value then return "ERROR: no calendar available to create the event in"',
    `  make new event at end of events of targetCal with properties {summary:"${title}", start date:d1, end date:d2}`,
    '  return "OK"',
    "end tell",
  ].join("\n");
}

export async function executeCalendarCreate(args: Record<string, unknown>, io: CalendarCreateIO = { runOsascript: osascript }): Promise<string> {
  const title = String(args.title ?? "").replace(/["\\]/g, "").trim().slice(0, 120);
  if (!title) return "No event title was given.";
  const start = parseDuePhrase(String(args.when ?? ""));
  if (!start) {
    return `An event needs a start time — tell me when "${title}" should start (e.g. "tomorrow at 2pm", "friday at noon").`;
  }
  const durationMinutes = clamp(args.durationMinutes, 60, 5, 24 * 60);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const script = buildCalendarCreateScript(title, start, end);
  const { ok, out } = await io.runOsascript(script);
  if (!ok || out.startsWith("ERROR")) return `Could not create the event: ${out || "unknown error"}`;
  const when = start.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `Event created: "${title}" ${when} (${durationMinutes} min).`;
}

/** Dispatcher — lane-tools routes the pim_* names here. */
export async function executePimTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "contacts_lookup": return executeContactsLookup(args);
    case "calendar_today": return executeCalendarToday(args);
    case "reminders_list": return executeRemindersList(args);
    case "reminder_create": return executeReminderCreate(args);
    case "calendar_create": return executeCalendarCreate(args);
    case "calendar_next_within": return executeCalendarNextWithin(args);
    default: return `Unknown PIM tool: ${name}`;
  }
}

// ---------------------------------------------------------------------------
// Structured actions — deterministic tap-to-dial/text follow-ups for clients.
// Mirrors voice-sidecar/llm.py extract_actions; never model-generated.

export interface TurnAction { type: "dial" | "sms"; label: string; number: string; }

const PHONE_RE = /(\+?1?[\s.\-(]*\d{3}[\s.\-)]*\d{3}[\s.\-]*\d{4}|\+\d{7,15})/g;

function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`; // bare US-format number from Contacts
  return digits;
}

export interface PimToolRun { name: string; output: string; }

/** Dial/text actions from a turn: contact-lookup output (labeled with the
 * person's name) plus any phone numbers spoken in the reply. Deduped, capped. */
export function extractPimActions(toolRuns: PimToolRun[], reply = ""): TurnAction[] {
  const actions: TurnAction[] = [];
  const seen = new Set<string>();
  const add = (type: "dial" | "sms", label: string, number: string) => {
    const num = normalizePhone(number);
    if (!num || num.replace(/\D/g, "").length < 7 || seen.has(`${type}:${num}`)) return;
    seen.add(`${type}:${num}`);
    actions.push({ type, label, number: num });
  };

  for (const run of toolRuns) {
    if (run.name !== "contacts_lookup" && run.name !== "get_contact") continue;
    let person = "";
    for (const line of String(run.output || "").split("\n")) {
      const stripped = line.trim();
      if (!stripped) continue;
      if (!line.startsWith(" ")) person = stripped; // name row (phones/emails indented)
      else if (stripped.toLowerCase().startsWith("phone:")) {
        const num = stripped.split(":").slice(1).join(":").trim();
        add("dial", `Call ${person || "them"}`, num);
        add("sms", `Text ${person || "them"}`, num);
      }
    }
  }
  for (const m of (reply || "").matchAll(PHONE_RE)) add("dial", "Call this number", m[0]);
  return actions.slice(0, 6);
}
