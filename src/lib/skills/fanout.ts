/**
 * Cross-harness fan-out — render trusted skills into the dirs Claude Code, Codex,
 * and qwen-code each read from. SKILL.md is one open standard, but every harness
 * looks in a DIFFERENT directory, so portability = writing the canonical skill to
 * all three (`<dir>/<slug>/SKILL.md`).
 *
 * Safety: only TRUSTED skills are written (an unapproved pulled skill never
 * auto-loads into a harness), compat is honored per harness, and we only manage
 * slugs we wrote (a manifest), so a user's own same-named skills are never
 * clobbered or deleted. IO is best-effort; the pure planner is testable.
 */

import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import { skillRunsOn, skillSlug, type Skill, type SkillHarness } from "./contracts";
import { renderStandardSkillMd } from "./standard";

export interface HarnessTarget { id: SkillHarness; dir: string }

/** Where each harness reads personal skills from (home-expanded). */
export function harnessTargets(home = homedir()): HarnessTarget[] {
  return [
    { id: "claude", dir: join(home, ".claude", "skills") },
    { id: "codex", dir: join(home, ".agents", "skills") }, // Codex ("ChatGPT") uses .agents/skills
    { id: "qwen", dir: join(home, ".qwen", "skills") },
  ];
}

export interface FanoutTargetPlan { id: SkillHarness; dir: string; write: string[]; remove: string[] }

/**
 * Pure: per target, the slugs to write (trusted + compat-matched) and the slugs
 * to remove (previously-managed but no longer desired). `managed` maps target id
 * → slugs HiveMatrix wrote last time.
 */
export function planFanout(
  skills: Skill[],
  targets: HarnessTarget[],
  managed: Record<string, string[]>,
): FanoutTargetPlan[] {
  return targets.map((t) => {
    const desired = skills
      .filter((s) => s.trusted)                  // trust gate
      .filter((s) => skillRunsOn(s.compat, t.id)) // compat gate
      .map((s) => skillSlug(s.name));
    const desiredSet = new Set(desired);
    const prev = managed[t.id] ?? [];
    return {
      id: t.id, dir: t.dir,
      write: [...desiredSet],
      remove: prev.filter((slug) => !desiredSet.has(slug)),
    };
  });
}

const MANIFEST = ".hivematrix-managed.json";

async function readManifest(dir: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(join(dir, MANIFEST), "utf-8");
    const parsed = JSON.parse(raw) as { slugs?: unknown };
    return Array.isArray(parsed.slugs) ? parsed.slugs.filter((s): s is string => typeof s === "string") : [];
  } catch { return []; }
}

async function writeManifest(dir: string, slugs: string[]): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, MANIFEST), JSON.stringify({ slugs, updatedAt: new Date().toISOString() }, null, 2));
  } catch { /* best effort */ }
}

export interface FanoutTargetResult { id: SkillHarness; dir: string; written: number; removed: number; skipped: string[] }

/**
 * Write trusted skills into each harness dir. Returns per-target counts.
 * Best-effort; never throws.
 */
export async function fanOutSkills(skills: Skill[], targets = harnessTargets()): Promise<FanoutTargetResult[]> {
  const bySlug = new Map(skills.map((s) => [skillSlug(s.name), s]));
  const managed: Record<string, string[]> = {};
  for (const t of targets) managed[t.id] = await readManifest(t.dir);
  const plans = planFanout(skills, targets, managed);

  const results: FanoutTargetResult[] = [];
  for (const plan of plans) {
    let written = 0;
    const skipped: string[] = [];
    const nowManaged: string[] = [];
    const prevManaged = new Set(managed[plan.id] ?? []);

    for (const slug of plan.write) {
      const skill = bySlug.get(slug);
      if (!skill) continue;
      const skillDir = join(plan.dir, slug);
      const file = join(skillDir, "SKILL.md");
      // Don't clobber a user's own same-named skill we didn't write.
      if (!prevManaged.has(slug)) {
        try { await fs.access(skillDir); skipped.push(slug); continue; } catch { /* absent → ours to write */ }
      }
      try {
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(file, renderStandardSkillMd(skill));
        written++;
        nowManaged.push(slug);
      } catch { /* skip on error */ }
    }

    let removed = 0;
    for (const slug of plan.remove) {
      try { await fs.rm(join(plan.dir, slug), { recursive: true, force: true }); removed++; } catch { /* ignore */ }
    }

    await writeManifest(plan.dir, nowManaged);
    results.push({ id: plan.id, dir: plan.dir, written, removed, skipped });
  }
  return results;
}
