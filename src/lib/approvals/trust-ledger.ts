/**
 * Trust ledger — the adaptive layer on top of the autonomy dial (W3 "trust ramp").
 *
 * The autonomy dial is a blunt global switch. This makes autonomy *earn itself*:
 * per action-class, it records how often the operator approved vs. denied, and
 * under `autonomous` mode a class with a clean track record (>= N approvals, 0
 * denials) auto-approves without the operator flipping a toggle. A single denial
 * revokes that class's trust until the operator resets it — one bad outcome and
 * it goes back to asking.
 *
 * HARD SAFETY FLOOR — never relaxed by any trust level:
 *   Only `checkpoint` and `lowRiskTool` categories are ever trust-eligible.
 *   content / external / tool (risky bash, MCP) / stuck / unknown — and every
 *   protected action (payments, credential mutations, destructive commands,
 *   release/deploy) — can NEVER auto-approve, at any amount of earned trust.
 *   trustKey() returns null for those, so no history is even accumulated.
 *
 * Store: ~/.hivematrix/trust-ledger.json. Pure decision functions are separated
 * from the store so the policy is testable without disk.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { AutoApprovalCategory } from "@/lib/voice/auto-approval-policy";
import type { AutonomyLevel } from "@/lib/config/autonomy";

/** Approvals of a class needed before it auto-approves under autonomous mode. */
export const DEFAULT_TRUST_THRESHOLD = 3;

/** Every Nth trust auto-approval is re-prompted to the operator instead, so a
 * trusted class stays contestable — without this, auto-approvals bypass
 * resolveApproval forever and denial-based revocation could never trigger. */
export const SPOT_CHECK_EVERY = 10;

export interface TrustEntry {
  approvals: number;
  denials: number;
  /** Auto-approvals granted by earned trust (drives the spot-check cadence). */
  autoApprovals?: number;
  lastApprovalAt?: string;
  lastDenialAt?: string;
}

export type TrustLedger = Record<string, TrustEntry>;

/**
 * Pure: the stable ledger key for an approval class, or null when the class is
 * NOT trust-eligible (the safety floor). Only `checkpoint` can ever earn trust —
 * classifyAutoApprovalRequest collapses every checkpoint gate to one category,
 * and no other category it produces (content/tool) is eligible. (A per-tool
 * "lowRiskTool" class existed briefly but was unreachable dead code: nothing in
 * the classify path ever produces that category.)
 */
export function trustKey(category: AutoApprovalCategory, _tool?: string): string | null {
  return category === "checkpoint" ? "checkpoint" : null;
}

/** Pure: has this class earned auto-approval? Clean record = >= threshold approvals AND zero denials. */
export function isTrusted(entry: TrustEntry | undefined, threshold = DEFAULT_TRUST_THRESHOLD): boolean {
  if (!entry) return false;
  return entry.denials === 0 && entry.approvals >= threshold;
}

/**
 * Pure: the full auto-approval-by-trust decision. True ONLY when the mode is
 * autonomous, the class is trust-eligible (key non-null), and it has earned
 * trust. Every other case is false — the operator is still asked.
 */
export function trustAllowsAutoApproval(
  input: { category: AutoApprovalCategory; tool?: string },
  autonomyLevel: AutonomyLevel,
  ledger: TrustLedger,
  threshold = DEFAULT_TRUST_THRESHOLD,
): { allowed: boolean; reason: string; key: string | null } {
  if (autonomyLevel !== "autonomous") {
    return { allowed: false, reason: "trust ramp applies only in autonomous mode", key: null };
  }
  const key = trustKey(input.category, input.tool);
  if (!key) {
    return { allowed: false, reason: `${input.category} can never auto-approve (safety floor)`, key: null };
  }
  const entry = ledger[key];
  if (!isTrusted(entry, threshold)) {
    const have = entry?.approvals ?? 0;
    const denied = entry?.denials ?? 0;
    return {
      allowed: false,
      reason: denied > 0 ? `trust revoked for ${key} (a prior denial)` : `${key} has ${have}/${threshold} approvals`,
      key,
    };
  }
  // Periodic spot-check: every Nth auto-approval goes back to the operator so
  // a trusted class stays contestable (denials remain reachable).
  if (((entry!.autoApprovals ?? 0) + 1) % SPOT_CHECK_EVERY === 0) {
    return { allowed: false, reason: `spot-check: re-prompting after ${entry!.autoApprovals} auto-approvals of ${key}`, key };
  }
  return { allowed: true, reason: `earned trust for ${key} (${entry!.approvals} clean approvals)`, key };
}

/** Count one trust-granted auto-approval against its class (spot-check cadence). */
export function recordTrustAutoApproval(key: string): void {
  try {
    const ledger = readTrustLedger();
    const entry = ledger[key] ?? { approvals: 0, denials: 0 };
    ledger[key] = { ...entry, autoApprovals: (entry.autoApprovals ?? 0) + 1 };
    writeTrustLedger(ledger);
  } catch { /* best effort */ }
}

/**
 * Pure: fold one decision outcome into a ledger entry. Approval increments the
 * clean count; a denial increments denials (which isTrusted treats as a hard
 * block until the operator resets the class).
 */
export function applyOutcome(entry: TrustEntry | undefined, approved: boolean, at: string): TrustEntry {
  const base: TrustEntry = entry ?? { approvals: 0, denials: 0 };
  return approved
    ? {
        ...base,
        approvals: base.approvals + 1,
        // An operator approval also advances the grant counter — this is what
        // moves a spot-check past its boundary instead of re-prompting forever.
        autoApprovals: (base.autoApprovals ?? 0) + 1,
        lastApprovalAt: at,
      }
    : { ...base, denials: base.denials + 1, lastDenialAt: at };
}

// --- Store (disk) ----------------------------------------------------------

function ledgerPath(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "trust-ledger.json");
}

export function readTrustLedger(): TrustLedger {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(), "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as TrustLedger) : {};
  } catch {
    return {};
  }
}

function writeTrustLedger(ledger: TrustLedger): void {
  try {
    writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2));
  } catch {
    /* best-effort — trust is an optimization, never a correctness dependency */
  }
}

/**
 * Record an approval outcome against its class. No-op for trust-ineligible
 * classes (key null). Best-effort; never throws. Returns the key it touched (or
 * null) so callers can log.
 */
export function recordApprovalOutcome(
  input: { category: AutoApprovalCategory; tool?: string },
  approved: boolean,
  now: () => string = () => new Date().toISOString(),
): string | null {
  const key = trustKey(input.category, input.tool);
  if (!key) return null;
  try {
    const ledger = readTrustLedger();
    ledger[key] = applyOutcome(ledger[key], approved, now());
    writeTrustLedger(ledger);
    return key;
  } catch {
    return null;
  }
}

/** Clear one class's trust (or the whole ledger). Operator escape hatch. */
export function resetTrust(key?: string): void {
  if (!key) {
    writeTrustLedger({});
    return;
  }
  const ledger = readTrustLedger();
  delete ledger[key];
  writeTrustLedger(ledger);
}
