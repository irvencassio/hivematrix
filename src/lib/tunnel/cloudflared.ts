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
}

export function tunnelStatus(): TunnelStatus {
  const s = state();
  const bin = cloudflaredPath();
  return { installed: !!bin, running: !!s.proc && !s.proc.killed, url: s.url, binary: bin };
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

export function stopTunnel(): boolean {
  const s = state();
  if (s.proc && !s.proc.killed) { try { s.proc.kill(); } catch { /* */ } }
  s.proc = null; s.url = null; s.startedAt = null;
  return true;
}
