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
  /** True when `tailscale serve` is actively proxying our port to the tailnet. */
  serving: boolean;
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
): Omit<TailscaleStatus, "installed" | "serving"> {
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
  // The daemon binds loopback and is exposed via `tailscale serve`, which
  // publishes it as HTTPS on the node's MagicDNS name (port 443) → 127.0.0.1:port.
  // So the reachable pairing endpoint is https://<magicDNS>, NOT http://<ip>:port
  // (the raw tailnet IP:port is never served with a loopback bind). `port` is kept
  // for callers that expose the daemon differently.
  void port;
  const pairingUrl = dns ? `https://${dns}` : null;
  return { running, ipv4, magicDNSName: dns, pairingUrl };
}

/**
 * Pure parse of `tailscale serve status --json`. True when any handler on any
 * served host proxies to our port — that's the daemon reachable over the
 * tailnet. Never throws.
 */
export function parseServeStatusJSON(raw: string, port: number): boolean {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return false;
  }
  const web = (j as Record<string, unknown> | null)?.Web;
  if (!web || typeof web !== "object") return false;
  for (const site of Object.values(web as Record<string, unknown>)) {
    const handlers = (site as Record<string, unknown> | null)?.Handlers;
    if (!handlers || typeof handlers !== "object") continue;
    for (const h of Object.values(handlers as Record<string, unknown>)) {
      const proxy = (h as Record<string, unknown> | null)?.Proxy;
      if (typeof proxy === "string" && proxy.endsWith(`:${port}`)) return true;
    }
  }
  return false;
}

/** Live serve status. Impure (shells out with a short timeout); never throws. */
export function tailscaleServeActive(port: number): boolean {
  const bin = tailscalePath();
  if (!bin) return false;
  try {
    const raw = execFileSync(bin, ["serve", "status", "--json"], { timeout: 4000 }).toString();
    return parseServeStatusJSON(raw, port);
  } catch {
    return false;
  }
}

export interface TailscaleServeResult {
  ok: boolean;
  error?: string;
}

/**
 * `tailscale serve --bg <port>` — proxy the tailnet to our loopback daemon.
 * The most common failure is tailnet HTTPS certs not being enabled (admin
 * console → DNS → Enable HTTPS); the raw stderr is returned so the console can
 * show the operator exactly what Tailscale said instead of a generic failure.
 */
function realStartTailscaleServe(port: number): TailscaleServeResult {
  const bin = tailscalePath();
  if (!bin) return { ok: false, error: "Tailscale is not installed on this Mac." };
  const override = process.env.TS_SERVE_CMD;
  try {
    if (override) {
      const [cmd, ...args] = override.split(/\s+/).filter(Boolean);
      execFileSync(cmd, args, { timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    } else {
      execFileSync(bin, ["serve", "--bg", String(port)], { timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    }
    return { ok: true };
  } catch (e) {
    const stderr = (e as { stderr?: Buffer })?.stderr?.toString().trim();
    const message = stderr || (e instanceof Error ? e.message : String(e));
    return { ok: false, error: message };
  }
}

/**
 * `tailscale serve reset` — stop proxying the daemon to the tailnet.
 * CAVEAT: this clears the node's ENTIRE serve config, not just HiveMatrix's
 * handler. Fine on a single-purpose Mac; override with TS_SERVE_RESET_CMD if
 * this Mac serves anything else via `tailscale serve`.
 */
function realStopTailscaleServe(): TailscaleServeResult {
  const bin = tailscalePath();
  if (!bin) return { ok: false, error: "Tailscale is not installed on this Mac." };
  const override = process.env.TS_SERVE_RESET_CMD;
  try {
    if (override) {
      const [cmd, ...args] = override.split(/\s+/).filter(Boolean);
      execFileSync(cmd, args, { timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    } else {
      execFileSync(bin, ["serve", "reset"], { timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    }
    return { ok: true };
  } catch (e) {
    const stderr = (e as { stderr?: Buffer })?.stderr?.toString().trim();
    const message = stderr || (e instanceof Error ? e.message : String(e));
    return { ok: false, error: message };
  }
}

type StartServeFn = (port: number) => TailscaleServeResult;
type StopServeFn = () => TailscaleServeResult;

let startServeImpl: StartServeFn = realStartTailscaleServe;
let stopServeImpl: StopServeFn = realStopTailscaleServe;

export function startTailscaleServe(port: number): TailscaleServeResult {
  return startServeImpl(port);
}

export function stopTailscaleServe(): TailscaleServeResult {
  return stopServeImpl();
}

/** Test-only seam so route tests never shell out to the real `tailscale` binary. */
export function _setTailscaleServeDepsForTests(deps: { start?: StartServeFn; stop?: StopServeFn } | null): void {
  startServeImpl = deps?.start ?? realStartTailscaleServe;
  stopServeImpl = deps?.stop ?? realStopTailscaleServe;
}

/** Live tailnet status. Impure (shells out with a short timeout); never throws. */
export function tailscaleStatus(port: number): TailscaleStatus {
  const bin = tailscalePath();
  if (!bin) return { installed: false, running: false, ipv4: null, magicDNSName: null, pairingUrl: null, serving: false };
  try {
    const raw = execFileSync(bin, ["status", "--json"], { timeout: 4000 }).toString();
    const parsed = parseTailscaleStatusJSON(raw, port);
    return { installed: true, ...parsed, serving: parsed.running ? tailscaleServeActive(port) : false };
  } catch {
    return { installed: true, running: false, ipv4: null, magicDNSName: null, pairingUrl: null, serving: false };
  }
}

/** Keep only ICE servers whose every url is a stun: URL (drop turn:/turns:). */
export function filterStunOnly<T extends { urls: string | string[] }>(servers: T[]): T[] {
  return servers.filter((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.length > 0 && urls.every((u) => typeof u === "string" && u.startsWith("stun:"));
  });
}
