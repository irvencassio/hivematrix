/**
 * Git sync for skills across tiered scopes (personal/team/org/public).
 *
 * Each scope is a git repo (clones kept under ~/.hivematrix/skills-<scope>, OUT of
 * the Drive-backed brain so .git never double-syncs). Pull walks sources in
 * precedence order (personal first); a more-local scope wins a slug collision.
 * Trust is decided per scope (personal trusted; team/org trusted only if signed by
 * a trusted key; public never). Personal is also pushed (your canonical set);
 * other scopes are published to explicitly. Best-effort, never throws.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { renderSkillFile, parseSkillFile, skillSlug, type SkillScope, type Skill, type ScanVerdict } from "./contracts";
import { readAllSkills, readSkill, upsertSkill } from "./store";
import { parseSkillSources, scopeTrustDecision, shouldImport, type SkillSource } from "./scopes";
import { scanSkill } from "./scan";
import {
  loadOrCreateSigningKey, readSigningPublicKey, trustedSignerKeys, skillSignerTrusted, signSkill,
} from "./signing";

const exec = promisify(execFile);

// --- slice-1 single-repo config (kept for back-compat + tests) --------------
export interface SkillsSyncConfig { repoUrl: string; branch: string; dir: string; trustOnPull: boolean }

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/** Parse the legacy single-repo `skillsSync` block. Null if no repoUrl. Pure. */
export function parseSkillsSyncConfig(config: Record<string, unknown>): SkillsSyncConfig | null {
  const raw = (config.skillsSync ?? {}) as Record<string, unknown>;
  const repoUrl = typeof raw.repoUrl === "string" ? raw.repoUrl.trim() : "";
  if (!repoUrl) return null;
  return {
    repoUrl,
    branch: typeof raw.branch === "string" && raw.branch ? raw.branch : "main",
    dir: expandHome(typeof raw.dir === "string" && raw.dir ? raw.dir : join(homedir(), ".hivematrix", "skills-repo")),
    trustOnPull: raw.trustOnPull !== false,
  };
}

function readConfig(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8")); }
  catch { return {}; }
}

export function getSkillsSyncConfig(): SkillsSyncConfig | null {
  return parseSkillsSyncConfig(readConfig());
}

/** The configured tiered sources (personal-first), incl. slice-1 back-compat. */
export function getSkillSources(): SkillSource[] {
  return parseSkillSources(readConfig());
}

type Logger = (s: string) => void;
const noop: Logger = () => {};

async function git(dir: string, args: string[], onLog: Logger): Promise<boolean> {
  try {
    const { stdout } = await exec("git", ["-C", dir, ...args], { timeout: 60_000 });
    if (stdout.trim()) onLog(stdout.trim());
    return true;
  } catch (e) { onLog(`git ${args[0]} failed: ${(e as Error).message}`); return false; }
}

async function ensureRepoClone(src: SkillSource, onLog: Logger): Promise<boolean> {
  try { await fs.access(join(src.dir, ".git")); return true; } catch { /* needs clone */ }
  try {
    await fs.mkdir(join(src.dir, ".."), { recursive: true });
    await exec("git", ["clone", "--branch", src.branch, src.repoUrl, src.dir], { timeout: 120_000 });
    onLog(`cloned ${src.scope} ← ${src.repoUrl}`);
    return true;
  } catch {
    try { await exec("git", ["clone", src.repoUrl, src.dir], { timeout: 120_000 }); onLog(`cloned ${src.scope} (default branch)`); return true; }
    catch (e2) { onLog(`clone ${src.scope} failed: ${(e2 as Error).message}`); return false; }
  }
}

/** Skill files in a repo: flat `<slug>.md` and `<slug>/SKILL.md`. */
async function collectSkillFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("fs").Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isFile() && e.name.endsWith(".md")) out.push(join(dir, e.name));
    else if (e.isDirectory()) {
      try { await fs.access(join(dir, e.name, "SKILL.md")); out.push(join(dir, e.name, "SKILL.md")); } catch { /* none */ }
    }
  }
  return out;
}

