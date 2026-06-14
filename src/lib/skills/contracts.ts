/**
 * Skill library — durable, reusable procedural recipes the system distills from
 * experience (directive retrospectives) and applies later. The idea HiveMatrix
 * took from Hermes's self-improving loop, built on our own brain memory: a skill
 * is a markdown file with frontmatter under <brain>/skills/, so it's already
 * discoverable via brain_search and the Skill tool. No new runtime.
 *
 * Format is agentskills.io-shaped: frontmatter (name/description/tags/...) + a
 * markdown body that says when to use the skill and how.
 */

/** Harnesses a skill can run under. "all" = harness-agnostic instructions. */
export const SKILL_HARNESSES = ["claude", "codex", "qwen"] as const;
export type SkillHarness = (typeof SKILL_HARNESSES)[number] | "all";

/**
 * Skill kind. "instruction" = an LLM-followed recipe (the default). "script" = a
 * deterministic executable the agent/operator runs verbatim — same answer every
 * time, no model in the loop. Script skills are AI-callable, sharable, and (being
 * code) only run when TRUSTED.
 */
export type SkillKind = "instruction" | "script";
export const SKILL_INTERPRETERS = ["bash", "sh", "node", "python3", "python"] as const;
export type SkillInterpreter = (typeof SKILL_INTERPRETERS)[number];

export function coerceInterpreter(v: string | undefined): SkillInterpreter {
  return (SKILL_INTERPRETERS as readonly string[]).includes(v ?? "") ? (v as SkillInterpreter) : "bash";
}

export interface Skill {
  name: string;
  description: string;
  tags: string[];
  body: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  revisions: number;
  /** Times an agent reported applying this skill (proves it earns its keep). */
  useCount: number;
  lastUsedAt: string;
  /** Which harnesses this skill works with (["all"] = any). */
  compat: SkillHarness[];
  /**
   * Whether the skill is trusted to be auto-shown to agents. Distilled/manual
   * skills are trusted; IMPORTED skills (shared/public — instructions an agent
   * would follow) are untrusted until the operator approves, so a malicious
   * shared skill can't silently influence agents.
   */
  trusted: boolean;
  /** "instruction" (LLM recipe, default) or "script" (deterministic executable). */
  kind: SkillKind;
  /** For script skills: the interpreter (bash/node/python3). */
  interpreter: SkillInterpreter;
}

/** One line per skill for an index/listing (cheap — frontmatter only). */
export interface SkillIndexEntry {
  name: string;
  description: string;
  tags: string[];
  useCount: number;
  compat: SkillHarness[];
  /** True when the skill body has a {{input}} placeholder (takes text input). */
  hasInput: boolean;
  trusted: boolean;
  kind: SkillKind;
}

/** A skill is harness-agnostic if compat is empty or contains "all". */
export function skillRunsOn(compat: SkillHarness[], harness: SkillHarness): boolean {
  return compat.length === 0 || compat.includes("all") || compat.includes(harness);
}

/** Does the skill body declare a text-input slot? */
export function skillHasInput(body: string): boolean {
  return /\{\{\s*input\s*\}\}/i.test(body);
}

/** Fill the {{input}} placeholder (or append the input if there's no placeholder). */
export function applySkillInput(body: string, input: string): string {
  if (skillHasInput(body)) return body.replace(/\{\{\s*input\s*\}\}/gi, input);
  return input.trim() ? `${body.trim()}\n\n--- Input ---\n${input.trim()}` : body;
}

function parseCompat(raw: string | undefined): SkillHarness[] {
  if (!raw) return ["all"];
  const parts = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const valid = parts.filter((p): p is SkillHarness => p === "all" || (SKILL_HARNESSES as readonly string[]).includes(p));
  return valid.length ? valid : ["all"];
}

export function skillSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "skill";
}

export function skillFilename(name: string): string {
  return `${skillSlug(name)}.md`;
}

function fmList(values: string[]): string {
  return values.map((v) => v.trim()).filter(Boolean).join(", ");
}

/** Render a Skill to its on-disk markdown (frontmatter + body). Pure. */
export function renderSkillFile(skill: Skill): string {
  const fm = [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description.replace(/\n/g, " ").trim()}`,
    `tags: ${fmList(skill.tags)}`,
    `source: ${skill.source}`,
    `created: ${skill.createdAt}`,
    `updated: ${skill.updatedAt}`,
    `revisions: ${skill.revisions}`,
    `uses: ${skill.useCount}`,
    `lastUsed: ${skill.lastUsedAt}`,
    `compat: ${fmList(skill.compat.length ? skill.compat : ["all"])}`,
    `trusted: ${skill.trusted}`,
    `kind: ${skill.kind}`,
    `interpreter: ${skill.interpreter}`,
    "---",
  ].join("\n");
  return `${fm}\n\n${skill.body.trim()}\n`;
}

/** Parse a skill markdown file back into a Skill. Returns null if malformed. */
export function parseSkillFile(content: string): Skill | null {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  if (!fm.name) return null;
  const revisions = parseInt(fm.revisions ?? "1", 10);
  const uses = parseInt(fm.uses ?? "0", 10);
  return {
    name: fm.name,
    description: fm.description ?? "",
    tags: (fm.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    body: m[2].trim(),
    source: fm.source ?? "manual",
    createdAt: fm.created ?? "",
    updatedAt: fm.updated ?? "",
    revisions: Number.isFinite(revisions) ? revisions : 1,
    useCount: Number.isFinite(uses) ? uses : 0,
    lastUsedAt: fm.lastUsed ?? "",
    compat: parseCompat(fm.compat),
    trusted: fm.trusted !== "false", // default true (existing skills) unless explicitly false
    kind: fm.kind === "script" ? "script" : "instruction",
    interpreter: coerceInterpreter(fm.interpreter),
  };
}

/** A compact, model-facing index of the skill library. "" when empty. */
export function formatSkillIndex(entries: SkillIndexEntry[]): string {
  if (entries.length === 0) return "";
  return [
    "--- Skill Library ---",
    "Reusable recipes distilled from past work. Before solving a recurring task, check if a skill applies — read its full text with brain_search or read_file (under the brain root's skills/ folder), then follow it. After you apply one, call skill_used (or POST /skills/<name>/used) so it earns its keep — include a one-line refinement if you improved on it.",
    ...entries.map((e) => `- ${e.name}${e.kind === "script" ? " [script]" : ""}${e.useCount > 0 ? ` (used ${e.useCount}×)` : ""}: ${e.description}`),
  ].join("\n");
}
