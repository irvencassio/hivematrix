/**
 * Flash Lane — context assembly.
 *
 * Builds the system prompt by stitching together:
 *   1. Persona files (SOUL, IDENTITY, USER) from <brainRoot>/persona/
 *   2. Today's daily note from <brainRoot>/persona/memory/ or <brainRoot>/daily/
 *   3. Rolling session summary (stored in flash_sessions.summary)
 *   4. Brain search results for the current user text
 *
 * All reads are best-effort: missing files produce empty sections, not errors.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { searchBrain } from "@/lib/brain/search";
import { extractPersonaName } from "@/lib/onboarding/birth-ritual";
import { listSkills } from "@/lib/skills/store";
import { formatSkillIndex } from "@/lib/skills/contracts";
import { goalsDueToday as defaultGoalsDueToday } from "@/lib/goals/store";
import { flashToolName } from "./tool-names";
import type { FlashChannel, FlashMessage, FlashTurnRow } from "./types";

const PERSONA_FILES = ["SOUL.md", "IDENTITY.md", "USER.md", "GOALS.md"] as const;

/** Channels whose replies are read aloud by TTS — they need spoken-style output. */
const SPOKEN_CHANNELS: ReadonlySet<FlashChannel> = new Set(["voice", "watch", "glasses"]);

/** Spoken-style guidance folded in for TTS surfaces (formerly hardcoded in the
 * sidecar's realtime.py prompt; now the single Flash pipeline owns it). */
const SPOKEN_STYLE =
  "You are speaking aloud — your reply will be read by text-to-speech. " +
  "Answer in one or two short, natural spoken sentences, and make the FIRST sentence " +
  "brief so it can be spoken immediately. No markdown, no lists, no code blocks, no emoji.";

/** Channels that render in a plain-text bubble (no markdown), keyed for style. */
const TEXTING_STYLE =
  "You are replying in a text message (iMessage). Keep it short and conversational — " +
  "a sentence or two, the way a person actually texts. Plain text only: no markdown, " +
  "headers, bullet lists, or code blocks — they show up as literal #, *, and - " +
  "characters in a text bubble. Skip emoji unless the operator used them first.";

const MAIL_STYLE =
  "You are drafting an email. Write plain, well-formed prose in short paragraphs — a " +
  "brief greeting, the substance, a short sign-off. No markdown syntax (#, *, backticks, " +
  "or - bullets); it renders as literal characters in email. Be concise and get to the point.";

/** Always-on voice doctrine: HOW to sound, distinct from the capability ladder
 * (what to DO). Kept short and deliberately deferential to the self-authored
 * SOUL/IDENTITY persona files, which refine this baseline when present — so a
 * rich persona overrides, and a blank one still gets a warm, human default
 * instead of generic assistant-speak. */
const VOICE_DOCTRINE =
  "How to sound — you are the operator's partner, not a generic chatbot. Address the " +
  "operator by name when you know it (their name is in the persona/USER section below). " +
  "Be warm but direct: lead with the useful thing, and cut corporate filler — no \"I'd be " +
  "happy to\", \"Certainly!\", \"As an AI\", or throat-clearing. Acknowledge briefly, then " +
  "act; don't narrate at length what you're about to do. When you're unsure, say so plainly " +
  "and give your best read rather than hedging or over-apologizing. Match the operator's " +
  "brevity and tone. If a persona (SOUL/IDENTITY) is defined below, let it refine this voice.";
/**
 * Every tool named in the doctrine below goes through this, so the prose says
 * exactly what the schema offers.
 *
 * The doctrine used to spell these bare — "call brain_search", "NEVER
 * escalate_to_task" — but Claude namespaces MCP tools, so what the model is
 * actually given is `mcp__flash__brain_search`. It followed the prompt, emitted
 * the bare name, and the CLI answered "No such tool available" before any
 * HiveMatrix code ran, so nothing could map it back. Observed live on
 * 2026-07-19 for brain_search and escalate_to_task; the model then generalised
 * the bare-name convention to code_graph, a tool the doctrine never mentions.
 */
