/**
 * Live capability acquisition — the P2 centerpiece. When a live turn hits a
 * capability miss, this pipeline mints a candidate skill, runs it through a
 * verification ladder (parse → scan → sandboxed evals → independent critic),
 * and only THEN registers it into the skill library — instruction skills go
 * straight to trusted, script skills start on probation (see
 * `recordSkillOutcome` in store.ts for the promotion path). Anything that
 * fails any rung is archived as a draft (DGM: archive, never delete) and a
 * capability-gap proposal is filed with the honest failure reason — it is
 * NEVER registered, NEVER trusted, NEVER fanned out (the ClawHavoc line).
 *
 * `mint` and `critic` are injected here (P2.1): the real Sonnet mint (P2.2)
 * and Haiku critic (P2.3) land as their defaults in later tasks. Without
 * them this returns an honest `{outcome:"error"}` rather than crashing or
 * silently no-op-passing.
 *
 * Budget rails: a per-day cap (config `skills.acquireDailyCap`, default 10)
 * read from the on-disk ledger `<brainRoot>/skills/ACQUISITIONS.md`, and an
 * "already-have" short-circuit that skips minting entirely when a prior
 * attempt for the same (normalized) goal already registered a skill that's
 * still on disk — so repeat asks reuse instead of re-learning.
 */

import { join } from "node:path";
import { promises as fs } from "node:fs";
import { configuredBrainRootDir } from "@/lib/brain/settings";
import { loadHiveConfig } from "@/lib/central/config";
import { recordAudit, type AuditEntry } from "@/lib/audit/audit";
import { recordFeedbackDedup } from "@/lib/feedback/feedback";
import { upsertSkill, readSkill } from "./store";
import { fanOutSkills } from "./fanout";
import { runSkillSandboxed } from "./sandbox";
import { scanSkill } from "./scan";
import { parseSkillFile, skillSlug, type Skill, type SkillKind } from "./contracts";

export interface EvalCase {
  name?: string;
  params?: Record<string, string>;
  input?: string;
  /** stdout must contain this (simplest assertion; keep it string-based). */
  expectContains?: string;
}

/** `file` = raw SKILL markdown (frontmatter+body), as produced by renderSkillFile. */
export interface MintedSkill {
  file: string;
  evals: EvalCase[];
}

export interface MintContext {
  goal: string;
  whyNeeded: string;
  suggestedKind?: SkillKind;
  attempt: number;
  /** Reflexion (retry-with-memory): the previously archived draft, if retrying. */
  priorDraft?: string;
  /** Reflexion: the previous attempt's honest failure reason, if retrying. */
  priorFailure?: string;
  /** P2.2 fills these (tool catalog + skill index) for Voyager-style retrieval. */
  toolCatalog?: string;
  skillIndex?: string;
}

export type MintFn = (ctx: MintContext) => Promise<MintedSkill>;

export type CriticFn = (input: {
  goal: string;
  skillFile: string;
  evalTranscripts: string;
}) => Promise<{ pass: boolean; reason: string }>;

export type AcquireOutcome = "registered" | "probation" | "already-have" | "capped" | "draft-failed" | "error";

export interface AcquireResult {
  outcome: AcquireOutcome;
  skillName?: string;
  reason: string;
  stage?: "parse" | "scan" | "evals" | "critic" | "mint";
}

export interface AcquireOptions {
  goal: string;
  whyNeeded: string;
  suggestedKind?: SkillKind;
  attempt?: number;
  /** Reflexion inputs, threaded through to MintContext (see priorDraft/priorFailure above). */
  priorDraft?: string;
  priorFailure?: string;
  /** REQUIRED for now via injection; the default (real Sonnet mint) is P2.2. */
  mint?: MintFn;
  /** REQUIRED for now via injection; the default (real Haiku critic) is P2.3. */
  critic?: CriticFn;
  /** Default from config `skills.acquireDailyCap` (10). */
  dailyCap?: number;
  now?: () => string;
  audit?: (e: AuditEntry) => void;
  /** Test seam; default fanOutSkills. Only invoked for TRUSTED (instruction) registrations. */
  fanout?: (skills: Skill[]) => Promise<unknown>;
  /** Test seam; default runSkillSandboxed. */
  runSandbox?: typeof runSkillSandboxed;
}

