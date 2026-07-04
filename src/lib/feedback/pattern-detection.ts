/**
 * Pattern detection — the anticipatory half of the self-improvement loop.
 *
 * The backlog already captures individual problems; loopHealth() counts how
 * many recur. This module turns that signal into ACTION: it clusters the open
 * backlog by normalized title, and for any chronic cluster (seen ≥ N times)
 * files a single deduped "proposal" enhancement — "this keeps happening; stand
 * up a directive or skill to address it once instead of firefighting each
 * instance." The proposal lands in the same backlog the self-improvement
 * directive plans from, so a recurring pain becomes a tracked, operator-visible
 * suggestion rather than noise that scrolls away.
 *
 * Proposing is free; acquiring stays gated (W8): a proposal is just an
 * enhancement item — the operator (or the self-improvement directive under the
 * autonomy dial) decides whether to act on it. Nothing here creates a directive
 * or installs a skill on its own.
 *
 * All logic is pure over a passed-in item list; the runner is best-effort and
 * never throws.
 */

import {
  listFeedback,
  recordFeedbackDedup,
  normalizeFeedbackTitle,
  type FeedbackItem,
} from "./feedback";

/** Source tag on proposals this module files — so they don't re-cluster themselves. */
export const PATTERN_PROPOSAL_SOURCE = "pattern-detector";

/** A group of open/triaged items sharing a normalized title. */
export interface FeedbackCluster {
  normalizedTitle: string;
  count: number;
  exemplarTitle: string; // a real (un-normalized) title from the cluster
  kind: FeedbackItem["kind"];
  ids: string[];
}

const DEFAULT_MIN_COUNT = 3;

/**
 * Pure: cluster still-open (open|triaged) feedback by normalized title, keeping
 * only clusters at/above `minCount`, sorted by count desc then title. Proposals
 * this module previously filed are excluded so it doesn't chase its own tail.
 */
export function clusterFeedback(items: FeedbackItem[], minCount = DEFAULT_MIN_COUNT): FeedbackCluster[] {
  const groups = new Map<string, FeedbackCluster>();
  for (const item of items) {
    if (item.status !== "open" && item.status !== "triaged") continue;
    if (item.source === PATTERN_PROPOSAL_SOURCE) continue;
    const norm = normalizeFeedbackTitle(item.title);
    if (!norm) continue;
    const existing = groups.get(norm);
    if (existing) {
      existing.count += 1;
      existing.ids.push(item._id);
    } else {
      groups.set(norm, {
        normalizedTitle: norm,
        count: 1,
        exemplarTitle: item.title,
        kind: item.kind,
        ids: [item._id],
      });
    }
  }
  return [...groups.values()]
    .filter((c) => c.count >= minCount)
    .sort((a, b) => b.count - a.count || a.normalizedTitle.localeCompare(b.normalizedTitle));
}

/** Pure: render a chronic cluster as a proposal enhancement input. */
export function proposalFromCluster(cluster: FeedbackCluster): { kind: "enhancement"; title: string; detail: string; source: string } {
  const verb = cluster.kind === "bug" ? "keeps failing" : "keeps coming up";
  return {
    kind: "enhancement",
    title: `Recurring: ${cluster.exemplarTitle}`.slice(0, 200),
    detail:
      `This ${verb} — ${cluster.count} open/triaged items share this pattern. ` +
      `Consider a standing directive or a reusable skill to address the root cause once, ` +
      `instead of handling each instance. Related item ids: ${cluster.ids.slice(0, 10).join(", ")}.`,
    source: PATTERN_PROPOSAL_SOURCE,
  };
}

export interface PatternDetectionResult {
  clusters: number;
  proposalsFiled: number;
}

/**
 * Read the backlog, cluster it, and file a deduped proposal per chronic cluster.
 * Best-effort — never throws. `minCount` defaults to 3 (a genuine pattern, not
 * a coincidence).
 */
export function runPatternDetection(minCount = DEFAULT_MIN_COUNT): PatternDetectionResult {
  try {
    const clusters = clusterFeedback(listFeedback(), minCount);
    let proposalsFiled = 0;
    for (const cluster of clusters) {
      const { created } = recordFeedbackDedup(proposalFromCluster(cluster));
      if (created) proposalsFiled++;
    }
    if (proposalsFiled > 0) {
      console.log(`[pattern-detector] ${clusters.length} chronic cluster(s), +${proposalsFiled} proposal(s) filed`);
    }
    return { clusters: clusters.length, proposalsFiled };
  } catch (e) {
    console.warn(`[pattern-detector] pass failed: ${e instanceof Error ? e.message : e}`);
    return { clusters: 0, proposalsFiled: 0 };
  }
}
