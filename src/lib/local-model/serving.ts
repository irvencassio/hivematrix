/**
 * Local model serving lifecycle (W3.1).
 *
 * When the Qwen profile says the model lives "on this laptop" (location:
 * "local"), HiveMatrix OWNS the inference server process: it launches it,
 * health-probes it, and relaunches it if it dies — so the 100%-local posture
 * survives crashes and reboots with zero human action. For "lan"/"public"
 * locations we don't own the process and only report health.
 *
 * The tick DECISION is pure (decideServeTick) so it's unit-testable; the
 * supervisor wraps it with a real probe + spawn.
 */

import { spawn, type ChildProcess } from "child_process";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getQwenProfile, type QwenProfile, type QwenProvider } from "@/lib/config/qwen-profile";

const CHECK_INTERVAL_MS = 8_000;
const RELAUNCH_THROTTLE_MS = 12_000; // don't hammer a crash-looping server
// PATHs a GUI/launchd daemon won't have by default but where mlx/lms/ollama live.
const EXTRA_PATHS = [
  "/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local/bin"),
  join(homedir(), ".lmstudio/bin"),
];

export interface ServeCommand { cmd: string; args: string[] }

/** Parse the port from an endpoint URL (default 8080). */
export function portFromEndpoint(endpoint: string): number {
  try {
    const u = new URL(endpoint);
    if (u.port) return parseInt(u.port, 10);
    return u.protocol === "https:" ? 443 : 8080;
  } catch {
    return 8080;
  }
}

function readServeCommandOverride(): string[] | null {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    const c = cfg?.qwen?.serveCommand;
    if (Array.isArray(c) && c.length > 0 && c.every((x) => typeof x === "string")) return c as string[];
  } catch { /* none */ }
  return null;
}

/**
 * The command to start the local server, or null if we don't manage it
 * (remote location, or a provider with no local-launch story). A
 * `config.qwen.serveCommand` array overrides the provider default (escape hatch
 * + test seam).
 */
export function resolveServeCommand(profile: QwenProfile, override = readServeCommandOverride()): ServeCommand | null {
  if (profile.location !== "local") return null;
  if (override) return { cmd: override[0], args: override.slice(1) };

  const { modelId, endpoint, provider } = profile.primary;
  const port = String(portFromEndpoint(endpoint));
  const byProvider: Record<QwenProvider, ServeCommand | null> = {
    mlx: { cmd: "mlx_lm.server", args: ["--model", modelId, "--host", "127.0.0.1", "--port", port] },
    lmstudio: { cmd: "lms", args: ["server", "start", "--port", port] },
    ollama: { cmd: "ollama", args: ["serve"] },
    vllm: null, // vLLM is a LAN/GPU-box story, not a Mac-local default
  };
  return byProvider[provider];
}

export type ServeTickDecision =
  | { action: "unmanaged" }      // remote, or no launch command — just report
  | { action: "healthy" }        // up; nothing to do
  | { action: "starting" }       // child alive but not yet healthy — wait
  | { action: "throttled" }      // down, but too soon since last launch
  | { action: "spawn" };         // down + eligible — (re)launch

/** Pure per-tick decision. */
export function decideServeTick(input: {
  location: QwenProfile["location"];
  hasCommand: boolean;
  healthy: boolean;
  childAlive: boolean;
  msSinceLastStart: number;
  throttleMs?: number;
}): ServeTickDecision {
  if (input.location !== "local" || !input.hasCommand) return { action: "unmanaged" };
  if (input.healthy) return { action: "healthy" };
  if (input.childAlive) return { action: "starting" };
  if (input.msSinceLastStart < (input.throttleMs ?? RELAUNCH_THROTTLE_MS)) return { action: "throttled" };
  return { action: "spawn" };
}

/** Cheap liveness probe: GET <endpoint>/v1/models with a short timeout. */
export async function isServerUp(endpoint: string, timeoutMs = 2_500): Promise<boolean> {
  const base = endpoint.replace(/\/+$/, "");
  const url = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Supervisor ────────────────────────────────────────────────────────────────

export interface ServingStatus {
  managed: boolean;
  location: QwenProfile["location"] | "none";
  provider: QwenProvider | null;
  endpoint: string | null;
  modelId: string | null;
  healthy: boolean;
  pid: number | null;
  restarts: number;
  lastStartAt: string | null;
  lastExitAt: string | null;
  lastError: string | null;
}

const state: ServingStatus = {
  managed: false, location: "none", provider: null, endpoint: null, modelId: null,
  healthy: false, pid: null, restarts: 0, lastStartAt: null, lastExitAt: null, lastError: null,
};
let child: ChildProcess | null = null;
let lastStartMs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let relaunchThrottleMs = RELAUNCH_THROTTLE_MS;

export function getServingStatus(): ServingStatus {
  return { ...state };
}

function spawnServer(command: ServeCommand): void {
  const env = { ...process.env, PATH: `${EXTRA_PATHS.join(":")}:${process.env.PATH ?? ""}` };
  try {
    const proc = spawn(command.cmd, command.args, { env, stdio: "ignore", detached: false });
    child = proc;
    state.pid = proc.pid ?? null;
    state.lastStartAt = new Date().toISOString();
    state.lastError = null;
    state.restarts += 1;
    lastStartMs = Date.now();
    proc.on("exit", () => {
      state.lastExitAt = new Date().toISOString();
      state.pid = null;
      if (child === proc) child = null;
    });
    proc.on("error", (err) => {
      state.lastError = `${command.cmd}: ${err.message}`;
      state.pid = null;
      if (child === proc) child = null;
    });
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
  }
}

async function tick(): Promise<void> {
  const profile = getQwenProfile();
  if (!profile) {
    state.managed = false; state.location = "none"; state.healthy = false;
    return;
  }
  const command = resolveServeCommand(profile);
  state.location = profile.location;
  state.provider = profile.primary.provider;
  state.endpoint = profile.primary.endpoint;
  state.modelId = profile.primary.modelId;
  state.managed = profile.location === "local" && command !== null;

  state.healthy = await isServerUp(profile.primary.endpoint);

  const decision = decideServeTick({
    location: profile.location,
    hasCommand: command !== null,
    healthy: state.healthy,
    childAlive: child !== null && state.pid !== null,
    msSinceLastStart: Date.now() - lastStartMs,
    throttleMs: relaunchThrottleMs,
  });

  if (decision.action === "spawn" && command) {
    console.log(`[serving] local model down — launching ${command.cmd}`);
    spawnServer(command);
  }
}

/** Start supervising the local model server (idempotent). Returns a stop fn. */
export function startLocalServingSupervisor(
  opts: { intervalMs?: number; throttleMs?: number } = {},
): () => void {
  if (timer) return stopLocalServingSupervisor;
  relaunchThrottleMs = opts.throttleMs ?? RELAUNCH_THROTTLE_MS;
  // Run a tick immediately, then on an interval.
  void tick();
  timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void tick().finally(() => { ticking = false; });
  }, opts.intervalMs ?? CHECK_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  return stopLocalServingSupervisor;
}

export function stopLocalServingSupervisor(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
