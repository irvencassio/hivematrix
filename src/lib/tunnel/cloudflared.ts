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

const CLOUDFLARED_PATHS = ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"];
const QRENCODE_PATHS = ["/opt/homebrew/bin/qrencode", "/usr/local/bin/qrencode"];

/** The pairing payload encoded into the QR (and matched by the iOS scanner). */
export function pairingPayload(url: string, token: string): string {
  return JSON.stringify({ type: "hivematrix-connection", version: 1, url, token });
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
}

const g = globalThis as typeof globalThis & { __hmTunnel?: TunnelState };
function state(): TunnelState {
  if (!g.__hmTunnel) g.__hmTunnel = { proc: null, url: null, startedAt: null };
  return g.__hmTunnel;
}

export function cloudflaredPath(): string | null {
  return findBinary("cloudflared", CLOUDFLARED_PATHS);
}

export interface TunnelStatus {
  installed: boolean;
  running: boolean;
  url: string | null;
  binary: string | null;
  qrInstalled: boolean;
}

export function tunnelStatus(): TunnelStatus {
  const s = state();
  const bin = cloudflaredPath();
  return { installed: !!bin, running: !!s.proc && !s.proc.killed, url: s.url, binary: bin, qrInstalled: qrencodeInstalled() };
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
    proc.on("exit", () => { s.proc = null; s.url = null; });
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
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["tunnel", "--no-autoupdate", "run", "--token", connectorToken], {
      env: { ...process.env, PATH: buildCliPath() },
    });
    s.proc = proc;
    s.url = hostname.trim().replace(/\/+$/, "");
    s.startedAt = Date.now();
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
    proc.on("exit", () => { s.proc = null; s.url = null; });
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(s.url ?? hostname); } }, 12_000);
  });
}

export function stopTunnel(): boolean {
  const s = state();
  if (s.proc && !s.proc.killed) { try { s.proc.kill(); } catch { /* */ } }
  s.proc = null; s.url = null; s.startedAt = null;
  return true;
}
