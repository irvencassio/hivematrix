/**
 * Cloudflare tunnel integration (cloudflared) for remote access to the daemon.
 *
 * Quick tunnel: `cloudflared tunnel --url http://localhost:<port>` → a random
 * *.trycloudflare.com URL, no account needed. The daemon manages the child
 * process and parses the URL from its output.
 *
 * SECURITY: a tunnel exposes the daemon to the internet. The bearer-token auth
 * is the only barrier, so the console no longer serves the token to requests
 * that arrive via Cloudflare (see CF-Connecting-IP handling in the server) —
 * remote clients must present the token out-of-band. A quick-tunnel URL is
 * random but not secret-grade; for production use a named tunnel behind
 * Cloudflare Access (see docs/REMOTE-ACCESS.md).
 */

import { spawn, type ChildProcess } from "child_process";
import { findBinary, buildCliPath } from "@/lib/config/binary-detection";
import {
  mergeRemoteAccessSettings,
  normalizePublicUrl,
  readRemoteAccessSettings,
  type RemoteAccessSettings,
} from "@/lib/tunnel/remote-access-settings";

const CLOUDFLARED_PATHS = ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"];
const QRENCODE_PATHS = ["/opt/homebrew/bin/qrencode", "/usr/local/bin/qrencode"];

export interface PairingPayloadOptions {
  cloudflareAccessClientId?: string;
  cloudflareAccessClientSecret?: string;
}

/** The pairing payload encoded into the QR (and matched by the iOS scanner). */
export function pairingPayload(url: string, token: string, options: PairingPayloadOptions = {}): string {
  const cloudflareAccessClientId = options.cloudflareAccessClientId?.trim();
  const cloudflareAccessClientSecret = options.cloudflareAccessClientSecret?.trim();
  return JSON.stringify({
    type: "hivematrix-connection",
    version: 1,
    url,
    token,
    ...(cloudflareAccessClientId && cloudflareAccessClientSecret
      ? { cloudflareAccess: { clientId: cloudflareAccessClientId, clientSecret: cloudflareAccessClientSecret } }
      : {}),
  });
}

export function qrencodeInstalled(): boolean {
  return !!findBinary("qrencode", QRENCODE_PATHS);
}

/** Render `data` to an SVG QR locally via qrencode (token never leaves the box). */
export function generateQrSvg(data: string): Promise<string | null> {
  const bin = findBinary("qrencode", QRENCODE_PATHS);
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    // Pass the payload as a positional arg (no shell → safe); qrencode's
    // stdin (-r -) isn't supported. -l M = medium error correction.
    const proc = spawn(bin, ["-t", "SVG", "-o", "-", "-m", "2", "-l", "M", data], { env: { ...process.env, PATH: buildCliPath() } });
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => resolve(code === 0 && out.includes("<svg") ? out : null));
  });
}

interface TunnelState {
  proc: ChildProcess | null;
  url: string | null;
  startedAt: number | null;
  mode: TunnelMode;
  owner: TunnelOwner | null;
}

const g = globalThis as typeof globalThis & { __hmTunnel?: TunnelState };
function state(): TunnelState {
  if (!g.__hmTunnel) g.__hmTunnel = { proc: null, url: null, startedAt: null, mode: "none", owner: null };
  return g.__hmTunnel;
}

export function cloudflaredPath(): string | null {
  return findBinary("cloudflared", CLOUDFLARED_PATHS);
}

export type TunnelMode = "none" | "quick" | "named";
export type TunnelOwner = "hivematrix" | "external" | "configured";

export interface TunnelStatus {
  installed: boolean;
  running: boolean;
  url: string | null;
  binary: string | null;
  qrInstalled: boolean;
  mode: TunnelMode;
  owner: TunnelOwner | null;
  canStop: boolean;
  cloudflareAccessConfigured: boolean;
  /** Saved Access client id (NOT a secret) so the UI can reflect saved state. */
  cloudflareAccessClientId: string | null;
  /** True when an Access client secret is stored. The secret itself is never returned. */
  cloudflareAccessSecretSaved: boolean;
}

