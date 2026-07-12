/**
 * Capability self-assessment — "the agent notices what it's missing."
 *
 * W8's capability-request idea, done safely. The learning loop already files
 * friction into the backlog; this module reads that backlog for items that
 * signal a *missing capability* (no tool/lane/access for something the operator
 * wanted), classifies the likely remedy, and files ONE deduped, operator-visible
 * capability proposal per gap — with an honest safety label.
 *
 * THE CLAWHAVOC LINE (non-negotiable, W8/W3): proposing is free; ACQUIRING a
 * lane or pack is gated FOREVER, at every autonomy level. This module never
 * installs a pack, enables a credentialed lane, or grants itself a tool for a
 * lane/pack remedy — self-installing external capability is exactly how
 * OpenClaw's aliveness became ClawHavoc. It only:
 *   - detects the gap,
 *   - classifies the remedy (skill | lane | pack | unknown),
 *   - marks whether that remedy is self-serviceable (skills: first-party,
 *     sandboxed-until-trusted) or requires operator approval (lanes touch
 *     credentials; packs must be signed).
 *
 * P4: a "skill" remedy is the ONE exception to "proposing is free; acquiring is
 * gated" — because a skill is first-party and sandboxed-until-trusted, when
 * autonomy is "autonomous" this module calls straight into the P2 acquisition
 * pipeline (`acquireSkill`) instead of only filing a proposal. That pipeline
 * has its own daily cap and already-have short-circuit, so this stays bounded,
 * and a failed acquisition already files its own capability-gap proposal — so
 * this module does not double-file for a gap it attempted to acquire. Under
 * standard/manual, a skill-remedy gap still just gets a proposal, now marked
 * as one-tap learnable (the same pipeline runs when the operator accepts it).
 * Lane/pack remedies are UNCHANGED by autonomy level — always proposed, never
 * acquired.
 *
 * Pure classification; the runner is best-effort and never throws.
 */

import { getAutonomyLevel, type AutonomyLevel } from "@/lib/config/autonomy";
import type { AcquireOptions, AcquireResult } from "@/lib/skills/acquire";
import { listFeedback, recordFeedbackDedup } from "./feedback";
import { clusterFeedback, type FeedbackCluster } from "./pattern-detection";

/** Marks a filed proposal as a candidate for a one-tap "learn it" action in the
 * UI — the same P2 acquisition pipeline runs when the operator accepts it.
 * `CapabilityProposal`/`RecordFeedbackInput` have no structured flag for this,
 * so it's a parseable suffix on `detail` (kept minimal on purpose). */
const LEARNABLE_MARKER = " [learnable]";

/** Test seam type: same shape as `acquireSkill` from `@/lib/skills/acquire`. */
export type AcquireFn = (opts: AcquireOptions) => Promise<AcquireResult>;

export const CAPABILITY_PROPOSAL_SOURCE = "capability-gap";

export type RemedyType = "skill" | "lane" | "pack" | "unknown";

/** Signals in a friction item that it's about a MISSING capability, not a bug. */
const GAP_CUES = [
  "no tool", "no way to", "couldn't", "could not", "unable to", "can't", "cannot",
  "not supported", "missing", "needs access", "no access", "not connected",
  "isn't wired", "not wired", "no capability", "wish it could", "if it could",
];

/** Lane keywords → the remedy is enabling a credentialed lane (gated). */
const LANE_CUES = ["browser", "terminal", "ssh", "mail", "email", "imessage", "sms", "desktop", "calendar", "market", "trade"];
/** Pack keywords → the remedy is installing a signed outcome pack (gated). */
const PACK_CUES = ["pack", "integration", "connector", "install", "plugin"];

function hay(cluster: FeedbackCluster): string {
  return cluster.exemplarTitle.toLowerCase();
}

/** Pure: does this cluster read like a capability gap (vs. an ordinary bug)? */
export function isCapabilityGap(cluster: FeedbackCluster): boolean {
  const h = hay(cluster);
  return GAP_CUES.some((c) => h.includes(c));
}

/** Pure: the likely remedy class for a capability gap. */
export function classifyRemedy(cluster: FeedbackCluster): RemedyType {
  const h = hay(cluster);
  if (LANE_CUES.some((c) => h.includes(c))) return "lane";
  if (PACK_CUES.some((c) => h.includes(c))) return "pack";
  // A repeatable procedure the agent could learn → a skill (self-serviceable).
  if (h.includes("how to") || h.includes("steps") || h.includes("workflow") || h.includes("recipe")) return "skill";
  return "unknown";
}

/**
 * Pure: is the remedy self-serviceable without operator approval? ONLY skills —
 * first-party, sandboxed-until-trusted, and the learning loop already distills
 * them. lane/pack/unknown always require the operator (credentials / signing /
 * human judgement). Holds regardless of autonomy level.
 */
export function remedyIsSelfServiceable(remedy: RemedyType): boolean {
  return remedy === "skill";
}

export interface CapabilityProposal {
  kind: "enhancement";
  title: string;
  detail: string;
  source: string;
  remedy: RemedyType;
  gated: boolean;
}