export interface ScopeSyncResult { scope: SkillScope; imported: number; refined: number; quarantined: number; pushed: boolean }
export interface SyncSummary { configured: boolean; perScope: ScopeSyncResult[]; errors: string[] }

/**
 * Pull all sources (precedence + per-scope trust) and push the personal set.
 * `direction`: pull | push | both. Best-effort; never throws.
 */
export async function gitSyncSkills(opts: { direction?: "pull" | "push" | "both"; onLog?: Logger } = {}): Promise<SyncSummary> {
  const onLog = opts.onLog ?? noop;
  const direction = opts.direction ?? "both";
  const config = readConfig();
  const sources = parseSkillSources(config);
  const summary: SyncSummary = { configured: sources.length > 0, perScope: [], errors: [] };
  if (!sources.length) { onLog("no skill sources configured (skillsSync.sources or skillsSync.repoUrl)"); return summary; }

  const ownPub = readSigningPublicKey();
  const trusted = trustedSignerKeys(config, ownPub ?? undefined);
  const log: Logger = (s) => { onLog(s); if (/failed|error/i.test(s)) summary.errors.push(s); };
  const seen = new Map<string, SkillScope>(); // slug → winning scope (personal first)

  for (const src of sources) {
    if (src.kind !== "git") continue; // registry sources are browse/import-on-demand, not bulk-synced
    const r: ScopeSyncResult = { scope: src.scope, imported: 0, refined: 0, quarantined: 0, pushed: false };
    if (!(await ensureRepoClone(src, log))) { summary.perScope.push(r); continue; }

    if (direction === "pull" || direction === "both") {
      await git(src.dir, ["pull", "--rebase", "--autostash"], log);
      for (const f of await collectSkillFiles(src.dir)) {
        try {
          const skill = parseSkillFile(await fs.readFile(f, "utf-8"));
          if (!skill) continue;
          const slug = skillSlug(skill.name);
          if (!shouldImport(slug, src.scope, seen)) continue; // a more-local scope already has it
          seen.set(slug, src.scope);
          const sigValid = skillSignerTrusted(skill, trusted);
          const verdict = scanSkill(skill).verdict;
          // A blocked scan vetoes auto-trust even for personal/signed skills.
          const trust = verdict !== "block" && scopeTrustDecision({ scope: src.scope, signatureValid: sigValid });
          const res = await upsertSkill({
            name: skill.name, description: skill.description, tags: skill.tags, body: skill.body,
            source: `sync:${src.scope}`, compat: skill.compat, kind: skill.kind, interpreter: skill.interpreter,
            trusted: trust, scope: src.scope, signedBy: skill.signedBy, signature: skill.signature, scanVerdict: verdict,
          });
          if (res.created) r.imported++; else if (res.refined) r.refined++;
          if (!trust) r.quarantined++;
        } catch { /* skip bad file */ }
      }
    }

    // Only the personal scope is bidirectional; others publish explicitly.
    if ((direction === "push" || direction === "both") && src.scope === "personal") {
      try {
        for (const skill of await readAllSkills()) {
          if (skill.scope && skill.scope !== "personal") continue; // don't push others' skills back to personal
          await fs.writeFile(join(src.dir, `${skillSlug(skill.name)}.md`), renderSkillFile(skill));
        }
        await git(src.dir, ["add", "-A"], log);
        if (await git(src.dir, ["commit", "-m", "hivematrix: sync personal skills"], log)) {
          await git(src.dir, ["push", "origin", src.branch], log);
          r.pushed = true;
        }
      } catch (e) { summary.errors.push((e as Error).message); }
    }

    summary.perScope.push(r);
  }
  return summary;
}

export interface PublishResult { ok: boolean; scope: SkillScope; signedBy?: string; pushed: boolean; reason?: string }

