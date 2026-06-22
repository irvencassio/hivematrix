/**
 * Skill library storage under <brain>/skills/. Same cloud-stall discipline as the
 * brain module (async, per-file-timed reads — the root may be a dehydrating
 * Drive mount). Distillation upserts: a re-distilled skill with the same slug
 * REFINES the existing file (new body, revisions++) rather than duplicating.
 */

import { promises as fs } from "fs";
import { join } from "path";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import {
  renderSkillFile, parseSkillFile, skillFilename, skillSlug, skillHasInput,
  type Skill, type SkillIndexEntry, type SkillHarness, type SkillKind, type SkillInterpreter, type SkillScope,
} from "./contracts";

const READ_TIMEOUT_MS = 3_000;
const MAX_SKILLS = 300;

export function skillsDir(brainRoot = configuredBrainRootDir()): string | null {
  return brainRoot ? join(brainRoot, "skills") : null;
}

async function readWithTimeout(path: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), READ_TIMEOUT_MS); });
  const read = fs.readFile(path, "utf-8").then((c) => c as string).catch(() => null);
  try { return await Promise.race([read, timeout]); } finally { if (timer) clearTimeout(timer); }
}

export async function readSkill(name: string): Promise<Skill | null> {
  const dir = skillsDir();
  if (!dir) return null;
  const raw = await readWithTimeout(join(dir, skillFilename(name)));
  return raw ? parseSkillFile(raw) : null;
}

/** Frontmatter-level index of the library (bounded, timed). */
export async function listSkills(): Promise<SkillIndexEntry[]> {
  const dir = skillsDir();
  if (!dir) return [];
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((f) => f.endsWith(".md")).slice(0, MAX_SKILLS);
  } catch {
    return []; // dir doesn't exist yet
  }
  const out: SkillIndexEntry[] = [];
  for (const file of names) {
    const raw = await readWithTimeout(join(dir, file));
    const skill = raw ? parseSkillFile(raw) : null;
    if (skill) out.push({
      name: skill.name, description: skill.description, tags: skill.tags,
      useCount: skill.useCount, compat: skill.compat, hasInput: skillHasInput(skill.body),
      trusted: skill.trusted, kind: skill.kind, scope: skill.scope, signed: !!skill.signature,
    });
  }
  // Most-used first (proven skills surface), then alphabetical.
  return out.sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name));
}

/** Full skills (not just the index) — bounded, timed. For fan-out + prune, which
 * need `body` and `lastUsedAt` that the index entry omits. */
export async function readAllSkills(): Promise<Skill[]> {
  const dir = skillsDir();
  if (!dir) return [];
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((f) => f.endsWith(".md")).slice(0, MAX_SKILLS);
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const file of names) {
    const raw = await readWithTimeout(join(dir, file));
    const skill = raw ? parseSkillFile(raw) : null;
    if (skill) out.push(skill);
  }
  return out;
}

export interface UpsertSkillInput {
  name: string;
  description: string;
  tags?: string[];
  body: string;
  source: string;
  compat?: SkillHarness[];
  /** Imported skills should pass false; distilled/manual default true. */
  trusted?: boolean;
  kind?: SkillKind;
  interpreter?: SkillInterpreter;
  /** Provenance (set by scoped sync / publish). */
  scope?: SkillScope;
  signedBy?: string;
  signature?: string;
  now?: string;
}

export interface UpsertSkillResult {
  created: boolean;
  refined: boolean;
  path: string | null;
}

/**
 * Create a skill, or REFINE an existing one with the same slug (replace body if
 * it changed, bump revisions). Returns what happened. Never throws.
 */
