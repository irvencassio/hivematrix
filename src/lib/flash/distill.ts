/**
 * Flash Lane — session distillation.
 *
 * When a session goes cold (6h inactivity) or on daily rollover, this module
 * runs a cheap local-model pass over the session turns to:
 *   1. Extract reusable how-tos into skills (via upsertSkill — dedupe/refine on
 *      re-distillation, same as directive retrospectives).
 *   2. File failures, friction, and unmet capability needs into the feedback
 *      backlog (via recordFeedbackDedup).
 *   3. Append notable events to <brainRoot>/persona/memory/YYYY-MM-DD.md.
 *   4. Operator-peer sessions only: extract durable facts about the operator
 *      (name, preferences, working rhythm) into persona/USER.md and stated
 *      goals/deadlines into persona/GOALS.md — the active operator model + goal
 *      ledger the birth ritual leaves as templates. Deduped, bounded, and
 *      announced via the flash:persona_updated event (the W8 "if you change
 *      your persona, tell the user" convention). GOALS.md is a brain/persona
 *      doc only — never a product UI (COMPONENT-MAP forbids that; see the
 *      scope-wall rule).
 *
 * Never throws — best-effort. Marks the session distilledAt on success or
 * permanent failure to prevent retry loops.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { getQwenProfile } from "@/lib/config/qwen-profile";
import { upsertSkill } from "@/lib/skills/store";
import { recordFeedbackDedup } from "@/lib/feedback/feedback";
import { broadcastEvent } from "@/lib/ws/broadcaster";
import { GOALS_SECTION_SPEC, USER_SECTION_SPEC, mergeDatedSection } from "@/lib/brain/persona-section";
import { getTurnsForSession, getSession, markSessionDistilled } from "./store";
import type { FlashTurnRow } from "./types";

const MIN_CONTENT_TURNS = 4;      // fewer turns = not enough signal to distill
const MAX_TRANSCRIPT_CHARS = 12_000;
const DISTILL_TIMEOUT_MS = 90_000;

// ------------------------------------------------------------------
// Internal types for the distillation JSON response
// ------------------------------------------------------------------

interface DistillSkill {
  name: string;
  description: string;
  tags: string[];
  body: string;
}

interface DistillFailure {
  kind: "bug" | "enhancement";
  title: string;
  detail: string;
}

interface DistillResult {
  skills: DistillSkill[];
  failures: DistillFailure[];
  notable_events: string[];
  operator_facts: string[];
  operator_goals: string[];
}

export interface DistillSummary {
  skipped: boolean;
  skillsCreated: number;
  skillsRefined: number;
  feedbackFiled: number;
  operatorFactsLearned: number;
  operatorGoalsLearned: number;
}

// ------------------------------------------------------------------
// Transcript builder
// ------------------------------------------------------------------

function buildTranscript(turns: FlashTurnRow[]): string {
  const lines: string[] = [];
  for (const t of turns) {
    if (t.role === "tool") continue; // skip raw tool-result noise
    const prefix = t.role === "user" ? "User" : "Assistant";
    lines.push(`**${prefix}:** ${t.content.slice(0, 1500)}`);
  }
  return lines.join("\n\n").slice(0, MAX_TRANSCRIPT_CHARS);
}

// ------------------------------------------------------------------
// Prompt + model call (non-streaming; cheap distillation pass)
// ------------------------------------------------------------------

function buildDistillPrompt(channel: string, peer: string, transcript: string): string {
  return `You are analyzing a Flash Lane conversation to extract reusable learnings.

## Session (channel: ${channel}, peer: ${peer})

${transcript}

---

Extract learnings. Respond ONLY with valid JSON — no markdown fence, no commentary:

{
  "skills": [
    {
      "name": "short-hyphenated-name",
      "description": "one-line description of what this skill does",
      "tags": ["tag"],
      "body": "## How-to\\n\\nActionable step-by-step instructions..."
    }
  ],
  "failures": [
    {
      "kind": "bug",
      "title": "concise title under 100 chars",
      "detail": "what broke / what was missing and why it matters"
    }
  ],
  "notable_events": ["One-line summary of a notable action or decision"],
  "operator_facts": ["Durable fact about the operator themself"],
  "operator_goals": ["A goal or deadline the operator is working toward"]
}

Rules:
- skills: Only if genuinely reusable across future sessions. Body = actionable recipe. 0–3 items.
- failures: "bug" = something broke or errored; "enhancement" = friction/unmet need/capability gap. 0–5 items.
- notable_events: Decisions, completed actions, context worth recalling later. 0–3 items.
- operator_facts: Durable facts about the OPERATOR as a person — their name, stated preferences,
  working rhythm, recurring frustrations. NOT task details, NOT goals. Only what is stated
  or clearly evidenced in the transcript; never guess. 0–3 items.
- operator_goals: Concrete objectives or deadlines the operator is working toward (e.g. "ship X by
  August", "grow revenue to Y"). Only ones the operator actually stated. NOT one-off task requests. 0–3 items.
- If nothing worth extracting, return {"skills":[],"failures":[],"notable_events":[],"operator_facts":[],"operator_goals":[]}.
- Never invent anything absent from the transcript.`;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

async function callLocalModel(prompt: string, endpoint: string, modelId: string): Promise<string> {
  const base = normalizeEndpoint(endpoint);
  const candidates = base.endsWith("/v1")
    ? [`${base}/chat/completions`]
    : [`${base}/v1/chat/completions`, `${base}/chat/completions`];

  const body = JSON.stringify({
    model: modelId,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    temperature: 0.3,
    max_tokens: 1024,
  });

  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(DISTILL_TIMEOUT_MS),
      });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      const choices = data.choices as Array<Record<string, unknown>> | undefined;
      const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
      return typeof msg?.content === "string" ? msg.content : "";
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("local model unreachable for distillation");
}

// ------------------------------------------------------------------
// Response parser (tolerant of markdown fences / extra text)
// ------------------------------------------------------------------

function parseDistillResult(raw: string): DistillResult {
  const cleaned = raw.replace(/^```[a-z]*\n?/m, "").replace(/\n?```$/m, "").trim();
  try {
    const obj = JSON.parse(cleaned) as Partial<DistillResult>;
    return {
      skills: Array.isArray(obj.skills)
        ? obj.skills.filter((s) => s && typeof s.name === "string" && typeof s.body === "string")
        : [],
      failures: Array.isArray(obj.failures)
        ? obj.failures.filter(
            (f) => f && typeof f.title === "string" && (f.kind === "bug" || f.kind === "enhancement"),
          )
        : [],
      notable_events: Array.isArray(obj.notable_events)
        ? obj.notable_events.filter((e) => typeof e === "string" && e.trim())
        : [],
      operator_facts: Array.isArray(obj.operator_facts)
        ? obj.operator_facts.filter((e) => typeof e === "string" && e.trim())
        : [],
      operator_goals: Array.isArray(obj.operator_goals)
        ? obj.operator_goals.filter((e) => typeof e === "string" && e.trim())
        : [],
    };
  } catch {
    return { skills: [], failures: [], notable_events: [], operator_facts: [], operator_goals: [] };
  }
}

// ------------------------------------------------------------------
// Operator model (persona/USER.md) writer
// ------------------------------------------------------------------

/** Pure: merge operator facts into USER.md content (dated/deduped/bounded). */
export function mergeOperatorFacts(
  existing: string,
  facts: string[],
  date: string,
): { content: string; added: number } {
  return mergeDatedSection(existing, facts, date, USER_SECTION_SPEC);
}

