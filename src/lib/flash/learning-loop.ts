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
import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";
import { runPatternDetection } from "@/lib/feedback/pattern-detection";
import { runCapabilityGapDetection } from "@/lib/feedback/capability-gaps";
import { runPersonaEvolution } from "./persona-evolution";
import { getColdSessions } from "./store";
import { distillSession } from "./distill";

const COLD_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours
const POLL_INTERVAL_MS = 15 * 60 * 1000;       // 15 minutes
const STARTUP_DELAY_MS = 60_000;               // 1 minute — let daemon settle first
const PATTERN_INTERVAL_MS = 24 * 60 * 60 * 1000;     // pattern detection: once a day
const PERSONA_EVO_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // persona evolution: once a week (slow, high-trust)

let loopTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Slow-pass throttles persist in config (`learningLoop.{lastPatternRunAt,
 * lastPersonaEvoRunAt}`) — the daemon restarts on every release, so in-memory
 * markers would turn "daily" and "weekly" into "every restart".
 */
function slowPassDue(key: "lastPatternRunAt" | "lastPersonaEvoRunAt", intervalMs: number, nowMs: number): boolean {
  try {
    const ll = loadHiveConfig().learningLoop as Record<string, unknown> | undefined;
    const last = typeof ll?.[key] === "string" ? Date.parse(ll[key] as string) : NaN;
    return !Number.isFinite(last) || nowMs - last >= intervalMs;
  } catch {
    return false; // unreadable config → skip the slow pass rather than spam it
  }
}

function markSlowPassRan(key: "lastPatternRunAt" | "lastPersonaEvoRunAt", nowMs: number): void {
  try {
    const config = loadHiveConfig();
    const ll = (config.learningLoop && typeof config.learningLoop === "object")
      ? config.learningLoop as Record<string, unknown>
      : {};
    config.learningLoop = { ...ll, [key]: new Date(nowMs).toISOString() };
    saveHiveConfig(config);
  } catch { /* best effort */ }
}

async function runDistillPass(nowMs = Date.now()): Promise<void> {
  // Slow anticipatory pass: cluster the feedback backlog into "this keeps
  // happening — address the root cause" proposals, at most once a day. Runs
  // independent of cold sessions so an idle-but-accumulating backlog still gets
  // surfaced. Best-effort (never throws).
  if (slowPassDue("lastPatternRunAt", PATTERN_INTERVAL_MS, nowMs)) {
    markSlowPassRan("lastPatternRunAt", nowMs);
    runPatternDetection();
    // Capability self-assessment: surface missing-capability gaps as labeled
    // proposals (self-serviceable skills vs. gated lane/pack acquisition). Never
    // acquires anything — acquisition stays a separate, gated operator action.
    runCapabilityGapDetection();
  }

  // Weekly, high-trust: let the agent evolve its own SOUL.md operating notes from
  // chronic friction. Under autonomous it appends + announces; otherwise it files
  // proposals. Runs after pattern detection so the freshest clusters feed it.
  if (slowPassDue("lastPersonaEvoRunAt", PERSONA_EVO_INTERVAL_MS, nowMs)) {
    markSlowPassRan("lastPersonaEvoRunAt", nowMs);
    await runPersonaEvolution().catch((e) =>
      console.warn("[flash:learning-loop] persona evolution error:", e),
    );
  }

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
