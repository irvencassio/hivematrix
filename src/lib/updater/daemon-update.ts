/**
 * Daemon-side launchd restart hook for the updater.
 * The update channel is hardcoded to GitHub releases (feed-check.ts).
 */

import { promisify } from "util";
import { execFile } from "child_process";
import { getBundledVersion } from "@/lib/version/bundle-version";
import type { InterruptionReason } from "@/lib/orchestrator/shutdown-checkpoint";

const execFileAsync = promisify(execFile);
const LAUNCHD_LABEL = "com.hivematrix.daemon";

export const CURRENT_VERSION = getBundledVersion();

/**
 * Restart the daemon via launchd (kickstart -k restarts the running service).
 * Used as the updater's restart hook after a new version is installed, and by
 * the operator-facing restart routes.
 *
 * `kickstart -k` sends SIGKILL to the whole launchd job — which includes every
 * agent worker, because workers are spawned into the daemon's process group.
 * SIGKILL cannot be trapped, so there is no "handle it on the way down": the
 * ONLY place in-flight work can be made durable is right here, before the
 * kickstart is issued. Skipping this is what turned every update into a batch
 * of tasks recorded as "Killed by signal: SIGKILL" with their sessions lost.
 */
export async function restartViaLaunchd(reason: InterruptionReason = "daemon_restart"): Promise<void> {
  // Checkpoint + drain BEFORE the untrappable kill. Never let a failure here
  // block the restart itself — a restart that cannot happen is worse than one
  // whose bookkeeping is incomplete.
  try {
    const { agentManager } = await import("@/lib/orchestrator/agent-manager");
    const { checkpointed, drained } = await agentManager.shutdownAllAgents(reason, 5000);
    if (checkpointed || drained) {
      console.log(`[restart] ${reason}: ${checkpointed} task(s) checkpointed, ${drained} worker(s) drained before kickstart`);
    }
  } catch (e) {
    console.error("[restart] pre-kickstart checkpoint failed:", e instanceof Error ? e.message : e);
  }

  const uid = process.getuid?.() ?? 0;
  await execFileAsync("launchctl", ["kickstart", "-k", `gui/${uid}/${LAUNCHD_LABEL}`]);
}
