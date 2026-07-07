/**
 * Memory Lane poller: curate playbooks on a slow schedule. Embedded worker (runs
 * in the daemon), self-gating — no-ops when the brain root is unreachable.
 * Same guarded-setInterval shape as the Mail Lane poller, just a slower cadence.
 */

import { existsSync } from "fs";
import { preferredBrainRootDir } from "@/lib/brain/settings";
import { broadcast } from "@/lib/ws/broadcaster";
import { startPollLoop } from "@/lib/lanes/poll-loop";
import { curatePlaybooksUnder, type PlaybookCurationSummary } from "./curate";

const CURATION_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

let stopFn: (() => void) | null = null;
let running = false;
let lastSummary: PlaybookCurationSummary | null = null;

export interface BrainBeeStatus {
  enabled: boolean;
  brainRootDir: string;
  lastSummary: PlaybookCurationSummary | null;
}

export function getBrainBeeStatus(): BrainBeeStatus {
  const brainRootDir = preferredBrainRootDir();
  return {
    enabled: existsSync(brainRootDir),
    brainRootDir,
    lastSummary,
  };
}

/** Run one curation pass now (also used by tests). Returns null when gated off. */
export async function curateOnce(): Promise<PlaybookCurationSummary | null> {
  if (running) return lastSummary;
  const brainRootDir = preferredBrainRootDir();
  if (!existsSync(brainRootDir)) return null;
  running = true;
  try {
    const summary = await curatePlaybooksUnder(brainRootDir);
    lastSummary = summary;
    if (summary.totalRemoved > 0) {
      broadcast({ type: "brainbee_curated", summary });
    }
    return summary;
  } catch (err) {
    console.error("[brainbee] curation pass failed:", err);
    return null;
  } finally {
    running = false;
  }
}

export function startBrainBeePoller(intervalMs: number = CURATION_INTERVAL_MS): () => void {
  if (stopFn) return stopBrainBeePoller;
  void curateOnce(); // an initial pass on boot
  stopFn = startPollLoop({ name: "brainbee", intervalMs, tick: async () => { await curateOnce(); } });
  return stopBrainBeePoller;
}

export function stopBrainBeePoller(): void {
  if (stopFn) { stopFn(); stopFn = null; }
}