const LEDGER_FILENAME = "ACQUISITIONS.md";
const DRAFTS_DIRNAME = "drafts";

function defaultNow(): string {
  return new Date().toISOString();
}

function normalizeGoal(goal: string): string {
  return goal.toLowerCase().replace(/\s+/g, " ").trim();
}

function ledgerPath(brainRoot: string): string {
  return join(brainRoot, "skills", LEDGER_FILENAME);
}

function draftsDir(brainRoot: string): string {
  return join(brainRoot, "skills", DRAFTS_DIRNAME);
}

/** "2026-07-11T23:00:00.000Z" -> "2026-07-11T23-00-00" (stable, filename-safe). */
function draftTimestamp(ts: string): string {
  return ts.slice(0, 19).replace(/:/g, "-");
}

/** Never throws. Archives a failed draft under `<brainRoot>/skills/drafts/`. */
async function archiveDraft(brainRoot: string, file: string, nameHint: string | undefined, now: () => string): Promise<void> {
  try {
    const dir = draftsDir(brainRoot);
    await fs.mkdir(dir, { recursive: true });
    const base = nameHint ? skillSlug(nameHint) : "draft";
    const path = join(dir, `${base}.${draftTimestamp(now())}.md`);
    await fs.writeFile(path, file);
  } catch {
    // Archiving must never break the pipeline.
  }
}

/** Never throws. Files the existing capability-gap proposal with the failure reason. */
function fileProposal(goal: string, reason: string): void {
  try {
    recordFeedbackDedup({
      kind: "enhancement",
      title: `Capability gap: ${goal.slice(0, 80)}`,
      detail: `Live skill acquisition failed: ${reason}`,
      source: "skill-acquire",
    });
  } catch {
    // Filing the proposal must never break the pipeline.
  }
}

/** Never throws. Appends one ledger line: `<ts>\toutcome=<o>\tname=<n>\tgoal=<g>`. */
async function appendLedger(
  brainRoot: string,
  entry: { goal: string; outcome: string; name?: string },
  now: () => string,
): Promise<void> {
  try {
    const dir = join(brainRoot, "skills");
    await fs.mkdir(dir, { recursive: true });
    const oneLineGoal = entry.goal.replace(/\s+/g, " ").trim();
    const line = `${now()}\toutcome=${entry.outcome}\tname=${entry.name ?? ""}\tgoal=${oneLineGoal}\n`;
    await fs.appendFile(ledgerPath(brainRoot), line);
  } catch {
    // Ledger IO must never break the pipeline.
  }
}

interface LedgerLine {
  ts: string;
  outcome: string;
  name?: string;
  goal: string;
}

function parseLedgerLine(line: string): LedgerLine | null {
  const parts = line.split("\t");
  if (parts.length < 2 || !parts[0]) return null;
  let outcome = "";
  let name: string | undefined;
  let goal = "";
  for (const p of parts.slice(1)) {
    if (p.startsWith("outcome=")) outcome = p.slice("outcome=".length);
    else if (p.startsWith("name=")) name = p.slice("name=".length) || undefined;
    else if (p.startsWith("goal=")) goal = p.slice("goal=".length);
  }
  return { ts: parts[0], outcome, name, goal };
}

