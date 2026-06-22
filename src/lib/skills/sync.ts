/**
 * Git sync for the personal skill set (Slice 1: one personal repo).
 *
 * The git clone lives at ~/.hivematrix/skills-repo (NOT in the Drive-backed brain,
 * so `.git` never double-syncs/corrupts). The repo mirrors `<brain>/skills` as
 * HiveMatrix-native skill files (lossless round-trip). pull imports into the brain
 * store; push renders the brain store out and commits. Best-effort, never throws.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { renderSkillFile, parseSkillFile, skillSlug } from "./contracts";
import { readAllSkills, upsertSkill } from "./store";

const exec = promisify(execFile);

export interface SkillsSyncConfig {
  repoUrl: string;
  branch: string;
  dir: string;
  trustOnPull: boolean;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/** Parse the `skillsSync` block. Returns null if no repoUrl is configured. Pure. */
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

type Logger = (s: string) => void;
const noop: Logger = () => {};

async function git(dir: string, args: string[], onLog: Logger): Promise<boolean> {
  try {
    const { stdout } = await exec("git", ["-C", dir, ...args], { timeout: 60_000 });
    if (stdout.trim()) onLog(stdout.trim());
    return true;
  } catch (e) {
    onLog(`git ${args[0]} failed: ${(e as Error).message}`);
    return false;
  }
}

async function ensureClone(cfg: SkillsSyncConfig, onLog: Logger): Promise<boolean> {
  try { await fs.access(join(cfg.dir, ".git")); return true; } catch { /* needs clone */ }
  try {
    await fs.mkdir(join(cfg.dir, ".."), { recursive: true });
    await exec("git", ["clone", "--branch", cfg.branch, cfg.repoUrl, cfg.dir], { timeout: 120_000 });
    onLog(`cloned ${cfg.repoUrl}`);
    return true;
  } catch (e) {
    // Branch may not exist yet on a fresh remote — clone default, then checkout.
    try {
      await exec("git", ["clone", cfg.repoUrl, cfg.dir], { timeout: 120_000 });
      onLog(`cloned ${cfg.repoUrl} (default branch)`);
      return true;
    } catch (e2) { onLog(`clone failed: ${(e2 as Error).message}`); return false; }
  }
}

export interface SyncSummary {
  configured: boolean;
  pulled: boolean;
  pushed: boolean;
  imported: number;
  refined: number;
  errors: string[];
}

/** Pull/push the personal skill repo. direction: pull | push | both. Never throws. */
export async function gitSyncSkills(
  opts: { direction?: "pull" | "push" | "both"; onLog?: Logger } = {},
): Promise<SyncSummary> {
  const onLog = opts.onLog ?? noop;
  const direction = opts.direction ?? "both";
  const cfg = getSkillsSyncConfig();
  const summary: SyncSummary = { configured: !!cfg, pulled: false, pushed: false, imported: 0, refined: 0, errors: [] };
  if (!cfg) { onLog("no skillsSync.repoUrl configured"); return summary; }
  const log: Logger = (s) => { onLog(s); if (/failed|error/i.test(s)) summary.errors.push(s); };

  if (!(await ensureClone(cfg, log))) return summary;

  if (direction === "pull" || direction === "both") {
    await git(cfg.dir, ["pull", "--rebase", "--autostash"], log);
    // Import every skill file from the repo into the brain store.
    let files: string[] = [];
    try { files = await collectSkillFiles(cfg.dir); } catch { /* none */ }
    for (const f of files) {
      try {
        const skill = parseSkillFile(await fs.readFile(f, "utf-8"));
        if (!skill) continue;
        const r = await upsertSkill({
          name: skill.name, description: skill.description, tags: skill.tags, body: skill.body,
          source: `sync:${cfg.repoUrl}`, compat: skill.compat, kind: skill.kind,
          interpreter: skill.interpreter, trusted: cfg.trustOnPull,
        });
        if (r.created) summary.imported++;
        else if (r.refined) summary.refined++;
      } catch { /* skip bad file */ }
    }
    summary.pulled = true;
    log(`imported ${summary.imported}, refined ${summary.refined}`);
  }

  if (direction === "push" || direction === "both") {
    try {
      for (const skill of await readAllSkills()) {
        await fs.writeFile(join(cfg.dir, `${skillSlug(skill.name)}.md`), renderSkillFile(skill));
      }
      await git(cfg.dir, ["add", "-A"], log);
      // commit only if there's something to commit
      const committed = await git(cfg.dir, ["commit", "-m", "hivematrix: sync skills"], log);
      if (committed) { await git(cfg.dir, ["push", "origin", cfg.branch], log); summary.pushed = true; }
    } catch (e) { summary.errors.push((e as Error).message); }
  }

  return summary;
}

/** Skill files in the repo: flat `<slug>.md` and `<slug>/SKILL.md`. */
async function collectSkillFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isFile() && e.name.endsWith(".md")) out.push(join(dir, e.name));
    else if (e.isDirectory()) {
      try { await fs.access(join(dir, e.name, "SKILL.md")); out.push(join(dir, e.name, "SKILL.md")); } catch { /* none */ }
    }
  }
  return out;
}
