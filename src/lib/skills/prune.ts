/**
 * Usage-aware prune suggestions — the differentiated bit. HiveMatrix already
 * tracks useCount + lastUsedAt per skill; the ecosystem's package managers don't
 * wire usage into cleanup. We surface skills that have gone cold so the operator
 * can archive them and cut the context/overhead of an ever-growing library.
 *
 * Pure (now/thresholds injectable) — IO-free, fully testable.
 */

import type { Skill } from "./contracts";

export type PruneReason = "idle" | "never-used";

export interface PruneCandidate {
  name: string;
  reason: PruneReason;
  useCount: number;
  lastUsedAt: string;
  ageDays: number;       // days since last use (idle) or since creation (never-used)
  kind: Skill["kind"];
}

export interface PruneOptions {
  now?: number;               // ms epoch (injectable)
  idleDays?: number;          // used-but-cold threshold (default 60)
  neverUsedGraceDays?: number; // never-used grace before flagging (default 30)
}

function daysBetween(thenIso: string, nowMs: number): number | null {
  if (!thenIso) return null;
  const t = Date.parse(thenIso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / 86_400_000);
}

/**
 * Skills that have gone cold: used once but idle past `idleDays`, or never used
 * and older than `neverUsedGraceDays`. Most-stale first. Pure.
 */
export function stalePruneCandidates(skills: Skill[], opts: PruneOptions = {}): PruneCandidate[] {
  const now = opts.now ?? Date.now();
  const idleDays = opts.idleDays ?? 60;
  const graceDays = opts.neverUsedGraceDays ?? 30;
  const out: PruneCandidate[] = [];

  for (const s of skills) {
    if (s.useCount > 0) {
      const idle = daysBetween(s.lastUsedAt, now);
      if (idle != null && idle >= idleDays) {
        out.push({ name: s.name, reason: "idle", useCount: s.useCount, lastUsedAt: s.lastUsedAt, ageDays: idle, kind: s.kind });
      }
    } else {
      const age = daysBetween(s.createdAt, now);
      if (age != null && age >= graceDays) {
        out.push({ name: s.name, reason: "never-used", useCount: 0, lastUsedAt: "", ageDays: age, kind: s.kind });
      }
    }
  }
  return out.sort((a, b) => b.ageDays - a.ageDays || a.name.localeCompare(b.name));
}

export interface DemotionCandidate {
  name: string;
  failures: number;
  useCount: number;
  trusted: boolean;
}

/**
 * Trusted skills whose failures have outweighed their usage — candidates to
 * DEMOTE (untrust), not delete. Uses the exact same threshold as P1.2's
 * recordSkillOutcome demotion (`failures >= Math.max(3, useCount)`), applied
 * here as a batch sweep so an operator/cron can catch skills that crossed the
 * line between individual outcome recordings (e.g. after a threshold change,
 * or a skill imported already past it) rather than only at the moment a
 * single new failure is recorded.
 *
 * This function only IDENTIFIES candidates — it is pure/IO-free, matching
 * stalePruneCandidates. The caller decides whether to act, via
 * `setSkillTrusted(name, false)` in store.ts.
 *
 * Demotion (untrust, stays on disk) is deliberately softer than archive (move
 * aside to skills/archive/): a demoted skill keeps living in the library and
 * can re-earn trust the normal way, via recordSkillOutcome's promotion path
 * (probation + 3 clean successes) — it is never removed by this sweep.
 */
export function demotionCandidates(skills: Skill[]): DemotionCandidate[] {
  const out: DemotionCandidate[] = [];
  for (const s of skills) {
    if (s.trusted && s.failures >= Math.max(3, s.useCount)) {
      out.push({ name: s.name, failures: s.failures, useCount: s.useCount, trusted: s.trusted });
    }
  }
  return out.sort((a, b) => (b.failures - b.useCount) - (a.failures - a.useCount) || a.name.localeCompare(b.name));
}
