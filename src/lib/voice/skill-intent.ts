/**
 * Voice skill picker — answer "what skills do I have / find a skill for X / use the
 * Y skill" by voice, deterministically (no LLM round-trip), the same keyword-gated
 * pattern as the voice email tool. Pure: detect the intent + build a SPOKEN reply
 * from the ranked skill index. The endpoint/sidecar wires audio around it.
 */

import type { SkillIndexEntry } from "@/lib/skills/contracts";
import { rankSkills } from "@/lib/skills/search";

export type SkillIntentKind = "list" | "search" | "use" | "none";
export interface SkillIntent { kind: SkillIntentKind; query?: string; name?: string }

function speakName(slugOrName: string): string {
  return slugOrName.replace(/-/g, " ").trim();
}

/** Detect a skill-related request in a spoken utterance. Pure. */
export function detectSkillIntent(text: string): SkillIntent {
  const t = text.toLowerCase().trim();

  // use: prefer "use/run the skill X" (name AFTER), then "use the X skill" (name BEFORE).
  const useAfter = t.match(/\b(?:use|run|apply|invoke)\b(?:\s+the)?\s+(?:skill|command)\s+(.+)$/);
  if (useAfter && useAfter[1]) return { kind: "use", name: useAfter[1].replace(/[.?!]+$/, "").trim() };
  const useBefore = t.match(/\b(?:use|run|apply|invoke)\b(?:\s+the)?\s+(.+?)\s+(?:skill|command)\b/);
  if (useBefore && useBefore[1]) {
    const n = useBefore[1].replace(/^the\s+/, "").replace(/[.?!]+$/, "").trim();
    if (n) return { kind: "use", name: n };
  }

  // search: "do I have a skill for X", "find/search a skill for/to X", "a skill that X"
  const search = t.match(/\bskill\b[^.?!]*?\b(?:for|to|that|about)\b\s+(.+)$/)
    || t.match(/\b(?:find|search|any)\b[^.?!]*?\bskills?\b[^.?!]*?\b(?:for|to|that|about)?\s*(.+)$/);
  if (search && search[1] && search[1].trim().length > 1) {
    return { kind: "search", query: search[1].replace(/[.?!]+$/, "").trim() };
  }

  // list: "what/which skills ...", "list my skills", "do I have any skills", "what can you do"
  if (/\b(what|which|list|show)\b[^.?!]*\bskills?\b/.test(t)
    || /\bmy\s+skills?\b/.test(t)
    || /\bskills?\b[^.?!]*\b(installed|available|do i have)\b/.test(t)
    || /\bwhat can you do\b/.test(t)) {
    return { kind: "list" };
  }

  return { kind: "none" };
}

function joinSpoken(names: string[]): string {
  const s = names.map(speakName);
  if (s.length === 1) return s[0];
  if (s.length === 2) return `${s[0]} and ${s[1]}`;
  return `${s.slice(0, -1).join(", ")}, and ${s[s.length - 1]}`;
}

export interface SkillVoiceResult { handled: boolean; reply: string; action?: "use"; name?: string; matches: string[] }

/**
 * Build a concise spoken reply for a skill intent against the skill library.
 * `none` → handled:false (let the normal voice turn answer). Pure.
 */
export function buildSkillVoiceReply(intent: SkillIntent, skills: SkillIndexEntry[]): SkillVoiceResult {
  if (intent.kind === "none") return { handled: false, reply: "", matches: [] };

  if (intent.kind === "list") {
    if (skills.length === 0) return { handled: true, reply: "You don't have any skills installed yet.", matches: [] };
    const top = rankSkills(skills, "").slice(0, 3).map((s) => s.name);
    const more = skills.length > top.length ? `, and ${skills.length - top.length} more` : "";
    return { handled: true, reply: `You have ${skills.length} skill${skills.length === 1 ? "" : "s"}. The ones you use most are ${joinSpoken(top)}${more}.`, matches: top };
  }

  if (intent.kind === "search") {
    const ranked = rankSkills(skills, intent.query ?? "").slice(0, 3).map((s) => s.name);
    if (ranked.length === 0) return { handled: true, reply: `I couldn't find a skill for ${intent.query}.`, matches: [] };
    return { handled: true, reply: `I found ${ranked.length} skill${ranked.length === 1 ? "" : "s"} for ${intent.query}: ${joinSpoken(ranked)}.`, matches: ranked };
  }

  // use: resolve the spoken name to the best-matching installed skill.
  const ranked = rankSkills(skills, intent.name ?? "");
  if (ranked.length === 0) return { handled: true, reply: `I couldn't find a skill called ${intent.name}.`, matches: [] };
  const top = ranked[0];
  return { handled: true, action: "use", name: top.name, reply: `Okay, using the ${speakName(top.name)} skill.`, matches: [top.name] };
}
