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
