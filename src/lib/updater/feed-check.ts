/**
 * Lightweight update indicator backing the console's "update available" pill.
 *
 * Checks the SAME GitHub release feed the Tauri app-updater consumes
 * (releases/latest/download/latest.json) and compares its version to the
 * running bundle. The console polls getUpdateStatus(); applyUpdateViaRelaunch()
 * relaunches the desktop app so its updater pulls + installs (the daemon can't
 * touch the App-Management-protected /Applications bundle itself).
 */

import { spawn } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getBundledVersion } from "@/lib/version/bundle-version";

/** Flag file the desktop app checks to force one install even when auto-update is off. */
export const FORCE_UPDATE_FLAG = join(homedir(), ".hivematrix", ".force-update");

// Must match plugins.updater.endpoints in src-tauri/tauri.conf.json.
const FEED_URL =
  "https://github.com/irvencassio/hivematrix/releases/latest/download/latest.json";
const TTL_MS = 60 * 1000;
const APP_PROCESS_MATCH = "HiveMatrix.app/Contents/MacOS/app";

export interface UpdateStatus {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  error?: string;
}

let cache: { at: number; status: UpdateStatus } | null = null;

/** Compare dotted versions numerically: >0 if a newer than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function getUpdateStatus(opts: { force?: boolean; fetchImpl?: typeof fetch } = {}): Promise<UpdateStatus> {
  const current = getBundledVersion();
  if (!opts.force && cache && Date.now() - cache.at < TTL_MS) return cache.status;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let status: UpdateStatus;
  try {
    const res = await fetchImpl(FEED_URL, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const feed = (await res.json()) as { version?: string };
    const latest = typeof feed.version === "string" ? feed.version : null;
    status = {
      current,
      latest,
      updateAvailable: !!latest && compareVersions(latest, current) > 0,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    status = {
      current,
      latest: null,
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
  cache = { at: Date.now(), status };
  return status;
}

/**
 * Relaunch the desktop app so its Tauri updater pulls + installs the update.
 * Uses pkill (signal-based, no AppleEvents/Automation TCC prompt) then reopens.
 * Detached so it survives the daemon restart the updater triggers mid-install.
 */
export function applyUpdateViaRelaunch(
  spawnImpl: typeof spawn = spawn,
): { ok: boolean; detail: string } {
  try {
    // Drop a force flag so the app installs this update even if auto-update is
    // off (manual "Install" must work regardless of the setting).
    try { mkdirSync(join(homedir(), ".hivematrix"), { recursive: true }); writeFileSync(FORCE_UPDATE_FLAG, "1"); } catch { /* best effort */ }
    spawnImpl(
      "sh",
      ["-c", `sleep 1; pkill -f '${APP_PROCESS_MATCH}'; sleep 2; open -a HiveMatrix`],
      { detached: true, stdio: "ignore" },
    ).unref();
    return { ok: true, detail: "relaunching HiveMatrix to install the update" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