export function tunnelStatus(): TunnelStatus {
  const s = state();
  const bin = cloudflaredPath();
  const settings = readRemoteAccessSettings();
  const childRunning = !!s.proc && !s.proc.killed;
  const configuredUrl = settings.namedHostname ?? null;
  const url = childRunning ? s.url : configuredUrl;
  const mode: TunnelMode = childRunning ? s.mode : configuredUrl ? "named" : "none";
  const owner: TunnelOwner | null = childRunning ? s.owner : configuredUrl ? "configured" : null;
  return {
    installed: !!bin,
    running: childRunning || !!configuredUrl,
    url,
    binary: bin,
    qrInstalled: qrencodeInstalled(),
    mode,
    owner,
    canStop: childRunning && s.owner === "hivematrix",
    cloudflareAccessConfigured: !!(settings.cloudflareAccessClientId && settings.cloudflareAccessClientSecret),
    cloudflareAccessClientId: settings.cloudflareAccessClientId ?? null,
    cloudflareAccessSecretSaved: !!settings.cloudflareAccessClientSecret,
  };
}

const TRYCF_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/**
 * Start a quick tunnel to the local daemon. Resolves once the public URL is
 * parsed (or rejects after timeout). Idempotent: returns the existing URL if
 * already running.
 */
export function startQuickTunnel(port: number, timeoutMs = 20_000): Promise<string> {
  const s = state();
  if (s.proc && !s.proc.killed && s.url) return Promise.resolve(s.url);
  const bin = cloudflaredPath();
  if (!bin) return Promise.reject(new Error("cloudflared not installed"));

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
      env: { ...process.env, PATH: buildCliPath() },
    });
    s.proc = proc;
    s.url = null;
    s.startedAt = Date.now();
    s.mode = "quick";
    s.owner = "hivematrix";
    let settled = false;
    const onData = (buf: Buffer) => {
      const m = buf.toString("utf-8").match(TRYCF_RE);
      if (m && !settled) {
        settled = true;
        s.url = m[0];
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData); // cloudflared prints the URL to stderr
    proc.on("exit", () => { s.proc = null; s.url = null; s.mode = "none"; s.owner = null; });
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { proc.kill(); } catch { /* */ } reject(new Error("tunnel URL not received in time")); }
    }, timeoutMs);
  });
}

/**
 * Run a *named* tunnel via its connector token (from the Cloudflare dashboard).
 * The public hostname is configured in the dashboard, not parsed from output,
 * so the caller supplies it for display/QR. Resolves once the connector starts.
 */
export function startNamedTunnel(connectorToken: string, hostname: string): Promise<string> {
  const s = state();
  const bin = cloudflaredPath();
  if (!bin) return Promise.reject(new Error("cloudflared not installed"));
  if (s.proc && !s.proc.killed) stopTunnel();
  const publicUrl = normalizePublicUrl(hostname) ?? hostname;
  mergeRemoteAccessSettings({ namedHostname: publicUrl });
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["tunnel", "--no-autoupdate", "run", "--token", connectorToken], {
      env: { ...process.env, PATH: buildCliPath() },
    });
    s.proc = proc;
    s.url = publicUrl;
    s.startedAt = Date.now();
    s.mode = "named";
    s.owner = "hivematrix";
    let settled = false;
    const onData = (buf: Buffer) => {
      const t = buf.toString("utf-8");
      // "Registered tunnel connection" / "Connection ... registered" → up.
      if (!settled && /registered tunnel connection|connection .* registered|Updated to new configuration/i.test(t)) {
        settled = true; clearTimeout(timer); resolve(s.url ?? hostname);
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", () => { s.proc = null; s.url = null; s.mode = "none"; s.owner = null; });
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(s.url ?? publicUrl); } }, 12_000);
  });
}

export function configureNamedTunnel(hostname: string): TunnelStatus {
  mergeRemoteAccessSettings({ namedHostname: hostname });
  const s = state();
  if (!s.proc || s.proc.killed) {
    s.url = null;
    s.mode = "none";
    s.owner = null;
  }
  return tunnelStatus();
}

export function updateNamedTunnelAccess(settings: RemoteAccessSettings): TunnelStatus {
  // Only overwrite a credential when a non-empty value is supplied — a blank
  // field means "leave unchanged", so saving just the secret can never wipe the
  // stored client id (or vice versa). This was the "it doesn't seem to save" bug.
  const patch: RemoteAccessSettings = {};
  const id = settings.cloudflareAccessClientId?.trim();
  const secret = settings.cloudflareAccessClientSecret?.trim();
  if (id) patch.cloudflareAccessClientId = id;
  if (secret) patch.cloudflareAccessClientSecret = secret;
  mergeRemoteAccessSettings(patch);
  return tunnelStatus();
}

export function stopTunnel(): boolean {
  const s = state();
  if (s.proc && !s.proc.killed) { try { s.proc.kill(); } catch { /* */ } }
  s.proc = null; s.url = null; s.startedAt = null; s.mode = "none"; s.owner = null;
  return true;
}
