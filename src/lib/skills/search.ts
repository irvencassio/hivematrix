/**
 * Skill picker ranking — "find the skill I want without remembering its name."
 *
 * A cheap, deterministic ranker over the skill index (name/description/tags). The
 * picker calls this so the operator (or voice) can fuzzy-find an installed skill
 * instead of recalling exact names. Pure — fully testable.
 */

import { skillRunsOn, type SkillHarness, type SkillIndexEntry } from "./contracts";
import compatibilityRegistry from "./skill_compatibility.json";

/** Compatibility flags for a single skill in the static registry. */
export interface SkillCompatibilityEntry {
  claude: boolean;
  codex: boolean;
  qwen: boolean;
  deepseek?: boolean;
  kind: string;
  description: string;
}

/**
 * Look up the compatibility object for a skill by its registry ID.
 * Returns null when the skill ID is not in the static registry.
 */
export function getSkillCompatibility(skillId: string): SkillCompatibilityEntry | null {
  if (!skillId) return null;
  const skills = compatibilityRegistry.skills as Record<string, SkillCompatibilityEntry>;
  if (!Object.prototype.hasOwnProperty.call(skills, skillId)) return null;
  return skills[skillId];
}

export interface RankedSkill extends SkillIndexEntry { score: number }

function norm(s: string): string {
  return s.toLowerCase().trim();
}

/** Score one entry against a normalized query. 0 = no match. */
function scoreEntry(e: SkillIndexEntry, q: string): number {
  const name = norm(e.name);
  const desc = norm(e.description);
  const tags = e.tags.map(norm);
  let score = 0;
  if (name === q) score += 100;
  else if (name.startsWith(q)) score += 60;
  else if (name.includes(q)) score += 40;
  if (tags.some((t) => t === q)) score += 30;
  else if (tags.some((t) => t.includes(q))) score += 15;
  if (desc.includes(q)) score += 10;
  // small boost for proven skills so ties favor what actually gets used
  if (score > 0) score += Math.min(e.useCount, 9);
  return score;
}

/** Filter a skill index to entries compatible with the given AI model/harness. Pure. */
export function filterSkillsByHarness(entries: SkillIndexEntry[], harness: SkillHarness): SkillIndexEntry[] {
  return entries.filter((e) => skillRunsOn(e.compat, harness));
}

/**
 * Rank skills for a query. Empty query → all, most-used first (the default
 * "what do I have" view). Non-empty → only matches, best first. Pure.
 */
export function rankSkills(entries: SkillIndexEntry[], query: string): RankedSkill[] {
  const q = norm(query);
  if (!q) {
    return [...entries]
      .map((e) => ({ ...e, score: 0 }))
      .sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name));
  }
  // support multi-word queries: every term must contribute
  const terms = q.split(/\s+/).filter(Boolean);
  return entries
    .map((e) => {
      const scores = terms.map((t) => scoreEntry(e, t));
      const total = scores.every((s) => s > 0) ? scores.reduce((a, b) => a + b, 0) : 0;
      return { ...e, score: total };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || b.useCount - a.useCount || a.name.localeCompare(b.name));
}
