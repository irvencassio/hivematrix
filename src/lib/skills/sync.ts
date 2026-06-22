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
import { renderSkillFile, parseSkillFile, skillSlug, type SkillScope } from "./contracts";
import { readAllSkills, readSkill, upsertSkill } from "./store";
import { parseSkillSources, scopeTrustDecision, shouldImport, type SkillSource } from "./scopes";
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
  let entries: import("fs").Dirent[] = [];
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
          const trust = scopeTrustDecision({ scope: src.scope, signatureValid: sigValid });
          const res = await upsertSkill({
            name: skill.name, description: skill.description, tags: skill.tags, body: skill.body,
            source: `sync:${src.scope}`, compat: skill.compat, kind: skill.kind, interpreter: skill.interpreter,
            trusted: trust, scope: src.scope, signedBy: skill.signedBy, signature: skill.signature,
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
  const skill = await readSkill(name);
  if (!skill) return { ok: false, scope, pushed: false, reason: "skill not found" };

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
