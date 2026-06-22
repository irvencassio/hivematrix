/**
 * Tiered sharing scopes (personal/team/org/public) over git sources.
 *
 * Each scope is a git repo. Precedence personal > team > org > public: when the
 * same skill slug appears in multiple scopes, the more-local one wins. Trust is
 * decided per scope: personal is trusted; team/org are trusted only if signed by
 * a trusted key; public is NEVER auto-trusted (the operator approves). Pure —
 * the git IO lives in sync.ts.
 */

import { homedir } from "os";
import { join } from "path";
import { SKILL_SCOPES, coerceScope, type SkillScope } from "./contracts";

/** Precedence: lower index wins on a slug collision. */
export const SCOPE_PRECEDENCE: SkillScope[] = ["personal", "team", "org", "public"];

export function scopeRank(scope: SkillScope): number {
  const i = SCOPE_PRECEDENCE.indexOf(scope);
  return i === -1 ? SCOPE_PRECEDENCE.length : i;
}

export interface SkillSource {
  scope: SkillScope;
  /** "git" (clone/pull a repo) or "registry" (fetch a JSON index of SKILL.md URLs). */
  kind: "git" | "registry";
  /** git source: clone URL + local cache dir. */
  repoUrl: string;
  branch: string;
  dir: string;
  /** registry source: URL returning { skills: [{ name, description, kind?, url }] }. */
  indexUrl?: string;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function defaultDir(scope: SkillScope): string {
  return join(homedir(), ".hivematrix", `skills-${scope}`);
}

/**
 * Parse skill sources from config. Supports the new `skillsSync.sources[]` AND
 * the slice-1 single `skillsSync.repoUrl` (treated as a personal source) for
 * back-compat. Pure.
 */
export function parseSkillSources(config: Record<string, unknown>): SkillSource[] {
  const sync = (config.skillsSync ?? {}) as Record<string, unknown>;
  const out: SkillSource[] = [];

  const rawSources = Array.isArray(sync.sources) ? sync.sources : [];
  for (const r of rawSources) {
    const o = (r ?? {}) as Record<string, unknown>;
    const scope = coerceScope(typeof o.scope === "string" ? o.scope : undefined);
    if (!scope) continue;
    const indexUrl = typeof o.indexUrl === "string" ? o.indexUrl.trim() : "";
    const repoUrl = typeof o.repoUrl === "string" ? o.repoUrl.trim() : "";
    if (indexUrl) {
      out.push({ scope, kind: "registry", indexUrl, repoUrl: "", branch: "main",
        dir: expandHome(typeof o.dir === "string" && o.dir ? o.dir : defaultDir(scope)) });
    } else if (repoUrl) {
      out.push({ scope, kind: "git", repoUrl,
        branch: typeof o.branch === "string" && o.branch ? o.branch : "main",
        dir: expandHome(typeof o.dir === "string" && o.dir ? o.dir : defaultDir(scope)) });
    }
  }

  // Back-compat: a bare repoUrl with no sources[] is the personal source.
  if (out.length === 0 && typeof sync.repoUrl === "string" && sync.repoUrl.trim()) {
    out.push({
      scope: "personal",
      kind: "git",
      repoUrl: sync.repoUrl.trim(),
      branch: typeof sync.branch === "string" && sync.branch ? sync.branch : "main",
      dir: expandHome(typeof sync.dir === "string" && sync.dir ? sync.dir : join(homedir(), ".hivematrix", "skills-repo")),
    });
  }

  // Most-local first, so pulls import in precedence order.
  return out.sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope));
}

export interface ScopeTrustInput {
  scope: SkillScope;
  signatureValid: boolean;   // signature verifies against a trusted signer
}

/**
 * Whether a skill from `scope` should be auto-trusted. personal → yes; team/org
 * → only if signed by a trusted key; public → never (operator approves). Pure.
 */
export function scopeTrustDecision(input: ScopeTrustInput): boolean {
  switch (input.scope) {
    case "personal": return true;
    case "team":
    case "org": return input.signatureValid;
    case "public": return false;
    default: return false;
  }
}

export interface ScopedSlug { slug: string; scope: SkillScope }

/**
 * Resolve a slug collision across scopes: the most-local scope wins. Given the
 * set of (slug, scope) seen so far, decide whether a new candidate should be
 * imported (true) or skipped because a higher-precedence scope already has it.
 * Pure.
 */
export function shouldImport(slug: string, scope: SkillScope, seen: Map<string, SkillScope>): boolean {
  const existing = seen.get(slug);
  if (existing === undefined) return true;
  return scopeRank(scope) < scopeRank(existing); // only a MORE-local scope overrides
}

export { SKILL_SCOPES };
