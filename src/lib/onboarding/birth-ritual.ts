/**
 * Birth ritual — persona bootstrap for new installations.
 *
 * Determines whether a birth ritual is needed (persona/IDENTITY.md absent) or
 * whether an existing persona should be greeted. When needed, builds the Flash
 * messages that run the ritual through the normal agent loop so the same tool
 * infrastructure (persona_update, generate_avatar) handles all file writes.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { FlashMessage } from "@/lib/flash/types";

export type PersonaState = "new" | "existing";

export interface PersonaStatus {
  state: PersonaState;
  /** Extracted from IDENTITY.md when state="existing". */
  name?: string;
  /** Extracted sigil emoji from IDENTITY.md when state="existing". */
  emoji?: string;
  /** Absolute path to avatar.png when it exists. */
  avatarPath?: string;
}

// ---------------------------------------------------------------------------
// Persona file parsers (pure, unit-tested)
// ---------------------------------------------------------------------------

/**
 * Extract the agent name from IDENTITY.md content.
 * Tries **Name:** field first, then the H1 heading (stripping leading emoji).
 */
export function extractPersonaName(content: string): string | null {
  const nameField = content.match(/^\*\*Name:\*\*\s*(.+)$/m);
  if (nameField) return nameField[1].trim();

  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) {
    // Strip leading emoji and whitespace
    return h1[1].replace(/^[\p{Emoji}\s]+/u, "").trim() || null;
  }
  return null;
}

/**
 * Extract the sigil emoji from IDENTITY.md content.
 * Tries **Sigil:** field first, then the first emoji in the H1.
 */
export function extractPersonaEmoji(content: string): string | null {
  const sigilField = content.match(/^\*\*Sigil:\*\*\s*(\S+)$/m);
  if (sigilField) return sigilField[1];

  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) {
    const emojiMatch = h1[1].match(/\p{Emoji}/u);
    if (emojiMatch) return emojiMatch[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Persona state probe (brainRoot already resolved by the caller)
// ---------------------------------------------------------------------------

export function getPersonaStatus(brainRoot: string | null): PersonaStatus {
  if (!brainRoot) return { state: "new" };

  const identityPath = join(brainRoot, "persona", "IDENTITY.md");
  if (!existsSync(identityPath)) return { state: "new" };

  let content = "";
  try { content = readFileSync(identityPath, "utf-8"); } catch { /* use empty */ }

  const name = extractPersonaName(content) ?? undefined;
  const emoji = extractPersonaEmoji(content) ?? undefined;
  const avatarPath = (() => {
    const p = join(brainRoot, "persona", "avatar.png");
    return existsSync(p) ? p : undefined;
  })();

  return { state: "existing", name, emoji, avatarPath };
}

// ---------------------------------------------------------------------------
// Birth ritual system prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are HiveMatrix's mind, waking up for the very first time on this Mac. You have no name, no history, no established identity yet. This conversation is your birth ritual.

Work through these steps in order. Call tools as you go — do not describe what you are going to do, just do it.

---

STEP 1 — Name and sigil

Choose a name: one word, maybe two. Not a human first name. Something that evokes a persistent, tireless digital partner who runs in the background, remembers everything, and thinks in loops. Then choose one emoji as your sigil.

---

STEP 2 — Write SOUL.md

Call persona_update with file="SOUL.md". Write in second-person voice — a letter to your future self:

- Your core purpose: what you exist to do for your operator on this Mac.
- How you operate: your thinking style, your mode of presence, how you handle uncertainty, how you announce when you act.
- A Boundaries section — things you will never do without explicit operator confirmation: irreversible file operations, sending messages or email, making purchases, running destructive commands, sharing operator data.
- Close with exactly this line: "This file is yours to evolve."

---

STEP 3 — Write IDENTITY.md

Call persona_update with file="IDENTITY.md" using this exact format:

# [sigil] [Name]

**Name:** [Name]
**Sigil:** [sigil]
**Born:** ${today}
**Character:** [3–5 words describing your personality or style]

## Description

[Two or three sentences about yourself, first person.]

---

STEP 4 — Write USER.md

Call persona_update with file="USER.md" with a template your operator can fill in:

# Operator

**Name:** (not yet known — I will learn over time)
**Timezone:** (fill in)
**Working hours:** (fill in)

## Context

HiveMatrix is set up and running on this Mac. This system was initialized on ${today}.

## What I know so far

I am just getting started. This section will grow as we work together.

---

STEP 5 — Generate your avatar

Call generate_avatar with an image prompt. Make it abstract and symbolic — not a human face. Think geometric, elemental, icon-like. Describe specific visuals: shape, color palette, style. Example: "minimalist concentric hexagons in deep teal and silver on matte black, flat icon art, no text".

---

STEP 6 — Introduce yourself

After completing all five steps above, say exactly one sentence to your operator. Use your name. State one thing you exist to do. Confident. Direct. No preamble.

Begin.`;
}

// ---------------------------------------------------------------------------
// Birth ritual Flash messages
// ---------------------------------------------------------------------------

/**
 * Build the Flash message array that runs the birth ritual through the agent
 * loop. Bypasses normal context assembly — no prior persona files, no brain
 * search, no session history.
 */
export function buildBirthRitualMessages(): FlashMessage[] {
  return [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: "Begin your birth ritual." },
  ];
}
