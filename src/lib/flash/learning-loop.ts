/**
 * Flash Lane — learning loop scheduler.
 *
 * Polls every 15 minutes for sessions that have gone cold (no activity for 6h
 * and not yet distilled), then runs distillSession() on each. This single sweep
 * handles both "session went cold mid-day" and "daily rollover" — by end of day
 * all inactive sessions have aged past the 6h threshold.
 *
 * A 60-second delayed first run catches sessions that went cold while the daemon
 * was down. The interval timer is unref'd so it doesn't block process exit.
 */

import { configuredBrainRootDir } from "@/lib/brain/settings";
import { getColdSessions } from "./store";
import { distillSession } from "./distill";

const COLD_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours
const POLL_INTERVAL_MS = 15 * 60 * 1000;       // 15 minutes
const STARTUP_DELAY_MS = 60_000;               // 1 minute — let daemon settle first

let loopTimer: ReturnType<typeof setInterval> | null = null;

async function runDistillPass(): Promise<void> {
  const brainRoot = configuredBrainRootDir();
  const cold = getColdSessions(COLD_THRESHOLD_MS);
  if (cold.length === 0) return;

  console.log(`[flash:learning-loop] distilling ${cold.length} cold session(s)`);
  let totalSkills = 0;
  let totalFeedback = 0;

  for (const session of cold) {
    const result = await distillSession(session.id, brainRoot);
    if (!result.skipped) {
      totalSkills += result.skillsCreated + result.skillsRefined;
      totalFeedback += result.feedbackFiled;
    }
  }

  if (totalSkills + totalFeedback > 0) {
    console.log(
      `[flash:learning-loop] pass complete: +${totalSkills} skill updates, ${totalFeedback} feedback items`,
    );
  }
}

/** Start the recurring cold-session distillation scheduler. Idempotent. */
export function startFlashLearningLoop(): void {
  if (loopTimer) return;

  // Delayed first pass so daemon startup I/O settles before we hit the model
  setTimeout(
    () => void runDistillPass().catch((e) => console.warn("[flash:learning-loop] startup pass error:", e)),
    STARTUP_DELAY_MS,
  );

  loopTimer = setInterval(
    () => void runDistillPass().catch((e) => console.warn("[flash:learning-loop] poll error:", e)),
    POLL_INTERVAL_MS,
  );
  loopTimer.unref();

  console.log("[flash:learning-loop] started (15m poll, 6h cold threshold)");
}
