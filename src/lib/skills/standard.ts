/**
 * Canonical (portable) skill export — the open agentskills.io `SKILL.md` form.
 *
 * HiveMatrix's on-disk skill file (renderSkillFile) carries internal frontmatter
 * (uses/revisions/trusted/...). For fan-out to other harnesses and for sharing we
 * want the CLEAN standard: required `name`/`description` + a `metadata` map for our
 * extras (which the spec ignores). Pure — easy to test.
 */

import { skillSlug, type Skill } from "./contracts";

/** Render a skill as a spec-compliant SKILL.md (frontmatter + body). Pure. */
export function renderStandardSkillMd(skill: Skill): string {
  // name must be the slug (lowercase, hyphenated, matches the parent directory).
  const name = skillSlug(skill.name);
  const description = skill.description.replace(/\n/g, " ").trim().slice(0, 1024);
  const compat = (skill.compat.length ? skill.compat : ["all"]).join(", ");
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "metadata:",
    `  kind: ${skill.kind}`,
    `  compat: ${compat}`,
    `  source: ${skill.source || "hivematrix"}`,
    "---",
    "",
    skill.body.trim(),
    "",
  ];
  return lines.join("\n");
}

/** The directory name a skill occupies under a harness skills dir (`<slug>/SKILL.md`). */
export function standardSkillDirName(skill: Pick<Skill, "name">): string {
  return skillSlug(skill.name);
}