/** Sign a skill and publish it to a scope's repo (commit + push). Best-effort. */
export async function publishSkill(name: string, scope: SkillScope, opts: { onLog?: Logger } = {}): Promise<PublishResult> {
  const onLog = opts.onLog ?? noop;
  if (scope === "personal") {
    // personal is handled by the normal bidirectional sync
    const s = await gitSyncSkills({ direction: "push", onLog });
    return { ok: s.configured, scope, pushed: s.perScope.some((p) => p.scope === "personal" && p.pushed) };
  }
  const src = getSkillSources().find((x) => x.scope === scope);
  if (!src) return { ok: false, scope, pushed: false, reason: `no ${scope} source configured (skillsSync.sources)` };
  if (src.kind !== "git") return { ok: false, scope, pushed: false, reason: `${scope} is a registry source (read-only); cannot publish` };
  const skill = await readSkill(name);
  if (!skill) return { ok: false, scope, pushed: false, reason: "skill not found" };

  const scan = scanSkill(skill);
  if (scan.verdict === "block") {
    return { ok: false, scope, pushed: false, reason: `scan blocked publish: ${scan.findings.map((f) => f.rule).join(", ")}` };
  }

  const key = loadOrCreateSigningKey();
  const { signedBy, signature } = signSkill(skill, key.privateKeyPem, key.publicKeyPem);
  const signed = { ...skill, scope, signedBy, signature };

  if (!(await ensureRepoClone(src, onLog))) return { ok: false, scope, pushed: false, reason: "clone failed" };
  try {
    await fs.writeFile(join(src.dir, `${skillSlug(skill.name)}.md`), renderSkillFile(signed));
    await git(src.dir, ["add", "-A"], onLog);
    const committed = await git(src.dir, ["commit", "-m", `hivematrix: publish ${skillSlug(skill.name)} → ${scope}`], onLog);
    let pushed = false;
    if (committed) pushed = await git(src.dir, ["push", "origin", src.branch], onLog);
    // Record provenance on the local copy too.
    await upsertSkill({
      name: skill.name, description: skill.description, tags: skill.tags, body: skill.body,
      source: skill.source, compat: skill.compat, kind: skill.kind, interpreter: skill.interpreter,
      trusted: skill.trusted, scope, signedBy, signature,
    });
    return { ok: true, scope, signedBy, pushed };
  } catch (e) { return { ok: false, scope, pushed: false, reason: (e as Error).message }; }
}

// --- Browse-before-import: look at a scope's catalog without pulling it all ---

export interface CatalogEntry {
  scope: SkillScope;
  name: string;
  slug: string;
  description: string;
  kind: Skill["kind"];
  /** Known for git sources (we have the file); undefined for registry until import. */
  signed?: boolean;
  scanVerdict?: ScanVerdict;
  inLibrary: boolean; // already present in the local brain store
}

/** A registry index entry: { name, description, kind?, url } (url → raw SKILL.md). */
export interface RegistryEntry { name: string; description?: string; kind?: Skill["kind"]; url: string }