async function readLedgerLines(brainRoot: string): Promise<LedgerLine[]> {
  let content: string;
  try {
    content = await fs.readFile(ledgerPath(brainRoot), "utf-8");
  } catch {
    return [];
  }
  const out: LedgerLine[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const parsed = parseLedgerLine(line);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Count today's acquisition ledger lines (any outcome) — missing ledger → 0. */
async function countTodayAttempts(brainRoot: string, todayISODate: string): Promise<number> {
  const lines = await readLedgerLines(brainRoot);
  const todayPrefix = todayISODate.slice(0, 10);
  return lines.filter((l) => l.ts.slice(0, 10) === todayPrefix).length;
}

/**
 * Scan the ledger (most recent first) for a prior registered/probation line
 * whose normalized goal matches AND whose skill file still exists on disk.
 */
async function findAlreadyHave(brainRoot: string, goal: string): Promise<{ name: string } | null> {
  const lines = await readLedgerLines(brainRoot);
  const norm = normalizeGoal(goal);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.outcome !== "registered" && l.outcome !== "probation") continue;
    if (!l.name) continue;
    if (normalizeGoal(l.goal) !== norm) continue;
    const skill = await readSkill(l.name);
    if (skill) return { name: l.name };
  }
  return null;
}

function resolveDailyCap(opts: AcquireOptions): number {
  if (typeof opts.dailyCap === "number" && Number.isFinite(opts.dailyCap)) return opts.dailyCap;
  const config = loadHiveConfig();
  return Number((config.skills as { acquireDailyCap?: unknown } | undefined)?.acquireDailyCap) || 10;
}

function resolveAudit(opts: AcquireOptions): (e: AuditEntry) => void {
  return opts.audit ?? ((e: AuditEntry) => recordAudit(e, opts.now ? { now: opts.now } : {}));
}

/**
 * Run the full acquisition pipeline. Never throws — every failure mode
 * (including an unexpected internal error) resolves to an honest
 * `AcquireResult` so a live voice/chat turn always has something to say.
 */
