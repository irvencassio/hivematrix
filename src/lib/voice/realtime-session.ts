/**
 * Realtime voice session manager (P5.2). The iOS client connects to the Pipecat
 * pipeline over P2P WebRTC; the daemon is the control plane — it spawns the
 * headless Python realtime server (voice-sidecar/realtime_server.py) once, relays
 * the client's SDP offer to it, and hands the client ICE servers (STUN + the
 * operator's Cloudflare TURN) for off-LAN connectivity. Media never flows through
 * the daemon — only signaling.
 *
 * The Python process is long-lived and handles many sessions; we lazily start it
 * on the first offer and reuse it. TURN config lives in ~/.hivematrix/config.json
 * under `turn` (urls + optional username/credential).
 */

import { spawn, type ChildProcess } from "child_process";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { buildCliPath } from "@/lib/config/binary-detection";
import { voiceRuntime } from "./runtime";
import { voiceLlmEnv } from "./llm-env";

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Parse ICE servers from a config object. Always includes a public STUN server;
 * appends the operator's TURN (from `config.turn`) when configured. Pure → tested.
 */
export function parseTurnConfig(config: unknown): IceServer[] {
  const servers: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turn = (config as Record<string, unknown>)?.turn as Record<string, unknown> | undefined;
  if (turn && typeof turn === "object") {
    const urls = turn.urls;
    const list = Array.isArray(urls)
      ? urls.filter((u): u is string => typeof u === "string" && !!u)
      : typeof urls === "string" && urls
        ? [urls]
        : [];
    if (list.length) {
      const s: IceServer = { urls: list };
      if (typeof turn.username === "string") s.username = turn.username;
      if (typeof turn.credential === "string") s.credential = turn.credential;
      servers.push(s);
    }
  }
  return servers;
}

function readConfig(): unknown {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
  } catch {
    return {};
  }
}

// --- Cloudflare Realtime TURN: mint short-lived ICE credentials from a TURN Key
// (TURN_KEY_ID + TURN_API_TOKEN, via env or ~/.hivematrix/config.json). Both the
// iOS client (GET /voice/rtc/config) and the aiortc server (HIVE_TURN_*) need
// relay candidates to connect off-LAN. Cached until shortly before expiry; falls
// back to a static `turn` config block, else STUN-only. ---
interface TurnKey { keyId: string; token: string; }

function turnKeyCreds(): TurnKey | null {
  const cfg = readConfig() as Record<string, unknown>;
  const keyId = (process.env.TURN_KEY_ID || (cfg.turnKeyId as string) || "").trim();
  const token = (process.env.TURN_API_TOKEN || (cfg.turnApiToken as string) || "").trim();
  return keyId && token ? { keyId, token } : null;
}

let _iceCache: { servers: IceServer[]; exp: number } | null = null;

async function mintCloudflareIce(creds: TurnKey, ttl: number): Promise<IceServer[]> {
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${creds.keyId}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl }),
  });
  if (!r.ok) throw new Error(`cloudflare turn ${r.status}`);
  const data = await r.json() as { iceServers?: unknown };
  const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
  return list.map((s) => {
    const o = s as Record<string, unknown>;
    const urls = Array.isArray(o.urls) ? (o.urls as string[]) : typeof o.urls === "string" ? [o.urls] : [];
    const out: IceServer = { urls };
    if (typeof o.username === "string") out.username = o.username;
    if (typeof o.credential === "string") out.credential = o.credential;
    return out;
  }).filter((s) => (Array.isArray(s.urls) ? s.urls.length : !!s.urls));
}

/** ICE servers for the client AND the aiortc server. Cloudflare-minted (cached)
 * when a TURN Key is configured, else the static `turn` config / STUN-only. */
