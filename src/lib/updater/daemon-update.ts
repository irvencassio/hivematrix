/**
 * Daemon-side wiring for the updater engine: configuration, the concrete
 * launchd restart hook, and a check that's safe to expose over the API.
 *
 * The update channel/CDN + signing key are operator-provided (config); with
 * none configured the daemon reports "not configured" rather than guessing.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { promisify } from "util";
import { execFile } from "child_process";
import { checkForUpdate, type UpdateHooks } from "./updater";
import type { UpdateChannel, UpdateRelease } from "./manifest";

const execFileAsync = promisify(execFile);
const LAUNCHD_LABEL = "com.hivematrix.daemon";
export const CURRENT_VERSION = "0.1.0";

export interface UpdaterConfig {
  channelUrl: string | null;
  channel: UpdateChannel;
  publicKeyPem: string | null;
  /** Headers for the channel fetch (e.g. private-repo auth). */
  headers?: Record<string, string>;
}

function resolveAuthToken(u: Record<string, unknown>): string | null {
  if (typeof u.authTokenPath === "string" && existsSync(u.authTokenPath)) {
    try { return readFileSync(u.authTokenPath, "utf-8").trim(); } catch { /* ignore */ }
  }
  if (typeof u.authTokenEnv === "string" && process.env[u.authTokenEnv]) {
    return process.env[u.authTokenEnv]!;
  }
  if (typeof u.authToken === "string") return u.authToken;
  return null;
}

export function getUpdaterConfig(): UpdaterConfig {
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
  } catch { /* none */ }
  const u = (cfg.updater as Record<string, unknown>) ?? {};
  const channel: UpdateChannel = u.channel === "beta" ? "beta" : "stable";
  let publicKeyPem: string | null = null;
  if (typeof u.publicKeyPath === "string" && existsSync(u.publicKeyPath)) {
    try { publicKeyPem = readFileSync(u.publicKeyPath, "utf-8"); } catch { /* ignore */ }
  } else if (typeof u.publicKeyPem === "string") {
    publicKeyPem = u.publicKeyPem;
  }

  // Auth headers for a private channel (e.g. a private GitHub release asset:
  // GET the asset API URL with a token + Accept: application/octet-stream).
  let headers: Record<string, string> | undefined;
  const token = resolveAuthToken(u);
  if (token) {
    headers = { Authorization: `Bearer ${token}` };
    if (typeof u.accept === "string") headers.Accept = u.accept;
  }

  return {
    channelUrl: typeof u.channelUrl === "string" ? u.channelUrl : null,
    channel,
    publicKeyPem,
    headers,
  };
}

/**
 * Restart the daemon via launchd (kickstart -k restarts the running service).
 * Used as the updater's restart hook after a new version is installed.
 */
export async function restartViaLaunchd(): Promise<void> {
  const uid = process.getuid?.() ?? 0;
  await execFileAsync("launchctl", ["kickstart", "-k", `gui/${uid}/${LAUNCHD_LABEL}`]);
}

/**
 * Check the configured channel for an update. Returns a structured status the
 * daemon can serve directly. Never throws.
 */
export async function checkUpdateStatus(): Promise<{
  configured: boolean;
  currentVersion: string;
  channel: UpdateChannel;
  available: boolean;
  latestVersion: string | null;
  signatureReady: boolean;
  error?: string;
}> {
  const cfg = getUpdaterConfig();
  if (!cfg.channelUrl) {
    return {
      configured: false, currentVersion: CURRENT_VERSION, channel: cfg.channel,
      available: false, latestVersion: null, signatureReady: !!cfg.publicKeyPem,
    };
  }
  const r = await checkForUpdate(CURRENT_VERSION, cfg.channelUrl, cfg.channel, fetch, cfg.headers);
  return {
    configured: true,
    currentVersion: CURRENT_VERSION,
    channel: cfg.channel,
    available: r.available,
    // The version the channel advertises (surfaced even when not newer), so a
    // successful fetch+parse is observable. null only if the fetch failed.
    latestVersion: r.manifest?.latest.version ?? null,
    signatureReady: !!cfg.publicKeyPem,
    error: r.error,
  };
}

/** Build the production UpdateHooks (download via fetch, restart via launchd). */
export function productionHooks(
  download: (release: UpdateRelease) => Promise<string>,
  install: (tarballPath: string, release: UpdateRelease) => Promise<void>,
  probe: () => Promise<boolean>,
): UpdateHooks {
  return {
    download,
    install,
    restart: restartViaLaunchd,
    probe,
    publicKeyPem: getUpdaterConfig().publicKeyPem,
  };
}
