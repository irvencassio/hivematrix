/**
 * Lightweight update indicator backing the console's "update available" pill.
 *
 * Checks the SAME GitHub release feed the Tauri app-updater consumes
 * (releases/latest/download/hivematrix-core.json) and compares its version to
 * the running bundle. The console polls getUpdateStatus(); applyUpdateViaRelaunch()
 * relaunches the desktop app so its updater pulls + installs (the daemon can't
 * touch the App-Management-protected /Applications bundle itself).
 */

import { spawn } from "child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { getBundledVersion } from "@/lib/version/bundle-version";

/** Flag file the desktop app checks to force one install even when auto-update is off. */
export const FORCE_UPDATE_FLAG = join(homedir(), ".hivematrix", ".force-update");
export const UPDATE_IN_PROGRESS_FLAG = join(homedir(), ".hivematrix", ".update-in-progress.json");

// Must match plugins.updater.endpoints in src-tauri/tauri.conf.json.
// The core identity (com.irvcassio.hivematrix.core) polls its own feed asset so
// the frozen old com.cassio.hivematrix `latest.json` never auto-jumps installs
// across bundle IDs (which would reset every macOS TCC grant).
const FEED_URL =
  "https://github.com/irvencassio/hivematrix/releases/latest/download/hivematrix-core.json";
const TTL_MS = 60 * 1000;
/** Failed checks expire fast — see the ttl selection in getUpdateStatus. */
const ERROR_TTL_MS = 5 * 1000;
const APPLYING_TTL_MS = 5 * 60 * 1000;
const APP_PROCESS_MATCH = "HiveMatrix.app/Contents/MacOS/app";

export interface UpdateStatus {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  applying?: boolean;
  applyingVersion?: string;
  needsDaemonRestart?: boolean;
  detail?: string;
  error?: string;
}

let cache: { at: number; status: UpdateStatus } | null = null;

function clearPath(path: string): void {
  try { rmSync(path, { force: true }); } catch { /* best effort */ }
}

function applyingMarker(path = UPDATE_IN_PROGRESS_FLAG, now = Date.now()): { version: string; stale: boolean } | null {
  if (!existsSync(path)) return null;
  try {
    const marker = JSON.parse(readFileSync(path, "utf-8")) as { version?: unknown; startedAt?: unknown };
    const version = typeof marker.version === "string" ? marker.version : null;
    const startedAt = typeof marker.startedAt === "number" ? marker.startedAt : 0;
    if (version) return { version, stale: now - startedAt > APPLYING_TTL_MS };
  } catch { /* stale/corrupt marker */ }
  clearPath(path);
  return null;
}

function markApplying(version: string, path = UPDATE_IN_PROGRESS_FLAG): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version, startedAt: Date.now() }));
}

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

export async function getUpdateStatus(opts: { force?: boolean; fetchImpl?: typeof fetch; updateInProgressPath?: string; forceFlagPath?: string; nowMs?: number } = {}): Promise<UpdateStatus> {
  const current = getBundledVersion();
  const now = opts.nowMs ?? Date.now();
  // A FAILED check must not be cached as long as a successful one. A single
  // transient fetch timeout otherwise pins `updateAvailable:false` for the full
  // TTL, so the console's update indicator stays dark while an update really is
  // published — which is exactly how 0.1.220 looked "not staged" despite being
  // live on the feed. Errors expire fast so the next poll re-checks.
  const ttl = cache?.status.error ? ERROR_TTL_MS : TTL_MS;
  if (!opts.force && cache && now - cache.at < ttl) return cache.status;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let status: UpdateStatus;
  try {
    // Cache-bust. GitHub's asset CDN serves `releases/latest/download/...` from
    // an edge that can hold a PREVIOUS release for many minutes even after the
    // new one is published and marked Latest — observed 2026-07-19: the tag URL
    // returned 0.1.229 while this path still returned 0.1.228 with
    // `x-cache: MISS, HIT` and `age: 1551`. Without this the daemon reports
    // "already up to date" straight after a release and refuses to update,
    // which reads as a broken updater rather than a stale cache. The query
    // string is ignored by the origin and defeats the edge key; no-store also
    // stops any local HTTP cache from repeating the mistake.
    const res = await fetchImpl(`${FEED_URL}?t=${Date.now()}`, {
      signal: AbortSignal.timeout(6000),
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const feed = (await res.json()) as { version?: string };
    const latest = typeof feed.version === "string" ? feed.version : null;
    status = {
      current,
      latest,
      updateAvailable: !!latest && compareVersions(latest, current) > 0,
      checkedAt: new Date().toISOString(),
    };
    const applying = applyingMarker(opts.updateInProgressPath, now);
    if (status.updateAvailable && applying && applying.version === latest) {
      status.applyingVersion = applying.version;
      if (applying.stale) {
        status.applying = false;
        status.needsDaemonRestart = true;
        status.detail = `HiveMatrix ${latest} appears installed, but the daemon is still serving ${current}. Restart the bundled daemon to finish the update.`;
      } else {
        status.applying = true;
      }
    } else if (!status.updateAvailable) {
      clearPath(opts.updateInProgressPath ?? UPDATE_IN_PROGRESS_FLAG);
      clearPath(opts.forceFlagPath ?? FORCE_UPDATE_FLAG);
    }
  } catch (e) {
    status = {
      current,
      latest: null,
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
  cache = { at: now, status };
  return status;
}

/**
 * Relaunch the desktop app so its Tauri updater pulls + installs the update.
 * Uses pkill (signal-based, no AppleEvents/Automation TCC prompt) then reopens.
 * Detached so it survives the daemon restart the updater triggers mid-install.
 */
export function applyUpdateViaRelaunch(
  spawnImpl: typeof spawn = spawn,
  opts: { fetchImpl?: typeof fetch; forceFlagPath?: string; updateInProgressPath?: string } = {},
): Promise<{ ok: boolean; detail: string; version?: string }> {
  return applyUpdateViaRelaunchAsync(spawnImpl, opts);
}

async function applyUpdateViaRelaunchAsync(
  spawnImpl: typeof spawn,
  opts: { fetchImpl?: typeof fetch; forceFlagPath?: string; updateInProgressPath?: string },
): Promise<{ ok: boolean; detail: string; version?: string }> {
  const forceFlagPath = opts.forceFlagPath ?? FORCE_UPDATE_FLAG;
  const updateInProgressPath = opts.updateInProgressPath ?? UPDATE_IN_PROGRESS_FLAG;
  try {
    const status = await getUpdateStatus({ force: true, fetchImpl: opts.fetchImpl, updateInProgressPath, forceFlagPath });
    if (!status.updateAvailable || !status.latest) {
      clearPath(forceFlagPath);
      clearPath(updateInProgressPath);
      return { ok: false, detail: "HiveMatrix is already up to date" };
    }
    // Drop a force flag so the app installs this update even if auto-update is
    // off (manual "Install" must work regardless of the setting).
    try {
      mkdirSync(dirname(forceFlagPath), { recursive: true });
      writeFileSync(forceFlagPath, "1");
      markApplying(status.latest, updateInProgressPath);
    } catch { /* best effort */ }
    spawnImpl(
      "sh",
      ["-c", `sleep 1; pkill -f '${APP_PROCESS_MATCH}'; sleep 2; open -a HiveMatrix`],
      { detached: true, stdio: "ignore" },
    ).unref();
    return { ok: true, detail: `relaunching HiveMatrix to install ${status.latest}`, version: status.latest };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
