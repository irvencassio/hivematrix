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
import type { FlashMessage, FlashTurnRow } from "./types";

const PERSONA_FILES = ["SOUL.md", "IDENTITY.md", "USER.md"] as const;
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
): Promise<string> {
  const root = brainRoot ?? configuredBrainRootDir();
  const sections: string[] = [
    "You are a capable AI assistant running inside HiveMatrix on the operator's Mac.",
    "Respond helpfully and concisely. Use available tools when they would genuinely help.",
    "Do not invent tool results — always call the tool and wait for the response.",
  ];

  if (root) {
    const persona = loadPersonaSection(root);
    if (persona) sections.push(persona);

    const daily = loadDailyNote(root);
    if (daily) sections.push(daily);

    const brainHits = await loadBrainHits(userText, root);
    if (brainHits) sections.push(brainHits);
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
