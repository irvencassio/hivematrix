/**
 * Daemon self-heal for bundle-version drift.
 *
 * HiveMatrix is two processes: the Tauri shell (does the auto-update, swaps the
 * .app bundle on disk) and this daemon (launchd-supervised, serves :3747). When
 * the shell installs a new release it replaces daemon.cjs + Info.plist on disk,
 * but the RUNNING daemon keeps the old code in memory until something restarts
 * it. A shell that already has the post-install "daemon handoff" kickstarts the
 * daemon for us — but users updating FROM an older shell (≤0.1.137) run an
 * updater that has no handoff, so their daemon would sit stale forever.
 *
 * This closes that gap from the daemon side, independent of which shell did the
 * install: the daemon periodically compares its OWN compiled-in version (the
 * code actually executing) against the on-disk bundle Info.plist. If the bundle
 * on disk is newer, the bundle was swapped underneath us — so kickstart via
 * launchd to relaunch into the new bundle. Idempotent: after the restart the
 * running code equals the on-disk version and the check goes quiet, so there is
 * no kickstart loop. A dev/source run is never packaged, so it is a no-op.
 */

import { VERSION as RUNNING_VERSION } from "@/lib/version";
import { getBundledVersion } from "@/lib/version/bundle-version";
import { getAppBundleRoot } from "@/lib/onboarding/app-bundle";
import { compareVersions } from "./feed-check";
import { restartViaLaunchd } from "./daemon-update";

export interface BundleDriftInputs {
  /** The version compiled into the running daemon code. */
  runningVersion: string;
  /** The version read from the on-disk bundle Info.plist. */
  onDiskVersion: string;
  /** Whether the daemon is running from inside a packaged .app bundle. */
  isPackaged: boolean;
}

export interface BundleDrift {
  drifted: boolean;
  runningVersion: string;
  onDiskVersion: string;
}

/**
 * Pure drift check: the on-disk bundle is newer than the running code AND we are
 * actually packaged. Dev/source runs (not packaged) never drift.
 */
export function detectBundleVersionDrift(inputs: BundleDriftInputs): BundleDrift {
  const { runningVersion, onDiskVersion, isPackaged } = inputs;
  const drifted = isPackaged && compareVersions(onDiskVersion, runningVersion) > 0;
  return { drifted, runningVersion, onDiskVersion };
}

export interface SelfHealDeps {
  runningVersion?: string;
  readOnDiskVersion?: () => string;
  isPackaged?: () => boolean;
  restart?: () => Promise<void>;
  log?: (msg: string) => void;
}

/**
 * Run one drift check and, if the bundle was swapped underneath us, kickstart
 * the daemon via launchd so it relaunches into the new bundle. Returns what
 * happened (for tests + logging). Never throws.
 */
export async function maybeSelfHealBundleDrift(
  deps: SelfHealDeps = {},
): Promise<{ healed: boolean; drift: BundleDrift; error?: string }> {
  const runningVersion = deps.runningVersion ?? RUNNING_VERSION;
  const readOnDiskVersion = deps.readOnDiskVersion ?? (() => getBundledVersion());
  const isPackaged = deps.isPackaged ?? (() => getAppBundleRoot() !== null);
  const restart = deps.restart ?? restartViaLaunchd;
  const log = deps.log ?? ((m) => console.warn(m));

  let onDiskVersion = runningVersion;
  try {
    onDiskVersion = readOnDiskVersion();
  } catch {
    // Reading the on-disk Info.plist failed (mid-swap, unreadable). Treat as no
    // drift — a real swap resolves on a later tick.
  }

  const drift = detectBundleVersionDrift({ runningVersion, onDiskVersion, isPackaged: isPackaged() });
  if (!drift.drifted) return { healed: false, drift };

  log(
    `[hivematrix] self-heal: on-disk bundle ${onDiskVersion} is newer than running ${runningVersion} ` +
      `(bundle swapped by an updater without the daemon handoff) — kickstarting launchd daemon`,
  );
  try {
    await restart();
    return { healed: true, drift };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`[hivematrix] self-heal: launchd kickstart failed: ${error}`);
    return { healed: false, drift, error };
  }
}

/** Default cadence for the drift check. Cheap (two local version reads). */
export const SELF_HEAL_INTERVAL_MS = 60 * 1000;

/**
 * Start the periodic self-heal loop. Returns the interval handle (unref'd so it
 * never keeps the process alive on its own). Runs one immediate check on start.
 */
export function startSelfHealLoop(
  intervalMs = SELF_HEAL_INTERVAL_MS,
  deps: SelfHealDeps = {},
): NodeJS.Timeout {
  void maybeSelfHealBundleDrift(deps);
  const handle = setInterval(() => { void maybeSelfHealBundleDrift(deps); }, intervalMs);
  handle.unref?.();
  return handle;
}