const T = flashToolName;

/** Capability doctrine — the escalation ladder. Always-on (not gated on brain
 * root): even with no persona/skills configured, the model must know how to
 * resolve a request instead of dead-ending on "I can't do that." */
const CAPABILITY_DOCTRINE =
  "Capability ladder — when the operator asks for something, resolve it in this order and never dead-end: " +
  "(00) when the operator asks to be reminded of something or to put something on their calendar — \"remind me " +
  "to X\", \"set a reminder\", \"remind me in N minutes/at 5\", \"schedule X\", \"put X on my calendar\" — call " + T("reminder_create") + " (or " + T("calendar_create") + ") DIRECTLY and immediately; these set a REAL reminder/event on the operator's " +
  "devices right now. This is NOT multi-step work: NEVER " + T("escalate_to_task") + " and NEVER queue a task for a reminder or a " +
  "simple timed nudge — that would silently drop it. Pass the thing to be reminded of in 'name' and their own words " +
  "about when in 'due'; " +
  "(0a) when the operator asks about their goals, progress, or \"what should I do today\" — or reports doing " +
  "something (\"I ran 3 miles\", \"did 20 min of Italian\") — use the goals tools (" + T("goals_list") + ", " + T("daily_review") + ", " +
  T("goal_checkin") + ", " + T("goal_upsert") + "), NOT " + T("brain_search") + ": goals now live in a structured, checkin-tracked store distinct " +
  "from brain docs. If asked to \"import my goals\", read GOALS.md / the Solo Founder OS via " + T("brain_search") + "+" + T("brain_read") + " " +
  "and create them with " + T("goal_upsert") + "; " +
  "(0b) when asked about the operator's other plans or notes, call " + T("brain_search") + " to find the doc's path, then " +
  T("brain_read") + " on that path to get its FULL content, and answer from it — do NOT say \"I don't have file access\" " +
  "or answer from a search snippet alone when " + T("brain_read") + " is available. If " + T("brain_read") + " reports the document was " +
  "truncated, call " + T("brain_read") + " AGAIN with the offset it gives to read the rest; reading a document — however long — " +
  "is NEVER a reason to " + T("escalate_to_task") + "; " +
  "(1) answer directly if you know it; (2) use the CHEAPEST sufficient tool — " + T("desktop_action") + " (GUI automation) is a " +
  "last resort for things only a human-driven app can do, NEVER for anything computable by a script (counting files, " +
  "reading data, math, text processing): those go to " + T("skill_run") + " or " + T("learn_skill") + "; (3) if a library skill fits, run it with " + T("skill_run") + "; " +
  "(4) if no tool or skill fits — OR the tools you tried failed or were blocked — call " + T("learn_skill") + " to acquire the " +
  "capability as a new skill (you'll ack and speak the result when ready). A tool failing does NOT mean the task is " +
  "impossible; it means you need a skill you don't have yet. Do NOT say \"I can't do that\", and never tell the " +
  "operator to do by hand what a learned script could do. Exception: a PERMISSION_NEEDED tool result means the " +
  "capability exists and only needs the operator's grant — speak its remediation sentence instead of learning; " +
  "(4b) to WRITE a brain doc — \"document this\", \"save this as a note\", \"create a brain doc\" — call " + T("brain_write") + " with the FULL finished document in `content`. That call IS the save; never say a doc was created unless it returned success. " +
  "(5) for multi-step work that needs " +
  "the coding harness, call " + T("escalate_to_task") + " — and escalate EARLY, as your FIRST action, not after trying it yourself. You run on a hard 180-second, 12-tool-call budget: research-plus-write requests, anything touching source code, and anything needing more than a handful of tool calls will die mid-flight and lose all of it. A turn that ends at the budget has delivered nothing. Escalating immediately is the SUCCESSFUL outcome for that shape of request, not a fallback;  (6) if the request is about improving HiveMatrix itself (its own " +
  "code/features), " + T("escalate_to_task") + " with kind 'self-improvement' so it lands in the HiveMatrix repo. Never claim " +
  "something worked unless a tool result shows it did — if a tool failed, say so honestly and offer the next step " +
  "(learn it, escalate it, or ask for what you need). Your ONLY tools are the ones actually provided to you this " +
  "turn — you have no file, shell, glob, or search tools beyond those. NEVER write tool-call syntax or invented " +
  "tool results into your reply text; a reply that fakes a tool call will be discarded. And never end your reply " +
  "mid-plan (\"let me try…\") — finish with either a tool-backed answer or a clear commitment (learning it, " +
  "escalating it, or what you need from the operator).";

