/**
 * Flight Loop scheduler — runs on the same 15-second heartbeat as
 * tickWorkPackages. Each tick it:
 *   1. Expires any loop whose expiresAt has passed.
 *   2. Marks stopped any loop whose Flight is in a terminal state.
 *   3. Fires runPass for loops whose nextRunAt <= now.
 *
 * Fixed-cadence loops (mode='fixed') set nextRunAt after every completed pass
 * via computeNextRunAt in flight-loop-pass.ts.
 *
 * Self-paced loops (mode='self_paced') have nextRunAt set to "now" by
 * notifySelfPacedLoop() (in flight-loop-store.ts) whenever a child item
 * transitions to done/failed/review. reconcileWorkPackage calls that hook.
 *
 * Manual loops (mode='manual') never have nextRunAt set; they are excluded
 * from the scheduler query and only run when the operator presses Run pass.
 *
 * See docs/superpowers/specs/2026-06-27-flight-loops-quality-passes-design.md.
 */

import { getDb } from "@/lib/db";
import { getWorkPackage } from "./store";
import { runPass } from "./flight-loop-pass";
import { updateLoopAfterPass } from "./flight-loop-store";

interface ExpirableLoop {
  _id: string;
  passCount: number;
}

interface SchedulableLoop {
  _id: string;
  packageId: string;
  passCount: number;
  expiresAt: string | null;
}

export async function tickFlightLoops(): Promise<void> {
  const now = new Date().toISOString();

  // Step 1: Mark expired loops stopped (any non-terminal loop past its expiresAt).
  const expired = getDb()
    .prepare(
      `SELECT _id, passCount FROM flight_loops
       WHERE status NOT IN ('stopped') AND expiresAt IS NOT NULL AND expiresAt < ?`,
    )
    .all(now) as ExpirableLoop[];
  for (const r of expired) {
    updateLoopAfterPass(r._id, r.passCount, "stopped", "expired", null);
  }

  // Step 2: Run passes for loops whose nextRunAt has arrived.
  const due = getDb()
    .prepare(
      `SELECT _id, packageId, passCount, expiresAt
       FROM flight_loops
       WHERE status IN ('idle', 'active')
         AND nextRunAt IS NOT NULL
         AND nextRunAt <= ?`,
    )
    .all(now) as SchedulableLoop[];

  for (const loop of due) {
    // Skip any that were just expired in step 1.
    if (loop.expiresAt && loop.expiresAt < now) continue;

    // Stop loops whose Flight has reached a terminal state.
    const pkg = getWorkPackage(loop.packageId);
    if (!pkg || ["done", "done_with_skips", "failed", "cancelled"].includes(pkg.status)) {
      updateLoopAfterPass(loop._id, loop.passCount, "stopped", "flight_complete", null);
      continue;
    }

    try {
      await runPass(loop.packageId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // "already running" is a harmless race; "paused"/"stopped" are operator
      // actions between our query and runPass acquiring the lock — all expected.
      const expected = /already running|loop is paused|loop is stopped|max passes/i.test(msg);
      if (!expected) {
        console.error(`[flight-loops] pass failed for package "${loop.packageId}": ${msg}`);
      }
    }
  }
}

const LOOP_INTERVAL_MS = 15_000;
let timer: ReturnType<typeof setInterval> | null = null;
let looping = false;

export function startFlightLoopSchedulerLoop(intervalMs = LOOP_INTERVAL_MS): () => void {
  if (timer) return stopFlightLoopSchedulerLoop;
  timer = setInterval(() => {
    if (looping) return;
    looping = true;
    void tickFlightLoops()
      .catch((e) => { console.error(`[flight-loops] tick failed: ${e instanceof Error ? e.message : e}`); })
      .finally(() => { looping = false; });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return stopFlightLoopSchedulerLoop;
}

export function stopFlightLoopSchedulerLoop(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
