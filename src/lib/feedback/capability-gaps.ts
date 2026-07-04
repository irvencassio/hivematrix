/**
 * Capability self-assessment — "the agent notices what it's missing."
 *
 * W8's capability-request idea, done safely. The learning loop already files
 * friction into the backlog; this module reads that backlog for items that
 * signal a *missing capability* (no tool/lane/access for something the operator
 * wanted), classifies the likely remedy, and files ONE deduped, operator-visible
 * capability proposal per gap — with an honest safety label.
 *
 * THE CLAWHAVOC LINE (non-negotiable, W8/W3): proposing is free; ACQUIRING is
 * gated. This module never installs a pack, enables a credentialed lane, or
 * grants itself a tool. It only:
 *   - detects the gap,
 *   - classifies the remedy (skill | lane | pack | unknown),
 *   - marks whether that remedy is self-serviceable (skills: the learning loop
 *     can distill/refine one — first-party, sandboxed-until-trusted) or requires
 *     operator approval (lanes touch credentials; packs must be signed).
 *
 * Even under fully-autonomous, lane/pack acquisition stays a gated approval —
 * self-installing external capability is exactly how OpenClaw's aliveness became
 * ClawHavoc. The only capability that flows automatically is a first-party skill,
 * and that already happens through distillation; here we just make the gap and
 * its remedy visible.
 *
 * Pure classification; the runner is best-effort and never throws.
 */

import { listFeedback, recordFeedbackDedup } from "./feedback";
import { clusterFeedback, type FeedbackCluster } from "./pattern-detection";

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
}

/**
 * Read the backlog, find capability-gap clusters, and file one deduped proposal
 * each. Best-effort — never throws. Files a proposal for BOTH self-serviceable
 * and gated remedies (so the operator sees the full picture); it NEVER acquires
 * anything — acquisition remains a separate, gated, operator action.
 */
export function runCapabilityGapDetection(minCount = 2): CapabilityGapResult {
  const empty: CapabilityGapResult = { gaps: 0, proposalsFiled: 0, gated: 0, selfServiceable: 0 };
  try {
    const gaps = clusterFeedback(listFeedback(), minCount)
      .filter((c) => !c.exemplarTitle.startsWith("Capability gap:") && isCapabilityGap(c));
    let proposalsFiled = 0;
    let gated = 0;
    let selfServiceable = 0;
    for (const cluster of gaps) {
      const proposal = proposalFromGap(cluster);
      const { created } = recordFeedbackDedup({
        kind: proposal.kind,
        title: proposal.title,
        detail: proposal.detail,
        source: proposal.source,
      });
      if (created) {
        proposalsFiled++;
        if (proposal.gated) gated++;
        else selfServiceable++;
      }
    }
    if (proposalsFiled > 0) {
      console.log(`[capability-gaps] ${gaps.length} gap(s), +${proposalsFiled} proposal(s) (${gated} gated, ${selfServiceable} self-serviceable)`);
    }
    return { gaps: gaps.length, proposalsFiled, gated, selfServiceable };
  } catch (e) {
    console.warn(`[capability-gaps] pass failed: ${e instanceof Error ? e.message : e}`);
    return empty;
  }
}