export async function acquireSkill(opts: AcquireOptions): Promise<AcquireResult> {
  const now = opts.now ?? defaultNow;
  const audit = resolveAudit(opts);
  const goal = opts.goal;

  try {
    audit({ ts: "", event: "skill:acquire:start", summary: goal, status: "start" });

    const brainRoot = configuredBrainRootDir();
    if (!brainRoot) {
      return { outcome: "error", reason: "my brain root isn't configured, so I have nowhere to learn or store a skill." };
    }

    // 1. DAILY CAP
    const cap = resolveDailyCap(opts);
    const today = now();
    const countToday = await countTodayAttempts(brainRoot, today);
    if (countToday >= cap) {
      await appendLedger(brainRoot, { goal, outcome: "capped" }, now);
      audit({ ts: "", event: "skill:acquire:failed", summary: `daily acquisition cap reached (${cap})`, status: "capped" });
      return { outcome: "capped", reason: "I've hit my daily learning limit — I'll try again tomorrow." };
    }

    // 2. ALREADY-HAVE (before paying for a mint)
    const already = await findAlreadyHave(brainRoot, goal);
    if (already) {
      return { outcome: "already-have", skillName: already.name, reason: `I already have a skill for that: "${already.name}".` };
    }

    // 3. MINT
    if (!opts.mint || !opts.critic) {
      return { outcome: "error", reason: "mint/critic not configured" };
    }

    const mintCtx: MintContext = {
      goal,
      whyNeeded: opts.whyNeeded,
      suggestedKind: opts.suggestedKind,
      attempt: opts.attempt ?? 1,
      priorDraft: opts.priorDraft,
      priorFailure: opts.priorFailure,
    };

    let minted: MintedSkill;
    try {
      minted = await opts.mint(mintCtx);
    } catch (err) {
      const reason = "I tried to write the skill but the attempt failed.";
      audit({
        ts: "",
        event: "skill:acquire:failed",
        summary: `mint threw: ${err instanceof Error ? err.message : String(err)}`,
        status: "mint",
      });
      fileProposal(goal, reason);
      await appendLedger(brainRoot, { goal, outcome: "mint-failed" }, now);
      return { outcome: "draft-failed", stage: "mint", reason };
    }
    audit({ ts: "", event: "skill:acquire:minted", summary: goal, status: "ok" });

    const ladderFail = async (
      stage: "parse" | "scan" | "evals" | "critic",
      reason: string,
      nameHint?: string,
    ): Promise<AcquireResult> => {
      await archiveDraft(brainRoot, minted.file, nameHint, now);
      fileProposal(goal, reason);
      audit({ ts: "", event: "skill:acquire:failed", summary: reason, status: stage });
      await appendLedger(brainRoot, { goal, outcome: "draft-failed" }, now);
      return { outcome: "draft-failed", stage, reason };
    };

    // a. PARSE
    const skill = parseSkillFile(minted.file);
    if (!skill || !skill.name.trim()) {
      return await ladderFail("parse", "the skill I wrote didn't parse");
    }

    // b. SCAN
    const scanResult = scanSkill(skill);
    if (scanResult.verdict === "block") {
      const finding = scanResult.findings[0];
      const reason = `it was blocked for safety${finding ? ` (${finding.rule}: ${finding.detail})` : ""}`;
      return await ladderFail("scan", reason, skill.name);
    }

    // c. EVALS (script skills only — instruction skills have nothing to execute)
    const runSandbox = opts.runSandbox ?? runSkillSandboxed;
    const transcripts: string[] = [];
    if (skill.kind === "script") {
      const evals = minted.evals ?? [];
      if (evals.length === 0) {
        transcripts.push("no evals provided");
      } else {
        for (const ev of evals) {
          const r = await runSandbox(skill, { input: ev.input, params: ev.params, audit });
          const stdoutTail = r.stdout.slice(-500);
          transcripts.push(
            `${ev.name ?? "eval"}: params=${JSON.stringify(ev.params ?? {})} ok=${r.ok} stdoutTail=${JSON.stringify(stdoutTail)}`,
          );
          const passed = r.ok && (!ev.expectContains || r.stdout.includes(ev.expectContains));
          if (!passed) {
            return await ladderFail("evals", "it didn't pass its own tests", skill.name);
          }
        }
      }
    }
    const evalTranscripts = transcripts.join("\n");

    // d. CRITIC — independent judge, not the generator
    let criticResult: { pass: boolean; reason: string };
    try {
      criticResult = await opts.critic({ goal, skillFile: minted.file, evalTranscripts });
    } catch (err) {
      return await ladderFail(
        "critic",
        `the reviewer couldn't verify it (${err instanceof Error ? err.message : String(err)})`,
        skill.name,
      );
    }
    if (!criticResult.pass) {
      return await ladderFail("critic", criticResult.reason || "the reviewer flagged an issue", skill.name);
    }

    audit({ ts: "", event: "skill:acquire:verified", summary: skill.name, status: "ok" });

    // 5. REGISTER
    const description = skill.description.trim();
    if (skill.kind === "instruction") {
      await upsertSkill({
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
        body: skill.body,
        source: "acquired",
        kind: "instruction",
        interpreter: skill.interpreter,
        trusted: true,
        scanVerdict: scanResult.verdict,
      });
      const registered = await readSkill(skill.name);
      const fanout = opts.fanout ?? fanOutSkills;
      if (registered) {
        await fanout([registered]);
      }
      audit({ ts: "", event: "skill:acquire:registered", summary: `${skill.name} (registered)`, status: "registered" });
      await appendLedger(brainRoot, { goal, outcome: "registered", name: skill.name }, now);
      return {
        outcome: "registered",
        skillName: skill.name,
        reason: `I learned a new skill: "${skill.name}".${description ? ` ${description}.` : ""}`,
      };
    }

    // script → probation (not fanned out; runnable only via skill_run)
    await upsertSkill({
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
      body: skill.body,
      source: "acquired",
      kind: "script",
      interpreter: skill.interpreter,
      trusted: false,
      probation: true,
      scanVerdict: scanResult.verdict,
    });
    audit({ ts: "", event: "skill:acquire:registered", summary: `${skill.name} (probation)`, status: "probation" });
    await appendLedger(brainRoot, { goal, outcome: "probation", name: skill.name }, now);
    return {
      outcome: "probation",
      skillName: skill.name,
      reason: `I learned a new skill: "${skill.name}".${description ? ` ${description}.` : ""} It's on probation — I'll use it carefully until it's proven.`,
    };
  } catch (err) {
    return { outcome: "error", reason: `something went wrong while learning: ${err instanceof Error ? err.message : String(err)}` };
  }
}
