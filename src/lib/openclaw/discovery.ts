/**
 * OpenClaw discovery — locates the binary, runs a version check, and probes
 * Gateway reachability. Never reads or returns OpenClaw auth secrets or tokens.
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { buildCliPath, findBinary } from "@/lib/config/binary-detection";

export const OPENCLAW_SEARCH_PATHS = [
  "/opt/homebrew/bin/openclaw",
  "/usr/local/bin/openclaw",
];

const DEFAULT_GATEWAY_WS_URL = "ws://127.0.0.1:18789";
const VERSION_TIMEOUT_MS = 3_000;
const GATEWAY_PROBE_TIMEOUT_MS = 2_000;

export interface OpenclawGatewayStatus {
  reachable: boolean;
  url: string;
}

export interface OpenclawDiscovery {
  installed: boolean;
  available: boolean;
  version: string | null;
  gateway: OpenclawGatewayStatus | null;
  reason: string | null;
}

/**
 * Locate the openclaw binary.
 * Priority: OPENCLAW_BIN env > PATH (via which) > known Homebrew/local paths.
 */
export function resolveOpenclawBin(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.OPENCLAW_BIN?.trim();
  if (override) {
    return existsSync(override) ? override : null;
  }
  return findBinary("openclaw", OPENCLAW_SEARCH_PATHS);
}

/**
 * Run `openclaw --version` and return the trimmed output.
 * Returns null on timeout, missing binary, or non-zero exit.
 */
export function runVersionCheck(binPath: string): string | null {
  try {
    const out = execFileSync(binPath, ["--version"], {
      encoding: "utf-8",
      timeout: VERSION_TIMEOUT_MS,
      env: { ...process.env, PATH: buildCliPath() },
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Read the gateway WebSocket URL from OpenClaw's local config.
 * Falls back to the documented default. Never returns token or secret fields.
 */
export function readGatewayUrl(): string {
  const candidates = [
    join(homedir(), ".openclaw", "config.json"),
    join(homedir(), ".config", "openclaw", "config.json"),
  ];
  for (const p of candidates) {
    try {
      const cfg = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
      const gw = cfg.gateway;
      if (gw && typeof gw === "object") {
        const url = (gw as Record<string, unknown>).url;
        if (typeof url === "string" && (url.startsWith("ws://") || url.startsWith("wss://"))) {
          return url;
        }
      }
      if (typeof cfg.gatewayUrl === "string" && cfg.gatewayUrl.startsWith("ws")) {
        return cfg.gatewayUrl;
      }
    } catch {
      // config not at this path — continue
    }
  }
  return DEFAULT_GATEWAY_WS_URL;
}

/**
 * Probe the Gateway by making a short-timeout HTTP request (ws:// → http://).
 * Any HTTP response (including 4xx/5xx) means the process is listening on the port.
 */
export async function probeGateway(wsUrl: string): Promise<boolean> {
  const httpUrl = wsUrl.startsWith("wss://")
    ? wsUrl.replace("wss://", "https://")
    : wsUrl.replace("ws://", "http://");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATEWAY_PROBE_TIMEOUT_MS);
  try {
    await fetch(httpUrl, { method: "GET", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Module-level override for server-level tests — lets route tests stub discovery
// without touching real binaries or network sockets.
let _discoveryOverride: (() => Promise<OpenclawDiscovery>) | null = null;

export function _setOpenclawDiscoveryForTests(fn: (() => Promise<OpenclawDiscovery>) | null): void {
  _discoveryOverride = fn;
}

/**
 * Full discovery: locate binary → version check → Gateway probe.
 * All external operations are injectable for testing.
 */
export async function discoverOpenclaw(opts: {
  env?: NodeJS.ProcessEnv;
  probe?: (wsUrl: string) => Promise<boolean>;
  _versionFn?: (bin: string) => string | null;
  _gatewayUrlFn?: () => string;
} = {}): Promise<OpenclawDiscovery> {
  if (_discoveryOverride) return _discoveryOverride();
  const env = opts.env ?? process.env;
  const probe = opts.probe ?? probeGateway;
  const versionFn = opts._versionFn ?? runVersionCheck;
  const gatewayUrlFn = opts._gatewayUrlFn ?? readGatewayUrl;

  const binPath = resolveOpenclawBin(env);
  if (!binPath) {
    return {
      installed: false,
      available: false,
      version: null,
      gateway: null,
      reason: "OpenClaw is not installed.",
    };
  }

  const version = versionFn(binPath);
  if (!version) {
    return {
      installed: true,
      available: false,
      version: null,
      gateway: null,
      reason: "OpenClaw binary found but did not respond to --version.",
    };
  }

  const gatewayUrl = gatewayUrlFn();
  const reachable = await probe(gatewayUrl);

  return {
    installed: true,
    available: reachable,
    version,
    gateway: { reachable, url: gatewayUrl },
    reason: reachable ? null : "OpenClaw Gateway is not reachable.",
  };
}