/** Pure: build a catalog from a registry index (scan/signed unknown until import). */
export function catalogFromIndex(scope: SkillScope, entries: RegistryEntry[], localSlugs: Set<string>): CatalogEntry[] {
  return entries
    .filter((e) => e && typeof e.name === "string" && typeof e.url === "string")
    .map((e) => ({
      scope, name: e.name, slug: skillSlug(e.name),
      description: e.description ?? "", kind: (e.kind === "script" ? "script" : "instruction") as Skill["kind"],
      inLibrary: localSlugs.has(skillSlug(e.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchRegistryIndex(indexUrl: string): Promise<RegistryEntry[]> {
  const r = await fetch(indexUrl, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`index fetch HTTP ${r.status}`);
  const data = await r.json() as { skills?: unknown };
  return Array.isArray(data.skills) ? data.skills as RegistryEntry[] : [];
}

/** Pure: turn parsed remote skills into a catalog, annotated vs the local set. */
export function buildCatalog(scope: SkillScope, skills: Skill[], localSlugs: Set<string>): CatalogEntry[] {
  return skills
    .map((s) => ({
      scope,
      name: s.name,
      slug: skillSlug(s.name),
      description: s.description,
      kind: s.kind,
      signed: !!s.signature,
      scanVerdict: scanSkill(s).verdict,
      inLibrary: localSlugs.has(skillSlug(s.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface BrowseResult { configured: boolean; scope: SkillScope; entries: CatalogEntry[]; error?: string }

/** Clone/refresh a scope's repo and list its skills WITHOUT importing them. */
export async function browseSource(scope: SkillScope, opts: { onLog?: Logger } = {}): Promise<BrowseResult> {
  const onLog = opts.onLog ?? noop;
  const src = getSkillSources().find((s) => s.scope === scope);
  if (!src) return { configured: false, scope, entries: [] };
  const localSlugs = new Set((await readAllSkills()).map((s) => skillSlug(s.name)));

  if (src.kind === "registry") {
    try {
      const entries = await fetchRegistryIndex(src.indexUrl!);
      return { configured: true, scope, entries: catalogFromIndex(scope, entries, localSlugs) };
    } catch (e) { return { configured: true, scope, entries: [], error: (e as Error).message }; }
  }

  if (!(await ensureRepoClone(src, onLog))) return { configured: true, scope, entries: [], error: "clone failed" };
  await git(src.dir, ["pull", "--rebase", "--autostash"], onLog);
  const skills: Skill[] = [];
  for (const f of await collectSkillFiles(src.dir)) {
    try { const s = parseSkillFile(await fs.readFile(f, "utf-8")); if (s) skills.push(s); } catch { /* skip */ }
  }
  return { configured: true, scope, entries: buildCatalog(scope, skills, localSlugs) };
}

export interface ImportRemoteResult { ok: boolean; name: string; trusted: boolean; scanVerdict?: ScanVerdict; reason?: string }

/** Import ONE skill from a scope's repo into the brain store (cherry-pick). */
export async function importRemoteSkill(scope: SkillScope, name: string, opts: { onLog?: Logger } = {}): Promise<ImportRemoteResult> {
  const onLog = opts.onLog ?? noop;
  const src = getSkillSources().find((s) => s.scope === scope);
  if (!src) return { ok: false, name, trusted: false, reason: `no ${scope} source configured` };

  const slug = skillSlug(name);
  let raw: string | null = null;
  if (src.kind === "registry") {
    try {
      const entry = (await fetchRegistryIndex(src.indexUrl!)).find((e) => skillSlug(e.name) === slug);
      if (!entry) return { ok: false, name, trusted: false, reason: "not found in registry index" };
      const r = await fetch(entry.url, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return { ok: false, name, trusted: false, reason: `fetch HTTP ${r.status}` };
      raw = await r.text();
    } catch (e) { return { ok: false, name, trusted: false, reason: (e as Error).message }; }
  } else {
    if (!(await ensureRepoClone(src, onLog))) return { ok: false, name, trusted: false, reason: "clone failed" };
    for (const candidate of [join(src.dir, `${slug}.md`), join(src.dir, slug, "SKILL.md")]) {
      try { raw = await fs.readFile(candidate, "utf-8"); break; } catch { /* try next */ }
    }
  }
  const skill = raw ? parseSkillFile(raw) : null;
  if (!skill) return { ok: false, name, trusted: false, reason: "skill not found in scope" };

  const trusted = trustedSignerKeys(readConfig(), readSigningPublicKey() ?? undefined);
  const verdict = scanSkill(skill).verdict;
  const sigValid = skillSignerTrusted(skill, trusted);
  const trust = verdict !== "block" && scopeTrustDecision({ scope, signatureValid: sigValid });
  await upsertSkill({
    name: skill.name, description: skill.description, tags: skill.tags, body: skill.body,
    source: `import:${scope}`, compat: skill.compat, kind: skill.kind, interpreter: skill.interpreter,
    trusted: trust, scope, signedBy: skill.signedBy, signature: skill.signature, scanVerdict: verdict,
  });
  return { ok: true, name: skill.name, trusted: trust, scanVerdict: verdict };
}