export async function upsertSkill(input: UpsertSkillInput): Promise<UpsertSkillResult> {
  const dir = skillsDir();
  if (!dir) return { created: false, refined: false, path: null };
  const now = input.now ?? new Date().toISOString();
  const path = join(dir, skillFilename(input.name));

  const existingRaw = await readWithTimeout(path);
  const existing = existingRaw ? parseSkillFile(existingRaw) : null;

  let skill: Skill;
  let result: UpsertSkillResult;
  if (existing) {
    const bodyChanged = existing.body.trim() !== input.body.trim();
    skill = {
      ...existing,
      description: input.description || existing.description,
      tags: input.tags && input.tags.length ? input.tags : existing.tags,
      body: bodyChanged ? input.body : existing.body,
      updatedAt: now,
      revisions: bodyChanged ? existing.revisions + 1 : existing.revisions,
      scope: input.scope ?? existing.scope,
      signedBy: input.signedBy ?? existing.signedBy,
      signature: input.signature ?? existing.signature,
    };
    result = { created: false, refined: bodyChanged, path };
  } else {
    skill = {
      name: input.name,
      description: input.description,
      tags: input.tags ?? [],
      body: input.body,
      source: input.source,
      createdAt: now,
      updatedAt: now,
      revisions: 1,
      useCount: 0,
      lastUsedAt: "",
      compat: input.compat && input.compat.length ? input.compat : ["all"],
      trusted: input.trusted !== false, // default trusted; import passes false
      kind: input.kind === "script" ? "script" : "instruction",
      interpreter: input.interpreter ?? "bash",
      scope: input.scope,
      signedBy: input.signedBy,
      signature: input.signature,
    };
    result = { created: true, refined: false, path };
  }

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path, renderSkillFile(skill));
    return result;
  } catch {
    return { created: false, refined: false, path: null };
  }
}

/**
 * Record that an agent applied a skill: bump useCount + lastUsedAt, and if the
 * agent supplied a refinement, append it to the body and bump revisions. This is
 * "improves during use" — the library sharpens from real application, not just
 * distillation. Never throws.
 */
export async function markSkillUsed(
  name: string,
  opts: { refinement?: string; now?: string } = {},
): Promise<{ ok: boolean; useCount: number; refined: boolean }> {
  const dir = skillsDir();
  if (!dir) return { ok: false, useCount: 0, refined: false };
  const path = join(dir, skillFilename(name));
  const raw = await readWithTimeout(path);
  const skill = raw ? parseSkillFile(raw) : null;
  if (!skill) return { ok: false, useCount: 0, refined: false };

  const now = opts.now ?? new Date().toISOString();
  const refinement = opts.refinement?.trim();
  const refined = !!refinement;
  const updated: Skill = {
    ...skill,
    useCount: skill.useCount + 1,
    lastUsedAt: now,
    updatedAt: now,
    body: refined ? `${skill.body.trim()}\n\n## Refinement (${now.slice(0, 10)})\n${refinement}` : skill.body,
    revisions: refined ? skill.revisions + 1 : skill.revisions,
  };

  try {
    await fs.writeFile(path, renderSkillFile(updated));
    return { ok: true, useCount: updated.useCount, refined };
  } catch {
    return { ok: false, useCount: 0, refined: false };
  }
}

/** Approve/revoke an imported skill so it's (not) auto-shown to agents. */
export async function setSkillTrusted(name: string, trusted: boolean): Promise<boolean> {
  const dir = skillsDir();
  if (!dir) return false;
  const path = join(dir, skillFilename(name));
  const raw = await readWithTimeout(path);
  const skill = raw ? parseSkillFile(raw) : null;
  if (!skill) return false;
  try {
    await fs.writeFile(path, renderSkillFile({ ...skill, trusted }));
    return true;
  } catch {
    return false;
  }
}

/** Delete a skill file. Returns false if absent/unremovable. */
export async function deleteSkill(name: string): Promise<boolean> {
  const dir = skillsDir();
  if (!dir) return false;
  try {
    await fs.unlink(join(dir, skillFilename(name)));
    return true;
  } catch {
    return false;
  }
}

export { skillSlug };