/** Pure: turn a capability-gap cluster into a labeled proposal. */
export function proposalFromGap(cluster: FeedbackCluster): CapabilityProposal {
  const remedy = classifyRemedy(cluster);
  const gated = !remedyIsSelfServiceable(remedy);
  const remedyText: Record<RemedyType, string> = {
    skill: "The learning loop can distill a reusable skill for this — first-party and sandboxed; no acquisition needed.",
    lane: "Likely needs a capability lane enabled (browser/mail/terminal/desktop/market). Requires your approval — lanes hold credentials.",
    pack: "Likely needs a signed outcome pack installed. Requires your approval — packs are signed, first-party only.",
    unknown: "Remedy unclear — review and decide whether a skill, lane, or pack fits.",
  };
  return {
    kind: "enhancement",
    title: `Capability gap: ${cluster.exemplarTitle}`.slice(0, 200),
    detail:
      `Came up ${cluster.count}× and reads like a missing capability. ${remedyText[remedy]} ` +
      (gated ? "ACQUIRING stays gated (your approval required)." : "Self-serviceable — flows without extra approval.") +
      ` Related ids: ${cluster.ids.slice(0, 10).join(", ")}.`,
    source: CAPABILITY_PROPOSAL_SOURCE,
    remedy,
    gated,
  };
}

export interface CapabilityGapResult {
  gaps: number;
  proposalsFiled: number;
  gated: number;        // proposals whose remedy needs operator approval
  selfServiceable: number;
  acquired: number;      // skill-remedy gaps sent straight to acquisition (autonomous only)
}

export interface RunCapabilityGapDetectionOptions {
  /** Override the autonomy level (tests). Default: the real operator dial. */
  autonomyLevel?: AutonomyLevel;
  /** Test seam; default dynamically imports the real P2 `acquireSkill` (dynamic
   * to avoid any import-cycle risk between feedback/ and skills/). */
  acquire?: AcquireFn;
}

const defaultAcquire: AcquireFn = async (opts) => (await import("@/lib/skills/acquire")).acquireSkill(opts);

/**
 * Read the backlog, find capability-gap clusters, and either send a skill-remedy
 * gap straight to acquisition (autonomous) or file one deduped proposal each
 * (otherwise / for lane|pack|unknown remedies, which ALWAYS just get a
 * proposal). Best-effort — never throws.
 */
export async function runCapabilityGapDetection(
  minCount = 2,
  opts: RunCapabilityGapDetectionOptions = {},
): Promise<CapabilityGapResult> {
  const empty: CapabilityGapResult = { gaps: 0, proposalsFiled: 0, gated: 0, selfServiceable: 0, acquired: 0 };
  try {
    const gaps = clusterFeedback(listFeedback(), minCount)
      .filter((c) => !c.exemplarTitle.startsWith("Capability gap:") && isCapabilityGap(c));
    let proposalsFiled = 0;
    let gated = 0;
    let selfServiceable = 0;
    let acquired = 0;
    const autonomy = opts.autonomyLevel ?? getAutonomyLevel();
    const acquire = opts.acquire ?? defaultAcquire;

    for (const cluster of gaps) {
      const remedy = classifyRemedy(cluster);

      // P4: ONLY a skill remedy may ever auto-acquire, and only under
      // "autonomous" — lane/pack remedies fall through to the proposal path
      // below UNCONDITIONALLY, at every autonomy level (the ClawHavoc line:
      // credentialed lanes and signed packs are gated forever).
      if (remedy === "skill" && autonomy === "autonomous") {
        acquired++;
        selfServiceable++;
        try {
          const result = await acquire({
            goal: cluster.exemplarTitle,
            whyNeeded: `recurring capability gap (came up ${cluster.count} times)`,
          });
          // A failed acquisition (draft-failed/error/capped) already files its
          // own capability-gap proposal via acquire.ts's fileProposal — so we
          // deliberately do NOT also file one here (no double-surfacing).
          console.log(`[capability-gaps] acquisition attempt for "${cluster.exemplarTitle}": ${result.outcome}`);
        } catch (e) {
          // Best-effort: acquisition must never break the detection pass.
          console.warn(`[capability-gaps] acquire threw for "${cluster.exemplarTitle}": ${e instanceof Error ? e.message : e}`);
        }
        continue; // never also file a proposal for a gap we attempted to acquire
      }

      const proposal = proposalFromGap(cluster);
      // Skill-remedy proposals filed in non-autonomous mode are marked
      // one-tap learnable for the UI (see LEARNABLE_MARKER above). Lane/pack/
      // unknown proposals are unchanged.
      const detail = proposal.remedy === "skill" ? `${proposal.detail}${LEARNABLE_MARKER}` : proposal.detail;
      const { created } = recordFeedbackDedup({
        kind: proposal.kind,
        title: proposal.title,
        detail,
        source: proposal.source,
      });
      if (created) {
        proposalsFiled++;
        if (proposal.gated) gated++;
        else selfServiceable++;
      }
    }
    if (proposalsFiled > 0 || acquired > 0) {
      console.log(`[capability-gaps] ${gaps.length} gap(s), +${proposalsFiled} proposal(s) (${gated} gated, ${selfServiceable} self-serviceable), ${acquired} sent to acquisition`);
    }
    return { gaps: gaps.length, proposalsFiled, gated, selfServiceable, acquired };
  } catch (e) {
    console.warn(`[capability-gaps] pass failed: ${e instanceof Error ? e.message : e}`);
    return empty;
  }
}