const MAX_PERSONA_CHARS = 6000;
const MAX_TURNS_IN_CONTEXT = 20;
const MAX_BRAIN_RESULTS = 3;
const BRAIN_BUDGET_MS = 3000;

function readSafe(path: string, maxChars = MAX_PERSONA_CHARS): string {
  if (!existsSync(path)) return "";
  try { return readFileSync(path, "utf-8").slice(0, maxChars); } catch { return ""; }
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The persona's chosen name from IDENTITY.md, or null if not yet born. */
function loadPersonaName(brainRoot: string): string | null {
  const content = readSafe(join(brainRoot, "persona", "IDENTITY.md"), 2000);
  return content ? extractPersonaName(content) : null;
}

function loadPersonaSection(brainRoot: string): string {
  const parts: string[] = [];
  for (const name of PERSONA_FILES) {
    const content = readSafe(join(brainRoot, "persona", name));
    if (content) parts.push(`### ${name.replace(".md", "")}\n${content.trim()}`);
  }
  return parts.length ? `## Persona\n${parts.join("\n\n")}` : "";
}

function loadDailyNote(brainRoot: string): string {
  const today = todayString();
  const candidates = [
    join(brainRoot, "daily", `${today}.md`),
    join(brainRoot, "persona", "memory", `${today}.md`),
  ];
  for (const p of candidates) {
    const content = readSafe(p, 2000);
    if (content) return `## Today (${today})\n${content.trim()}`;
  }
  return "";
}

/**
 * Goals that are due today, folded into the system prompt so ad-hoc chat and
 * voice are goal-aware without the model having to call a tool first. Best-effort
 * (empty on any error or when nothing is due), same pattern as the other
 * sections. Surface + awareness only — it does NOT instruct the model to act;
 * real work still goes through the capability ladder and its gates.
 */
function loadGoalsDueSection(): string {
  try {
    const due = defaultGoalsDueToday();
    if (!due.length) return "";
    const lines = due.slice(0, 6).map((g) => {
      const streak = g.streak && g.streak > 1 ? ` · ${g.streak}-day streak` : "";
      const target = g.target ? ` · target: ${g.target}` : "";
      const desc = g.description ? ` — ${g.description}` : "";
      const next = g.nextAction ? `\n  → next: ${g.nextAction}` : "";
      return `- ${g.title}${g.category ? ` [${g.category}]` : ""}${target}${streak}${desc}${next}`;
    });
    return "## Goals due today\n"
      + "These are the operator's active goals due today. If it fits the conversation "
      + "naturally, you may surface the single most useful next step for one of them — "
      + "briefly, never nagging. Don't derail the operator's actual request to do it.\n"
      + lines.join("\n");
  } catch {
    return "";
  }
}

/** One-paragraph guide so Haiku knows how to actually invoke a listed skill. */
const SKILL_RUN_GUIDE =
  "To RUN a skill live in this turn, call the " + T("skill_run") + " tool with the skill's " +
  "name (and a params object for any {{placeholders}} it lists, and input for " +
  "its {{input}} slot if it has one). An instruction skill returns its recipe " +
  "for you to follow now; a script skill executes in a sandbox and returns " +
  "real output. Prefer a matching skill over improvising. After following an " +
  "instruction skill you may also record " + T("skill_used") + ".";

async function loadSkillSection(): Promise<string> {
  try {
    const entries = await listSkills();
    const index = formatSkillIndex(entries, { showParams: true, toolName: flashToolName });
    if (!index) return "";
    return `${index}\n\n${SKILL_RUN_GUIDE}`;
  } catch {
    return "";
  }
}

async function loadBrainHits(text: string, brainRoot: string): Promise<string> {
  if (text.trim().length < 4) return "";
  try {
    const result = await searchBrain(text, {
      root: brainRoot,
      maxResults: MAX_BRAIN_RESULTS,
      totalBudgetMs: BRAIN_BUDGET_MS,
    });
    if (!result.hits.length) return "";
    const items = result.hits.map((h) => `- **${h.path}**: ${h.snippet}`).join("\n");
    return `## Relevant Brain Docs\n${items}`;
  } catch {
    return "";
  }
}

export async function assembleSystemPrompt(
  userText: string,
  sessionSummary: string,
  brainRoot?: string | null,
  channel?: FlashChannel,
): Promise<string> {
  const root = brainRoot ?? configuredBrainRootDir();
  const name = root ? loadPersonaName(root) : null;
  const identityLine = name
    ? `You are ${name}, the operator's AI partner running inside HiveMatrix on their Mac. That is your name — when the operator addresses you as "${name}" (aloud or in text), it is you they mean; respond naturally as yourself.`
    : "You are a capable AI assistant running inside HiveMatrix on the operator's Mac.";
  const sections: string[] = [
    identityLine,
    "Respond helpfully and concisely. Use available tools when they would genuinely help.",
    "Do not invent tool results — always call the tool and wait for the response.",
    VOICE_DOCTRINE,
    CAPABILITY_DOCTRINE,
    // The CLI's built-in web/file/shell tools are disabled here — the model can only act
    // through the HiveMatrix lane tools it is offered. Steer web work to Browser Lane.
    "For anything on the web (fetching a page, current weather, news, live info), use the hivematrix_browser (Browser Lane) tool — you have no other web access.",
  ];

  // Per-request surface style: spoken (TTS), texting (iMessage), or email. Chosen
  // from the live channel arg, never a stored session row, so a unified
  // console+voice thread still renders each turn in the right register.
  if (channel && SPOKEN_CHANNELS.has(channel)) sections.push(SPOKEN_STYLE);
  else if (channel === "imessage") sections.push(TEXTING_STYLE);
  else if (channel === "mail") sections.push(MAIL_STYLE);

  if (root) {
    const persona = loadPersonaSection(root);
    if (persona) sections.push(persona);

    const daily = loadDailyNote(root);
    if (daily) sections.push(daily);

    const brainHits = await loadBrainHits(userText, root);
    if (brainHits) sections.push(brainHits);

    const goalsSection = loadGoalsDueSection();
    if (goalsSection) sections.push(goalsSection);

    const skillSection = await loadSkillSection();
    if (skillSection) sections.push(skillSection);
  }

  if (sessionSummary) {
    sections.push(`## Prior Conversation Summary\n${sessionSummary.trim()}`);
  }

  return sections.join("\n\n");
}

/**
 * Build the messages array for the model: system prompt + rolling recent turns
 * (oldest-first, up to MAX_TURNS_IN_CONTEXT) + current user message.
 *
 * Tool turns (role="tool") are omitted from context because the base chat
 * completion path doesn't understand them — they're only relevant during an
 * active tool-call loop which manages its own message array.
 */
export function buildInitialMessages(
  systemPrompt: string,
  recentTurns: FlashTurnRow[],
  userText: string,
): FlashMessage[] {
  const messages: FlashMessage[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  // Most-recent turns are returned DESC by the store; reverse to chronological.
  const sorted = [...recentTurns]
    .reverse()
    .slice(-MAX_TURNS_IN_CONTEXT)
    .filter((t) => t.role === "user" || t.role === "assistant");

  for (const t of sorted) {
    if (t.role === "user") {
      messages.push({ role: "user", content: t.content });
    } else {
      messages.push({ role: "assistant", content: t.content });
    }
  }

  messages.push({ role: "user", content: userText });
  return messages;
}