async function getIceServers(): Promise<IceServer[]> {
  const creds = turnKeyCreds();
  if (creds) {
    const now = Date.now();
    if (_iceCache && _iceCache.exp > now) return _iceCache.servers;
    try {
      const ttl = 86400; // 24h
      const servers = await mintCloudflareIce(creds, ttl);
      if (servers.length) {
        _iceCache = { servers, exp: now + ttl * 800 }; // refresh at ~80% of TTL (ms)
        return servers;
      }
    } catch (e) {
      console.error(`[turn] Cloudflare mint failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return parseTurnConfig(readConfig());
}

/** ICE servers handed to the client (GET /voice/rtc/config). */
export async function realtimeIceServers(): Promise<IceServer[]> {
  return getIceServers();
}

/** HIVE_TURN_* env so the Python (aiortc) side gathers relay candidates too. */
async function turnEnv(): Promise<Record<string, string>> {
  const turn = (await getIceServers()).find((s) => {
    const u = Array.isArray(s.urls) ? s.urls[0] : s.urls;
    return typeof u === "string" && u.startsWith("turn");
  });
  if (!turn) return {};
  const urls = Array.isArray(turn.urls) ? turn.urls.join(",") : turn.urls;
  const env: Record<string, string> = { HIVE_TURN_URLS: urls };
  if (turn.username) env.HIVE_TURN_USERNAME = turn.username;
  if (turn.credential) env.HIVE_TURN_CREDENTIAL = turn.credential;
  return env;
}

let _proc: ChildProcess | null = null;
let _port: number | null = null;
let _starting: Promise<number> | null = null;

/** Spawn (or reuse) the headless realtime server; resolves its localhost port. */
export function ensureRealtimeServer(): Promise<number> {
  if (_proc && _port && _proc.exitCode === null && !_proc.killed) return Promise.resolve(_port);
  if (_starting) return _starting;
  _starting = startServer().finally(() => { _starting = null; });
  return _starting;
}

async function startServer(): Promise<number> {
  const rt = voiceRuntime();
  if (!rt) throw new Error("voice runtime not available — enable Voice in Settings");
  const tEnv = await turnEnv();
  return new Promise<number>((resolve, reject) => {
    const env = { ...process.env, ...voiceLlmEnv(), ...tEnv, PATH: buildCliPath() };
    const proc = spawn(rt.python, [join(rt.scriptsDir, "realtime_server.py"), "--port", "0"], { cwd: rt.scriptsDir, env });
    let resolved = false;
    const onLine = (d: Buffer) => {
      const m = d.toString().match(/REALTIME_READY (\d+)/);
      if (m && !resolved) {
        resolved = true;
        _proc = proc;
        _port = parseInt(m[1], 10);
        resolve(_port);
      }
    };
    proc.stdout?.on("data", onLine);
    proc.stderr?.on("data", (d: Buffer) => { const s = d.toString().trimEnd(); if (s) console.error(`[realtime] ${s}`); });
    proc.on("exit", () => { _proc = null; _port = null; });
    proc.on("error", (e) => { if (!resolved) { resolved = true; reject(e); } });
    setTimeout(() => { if (!resolved) { resolved = true; try { proc.kill(); } catch { /* ignore */ } reject(new Error("realtime server start timed out")); } }, 90_000);
  });
}

/** Relay a SmallWebRTC signaling request to the realtime server. `method` is
 * POST for an offer (returns the SDP answer) or PATCH for trickle-ICE updates.
 * The body is forwarded verbatim (sdp/type/pc_id/restart_pc/candidates …). */
export async function relayOffer(
  body: Record<string, unknown>,
  method: "POST" | "PATCH" = "POST",
): Promise<{ status: number; body: unknown }> {
  const port = await ensureRealtimeServer();
  const r = await fetch(`http://127.0.0.1:${port}/offer`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

/** Stop the realtime server (e.g. when the Voice feature is disabled). */
export function stopRealtimeServer(): void {
  if (_proc && !_proc.killed) { try { _proc.kill(); } catch { /* ignore */ } }
  _proc = null;
  _port = null;
}
