/**
 * Last-resort fallback: seed the `goals` table from the operator's
 * persona/GOALS.md when the table is empty and self-heal
 * (db/self-heal.ts's healEmptiedTables) found no backup with usable rows
 * either — e.g. a fresh machine's first run, or every backup happens to
 * also be hollowed out.
 *
 * Additive-only and one-shot: only ever acts when `goals` is genuinely
 * empty, the same "empty == data loss, non-empty == leave alone" contract
 * self-heal already uses. Never overwrites, never fires again once the
 * operator has any goal row (including one they later deliberately
 * delete). Best-effort: a missing/unreadable GOALS.md or a dehydrating
 * Drive mount must never crash boot (mirrors flash/distill.ts's
 * learnIntoPersonaFile `catch { return 0 }` pattern).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { parseSectionBullets } from "@/lib/brain/persona-section";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { listGoals, upsertGoal } from "@/lib/goals/store";

/**
 * Goal titles found in GOALS.md content — a thin, named, tested pass-
 * through to persona-section.ts's parseSectionBullets (the existing
 * read-side companion to GOALS_SECTION_SPEC's write side, already used on
 * this exact file by voice/command-turn.ts's readSpokenGoals). Kept as
 * its own seam here so a future change to that shared parser's contract
 * is caught by this feature's own tests, not just discovered at runtime.
 * Header-agnostic like its precedent: a bullet is picked up wherever it
 * appears in the file, not only under "## Active goals".
 */
export function parseGoalTitlesFromGoalsMd(content: string): string[] {
  return parseSectionBullets(content);
}

export interface SeedGoalsResult {
  /** Number of goal rows created. 0 means "no-op" for any reason (table
   * already had rows, no brain root, no GOALS.md file, or a failure). */
  seeded: number;
}

/**
 * Seed `goals` from persona/GOALS.md, but only if the table is currently
 * empty. Safe to call unconditionally on every boot (mirrors
 * healEmptiedTables's own self-contained emptiness check) — a non-empty
 * table, including one the operator has deliberately emptied back out
 * after deleting a seeded goal, is left untouched.
 *
 * `brainRoot` is an optional override (tests only); production omits it
 * and falls back to configuredBrainRootDir(), matching flash/distill.ts's
 * distillSession(sessionId, brainRoot?, ...) convention. Pass `null`
 * explicitly to simulate memory/brain being disabled.
 */
export function seedGoalsFromPersonaIfEmpty(brainRoot?: string | null): SeedGoalsResult {
  try {
    if (listGoals().length > 0) return { seeded: 0 };

    const root = brainRoot !== undefined ? brainRoot : configuredBrainRootDir();
    if (!root) return { seeded: 0 };

    const path = join(root, "persona", "GOALS.md");
    if (!existsSync(path)) return { seeded: 0 };

    const content = readFileSync(path, "utf-8");
    const titles = parseGoalTitlesFromGoalsMd(content);

    let seeded = 0;
    titles.forEach((title, i) => {
      try {
        upsertGoal({ title, cadence: "milestone", status: "active", sortOrder: i });
        seeded++;
      } catch {
        // Skip this one title; don't lose credit for the others already seeded.
      }
    });

    return { seeded };
  } catch {
    return { seeded: 0 }; // best-effort; brain root may be an unmounted/dehydrating Drive
  }
}
