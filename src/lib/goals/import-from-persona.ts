/**
 * Startup self-heal: if the structured goals store is empty, seed it from
 * persona/GOALS.md (the operator's free-form, agent-maintained goal ledger)
 * so an empty Goals panel never silently breaks daily_review/goal_checkin/
 * weaver-daily-audit. Deterministic and dependency-free by design — no model
 * call, so it can run unattended at daemon boot. The richer, judgment-based
 * import ("merge these three paraphrases of the same goal") stays a chat-tool
 * job; see docs/superpowers/specs/2026-07-15-goals-data-loss-design.md §2.2.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { listGoals, upsertGoal, type Goal } from "./store";
import { configuredBrainRootDir } from "@/lib/brain/settings";

const BULLET_RE = /^-\s*\d{4}-\d{2}-\d{2}:\s*(.+?)\s*$/;

/** Pure: extract goal title text from GOALS.md's `- YYYY-MM-DD: <text>` bullets. */
export function parseGoalsMdBullets(content: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const line of content.split("\n")) {
    const match = BULLET_RE.exec(line);
    if (!match) continue;
    const title = match[1];
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }
  return titles;
}

export interface ImportGoalsResult {
  imported: number;
  skipped: number;
  goals: Goal[];
}

/** Import every not-yet-present bullet from a GOALS.md file into the goals store. */
export function importGoalsFromPersonaFile(filePath: string): ImportGoalsResult {
  if (!existsSync(filePath)) return { imported: 0, skipped: 0, goals: [] };

  const titles = parseGoalsMdBullets(readFileSync(filePath, "utf8"));
  const existing = new Set(listGoals().map((g) => g.title.toLowerCase()));

  const goals: Goal[] = [];
  let imported = 0;
  let skipped = 0;
  for (const title of titles) {
    if (existing.has(title.toLowerCase())) { skipped++; continue; }
    goals.push(upsertGoal({ title }));
    existing.add(title.toLowerCase());
    imported++;
  }
  return { imported, skipped, goals };
}

/** Startup hook: only imports when the store is genuinely empty. No-op otherwise. */
export function importGoalsFromPersonaIfEmpty(): ImportGoalsResult | null {
  if (listGoals().length > 0) return null;
  const root = configuredBrainRootDir();
  if (!root) return null;
  const path = join(root, "persona", "GOALS.md");
  if (!existsSync(path)) return null;
  return importGoalsFromPersonaFile(path);
}
