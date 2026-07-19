/**
 * Daemon-side launchd restart hook for the updater.
 * The update channel is hardcoded to GitHub releases (feed-check.ts).
 */

import { promisify } from "util";
import { execFile } from "child_process";
import { getBundledVersion } from "@/lib/version/bundle-version";

const execFileAsync = promisify(execFile);
const LAUNCHD_LABEL = "com.hivematrix.daemon";

export const CURRENT_VERSION = getBundledVersion();

/**
 * Restart the daemon via launchd (kickstart -k restarts the running service).
 * Used as the updater's restart hook after a new version is installed.
 */
export async function restartViaLaunchd(): Promise<void> {
  const uid = process.getuid?.() ?? 0;
  await execFileAsync("launchctl", ["kickstart", "-k", `gui/${uid}/${LAUNCHD_LABEL}`]);
}