/** Pure: merge learned goals into GOALS.md content (dated/deduped/bounded). */
export function mergeOperatorGoals(
  existing: string,
  goals: string[],
  date: string,
): { content: string; added: number } {
  return mergeDatedSection(existing, goals, date, GOALS_SECTION_SPEC);
}

/** Merge dated learnings into a persona file on disk; announces via SSE. */
function learnIntoPersonaFile(
  brainRoot: string,
  file: "USER.md" | "GOALS.md",
  items: string[],
  merge: (existing: string, items: string[], date: string) => { content: string; added: number },
  reasonNoun: string,
): number {
  try {
    const dir = join(brainRoot, "persona");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, file);
    const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
    const date = new Date().toISOString().slice(0, 10);
    const { content, added } = merge(existing, items, date);
    if (added === 0) return 0;
    writeFileSync(path, content, "utf-8");
    broadcastEvent("flash:persona_updated", {
      file,
      reason: `learned ${added} ${reasonNoun} from a distilled session`,
      ts: new Date().toISOString(),
    });
    return added;
  } catch {
    return 0; // best-effort; Drive mount may be dehydrating
  }
}

// ------------------------------------------------------------------
// Memory note writer
// ------------------------------------------------------------------

function appendToMemoryNote(brainRoot: string, lines: string[], date: string): void {
  const dir = join(brainRoot, "persona", "memory");
  try {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${date}.md`);
    const content = lines.map((l) => `- ${l.trim()}`).join("\n") + "\n";
    appendFileSync(path, content, "utf-8");
  } catch {
    // best-effort; Drive mount may be dehydrating
  }
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Distill a single Flash session: extract skills, file feedback, append memory.
 * Marks the session as distilledAt on completion (or permanent failure) to
 * prevent the scheduler from retrying it on every poll. Never throws.
 */
export async function distillSession(
  sessionId: string,
  brainRoot?: string | null,
): Promise<DistillSummary> {
  const empty: DistillSummary = { skipped: false, skillsCreated: 0, skillsRefined: 0, feedbackFiled: 0, operatorFactsLearned: 0, operatorGoalsLearned: 0 };

  try {
    const session = getSession(sessionId);
    if (!session) return { ...empty, skipped: true };

    // Re-distills consume only turns SINCE the last distillation — sessions are
    // everlasting, so this is what makes learning incremental instead of
    // re-reading (and re-learning) the same history every pass.
    const turns = getTurnsForSession(sessionId, 200, session.distilledAt ?? undefined);
    const contentTurns = turns.filter((t) => t.role !== "tool" && t.content.trim());
    if (contentTurns.length < MIN_CONTENT_TURNS) {
      markSessionDistilled(sessionId);
      return { ...empty, skipped: true };
    }

    const profile = getQwenProfile();
    if (!profile) {
      // No local model — mark distilled so we don't spin on every poll
      markSessionDistilled(sessionId);
      return { ...empty, skipped: true };
    }

    const transcript = buildTranscript(turns);
    const prompt = buildDistillPrompt(session.channel, session.peer, transcript);

    let raw: string;
    try {
      raw = await callLocalModel(prompt, profile.primary.endpoint, profile.primary.modelId);
    } catch (err) {
      console.warn(`[flash:distill] model call failed for session ${sessionId}:`, err);
      // Don't mark distilled — let the loop retry after the model recovers
      return { ...empty, skipped: true };
    }

    const result = parseDistillResult(raw);
    const root = brainRoot ?? configuredBrainRootDir();
    let skillsCreated = 0;
    let skillsRefined = 0;
    let feedbackFiled = 0;

    for (const s of result.skills.slice(0, 3)) {
      if (!s.name.trim() || !s.body.trim()) continue;
      const r = await upsertSkill({
        name: s.name,
        description: s.description || s.name,
        tags: Array.isArray(s.tags) ? s.tags.filter((t) => typeof t === "string") : [],
        body: s.body,
        source: `flash:distill:${sessionId}`,
        compat: ["all"],
        trusted: true,
      });
      if (r.created) skillsCreated++;
      else if (r.refined) skillsRefined++;
    }

    for (const f of result.failures.slice(0, 5)) {
      if (!f.title.trim()) continue;
      const { created } = recordFeedbackDedup({
        kind: f.kind === "enhancement" ? "enhancement" : "bug",
        title: f.title.slice(0, 200),
        detail: (f.detail ?? "").slice(0, 1000),
        source: `flash:distill:${sessionId}`,
      });
      if (created) feedbackFiled++;
    }

    if (root && result.notable_events.length > 0) {
      const date = new Date().toISOString().slice(0, 10);
      appendToMemoryNote(root, result.notable_events.slice(0, 3), date);
    }

    // Operator model + goal ledger: only sessions where the peer IS the operator
    // (console/voice). Channel peers (iMessage senders) and the heartbeat's own
    // sessions must not write someone else's facts/goals into the persona files.
    let operatorFactsLearned = 0;
    let operatorGoalsLearned = 0;
    if (root && session.peer === "operator") {
      if (result.operator_facts.length > 0) {
        operatorFactsLearned = learnIntoPersonaFile(
          root,
          "USER.md",
          result.operator_facts.slice(0, 3),
          mergeOperatorFacts,
          "operator fact(s)",
        );
      }
      if (result.operator_goals.length > 0) {
        operatorGoalsLearned = learnIntoPersonaFile(
          root,
          "GOALS.md",
          result.operator_goals.slice(0, 3),
          mergeOperatorGoals,
          "operator goal(s)",
        );
      }
    }

    markSessionDistilled(sessionId);

    const changed = skillsCreated + skillsRefined + feedbackFiled + operatorFactsLearned + operatorGoalsLearned;
    if (changed > 0) {
      console.log(
        `[flash:distill] ${sessionId}: +${skillsCreated} skills, ${skillsRefined} refined, ${feedbackFiled} feedback, ${operatorFactsLearned} operator facts, ${operatorGoalsLearned} goals`,
      );
    }

    return { skipped: false, skillsCreated, skillsRefined, feedbackFiled, operatorFactsLearned, operatorGoalsLearned };
  } catch (err) {
    console.warn(`[flash:distill] unexpected error for session ${sessionId}:`, err);
    try { markSessionDistilled(sessionId); } catch { /* ignore */ }
    return { ...empty, skipped: true };
  }
}
