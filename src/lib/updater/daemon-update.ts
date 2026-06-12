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
import { getBundledVersion } from "@/lib/version/bundle-version";

const execFileAsync = promisify(execFile);
const LAUNCHD_LABEL = "com.hivematrix.daemon";
// Single source of truth: the running bundle's version (Info.plist when packaged,
// the compiled-in VERSION otherwise). No more hardcoded constant to drift.
export const CURRENT_VERSION = getBundledVersion();

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
  // Only attach the bearer token over HTTPS so a misconfigured (http / wrong
  // host) channelUrl can't leak the token in cleartext.
  let headers: Record<string, string> | undefined;
  const token = resolveAuthToken(u);
  const channelUrl = typeof u.channelUrl === "string" ? u.channelUrl : null;
  if (token && channelUrl && channelUrl.startsWith("https://")) {
    headers = { Authorization: `Bearer ${token}` };
    if (typeof u.accept === "string") headers.Accept = u.accept;
  }

  return { channelUrl, channel, publicKeyPem, headers };
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

/**
 * Download a release tarball to a temp path. GitHub-aware: for a private repo,
 * the public release-download URL 404s even with a token, so when the URL is a
 * github.com release-download URL and we have auth, resolve the asset's API URL
 * (api.github.com/.../releases/assets/:id) and fetch that with
 * Accept: application/octet-stream. Public repos / non-GitHub URLs fetch directly.
 */
export async function downloadRelease(
  release: UpdateRelease,
  headers: Record<string, string> | undefined,
  destPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { writeFile } = await import("fs/promises");
  let url = release.tarballUrl;
  let reqHeaders: Record<string, string> = { ...(headers ?? {}) };

  const gh = release.tarballUrl.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/
  );
  const token = headers?.Authorization;
  if (gh && token) {
    const [, owner, repo, tag, name] = gh;
    const apiTag = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;
    const relRes = await fetchImpl(apiTag, { headers: { Authorization: token, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20_000) });
    if (!relRes.ok) throw new Error(`release lookup failed: HTTP ${relRes.status}`);
    const rel = await relRes.json() as { assets?: Array<{ name: string; url: string }> };
    const asset = rel.assets?.find((a) => a.name === decodeURIComponent(name));
    if (!asset) throw new Error(`asset ${name} not found in release ${tag}`);
    url = asset.url;
    reqHeaders = { Authorization: token, Accept: "application/octet-stream" };
  }

  const res = await fetchImpl(url, { headers: reqHeaders, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
  return destPath;
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
