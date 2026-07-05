/**
 * Tailscale awareness for the daemon.
 *
 * The daemon binds loopback; a tailnet peer reaches it via `tailscale serve`.
 * This module detects the local tailnet identity (for a pairing URL surfaced on
 * GET /tunnel) and provides cheap, subprocess-free helpers to decide when a
 * live-voice client is on-mesh — so we can hand it STUN-only ICE and let WebRTC
 * go direct P2P instead of relaying through Cloudflare TURN.
 *
 * See docs/superpowers/specs/2026-07-05-daemon-tailscale-awareness-design.md.
 */
import { execFileSync } from "child_process";
import { existsSync } from "fs";

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  ipv4: string | null;
  magicDNSName: string | null;
  pairingUrl: string | null;
}

const CLI_CANDIDATES = [
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

export function tailscalePath(): string | null {
  for (const p of CLI_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  try {
    const p = execFileSync("/usr/bin/which", ["tailscale"], { timeout: 2000 }).toString().trim();
    if (p) return p;
  } catch {
    /* not on PATH */
  }
  return null;
}

/** Tailscale hands out addresses from the 100.64.0.0/10 CGNAT range. */
export function isTailnetAddress(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(String(ip).trim());
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * True when the request's Host header names a tailnet endpoint — a 100.x IP or
 * a MagicDNS `*.ts.net` name. Cheap (string-only), so it's safe on the hot
 * voice-config path with no subprocess.
 */
export function hostOnMesh(hostHeader: string | null | undefined): boolean {
  if (!hostHeader) return false;
  // Strip a trailing :port (IPv6 in brackets isn't used for tailnet hosts here).
  const host = hostHeader.trim().replace(/:\d+$/, "").toLowerCase();
  if (!host) return false;
  if (host.endsWith(".ts.net")) return true;
  return isTailnetAddress(host);
}

/** Pure parse of `tailscale status --json`. Never throws. */
export function parseTailscaleStatusJSON(
  raw: string,
  port: number,
): Omit<TailscaleStatus, "installed"> {
  const empty = { running: false, ipv4: null, magicDNSName: null, pairingUrl: null } as const;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return { ...empty };
  }
  const obj = (j ?? {}) as Record<string, unknown>;
  const self = (obj.Self ?? {}) as Record<string, unknown>;
  const running = obj.BackendState === "Running";
  const ips = Array.isArray(self.TailscaleIPs) ? (self.TailscaleIPs as unknown[]) : [];
  const ipv4 = (ips.find((ip) => typeof ip === "string" && isTailnetAddress(ip)) as string | undefined) ?? null;
  const dns = typeof self.DNSName === "string" && self.DNSName ? self.DNSName.replace(/\.$/, "") : null;
  const pairingUrl = ipv4 ? `http://${ipv4}:${port}` : null;
  return { running, ipv4, magicDNSName: dns, pairingUrl };
}

/** Live tailnet status. Impure (shells out with a short timeout); never throws. */
export function tailscaleStatus(port: number): TailscaleStatus {
  const bin = tailscalePath();
  if (!bin) return { installed: false, running: false, ipv4: null, magicDNSName: null, pairingUrl: null };
  try {
    const raw = execFileSync(bin, ["status", "--json"], { timeout: 4000 }).toString();
    return { installed: true, ...parseTailscaleStatusJSON(raw, port) };
  } catch {
    return { installed: true, running: false, ipv4: null, magicDNSName: null, pairingUrl: null };
  }
}

/** Keep only ICE servers whose every url is a stun: URL (drop turn:/turns:). */
export function filterStunOnly<T extends { urls: string | string[] }>(servers: T[]): T[] {
  return servers.filter((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.length > 0 && urls.every((u) => typeof u === "string" && u.startsWith("stun:"));
  });
}
