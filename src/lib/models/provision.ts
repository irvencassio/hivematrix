/**
 * Local-engine provisioning — the install side of the hardware-aware story.
 *
 * Sizes Rapid-MLX to THIS Mac (via localEngineCapability), installs the engine
 * if missing, pulls only the model tiers that fit in RAM, and writes the
 * matching `localEngine` block into config.json. Exposed as:
 *   • planLocalEngine()       — pure, what WOULD be provisioned (for the UI/CLI)
 *   • provisionLocalEngine()  — perform it, streaming progress via onLog
 *   • a singleton job tracker (start/get) so the daemon can run it in the
 *     background behind a one-click button and poll status.
 *
 * Installs/pulls run as child processes so this works in the bundled app (no
 * tsx / repo scripts required at runtime).
 */

import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { writeJsonAtomic } from "@/lib/config/atomic-write";
import {
  localEngineCapability, DEFAULT_TIERS, resolveRapidBinary, tierBaseUrl, selectLocalMemoryPreset,
  type LocalTier, type TierKey, type HardwareProbe, type LocalMemoryPresetId, type LocalPresetMode, type LocalMemoryPreset,
} from "./local-engine";
import type { QwenProfile } from "@/lib/config/qwen-profile";
import { provisioningPython } from "@/lib/voice/provision";

const execFileP = promisify(execFile);

/** rapid-mlx needs Python 3.13+ (no wheels for 3.9). Pure. */
export function pythonVersionOk(version: string): boolean {
  const m = version.match(/^(\d+)\.(\d+)/);
  if (!m) return false;
  const major = Number(m[1]), minor = Number(m[2]);
  return major > 3 || (major === 3 && minor >= 13);
}

async function pythonVersion(py: string): Promise<string> {
  try {
    const { stdout } = await execFileP(py, ["-c", "import sys;print('%d.%d' % sys.version_info[:2])"], { timeout: 10_000 });
    return stdout.trim();
  } catch { return ""; }
}

export interface ProvisionPlan {
  arch: string;
  ramGB: number;
  presetId: LocalMemoryPresetId;
  mode: LocalPresetMode;
  localCapable: boolean;
  recommendedTiers: TierKey[];
  /** Resolved tier definitions to serve resident (alias/port/reasoning). */
  tiers: LocalTier[];
  preset: LocalMemoryPreset;
  reason?: string;
}

function configPath(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "config.json");
}
function readConfig(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(configPath(), "utf-8")); } catch { return {}; }
}

/** Pure: what this Mac should run, as resolved LocalTier objects. */
export function planLocalEngine(env: Partial<HardwareProbe> = {}): ProvisionPlan {
  const cap = localEngineCapability(env);
  const preset = selectLocalMemoryPreset({ ramGB: cap.ramGB });
  const tiers = cap.recommendedTiers
    .map((k) => DEFAULT_TIERS.find((d) => d.key === k))
    .filter((t): t is LocalTier => !!t);
  return {
    arch: cap.arch, ramGB: cap.ramGB, presetId: cap.presetId, mode: cap.mode,
    localCapable: cap.localCapable,
    recommendedTiers: cap.recommendedTiers,
    tiers, preset, reason: cap.reason,
  };
}

export function qwenProfileForProvisionPlan(plan: ProvisionPlan): QwenProfile | null {
  if (!plan.localCapable || plan.tiers.length === 0) return null;
  const primaryTier = plan.tiers.find((t) => t.key === "fast") ?? plan.tiers[0];
  const secondaryTier = plan.tiers.find((t) => t.key === "coding") ?? null;
  const modelForTier = (tier: LocalTier) => ({
    modelId: tier.alias,
    endpoint: tierBaseUrl(tier),
    provider: "mlx" as const,
    contextLimit: tier.key === "coding"
      ? plan.preset.localCoderQuality.defaultContext
      : plan.preset.localAgentFast.defaultContext,
  });
  return {
    location: "local",
    primary: modelForTier(primaryTier),
    secondary: secondaryTier ? modelForTier(secondaryTier) : null,
    thinkingEnabled: false,
    minDecodeRate: 15,
    probeTimeoutMs: 60_000,
  };
}

export function resolvedLocalModelPreset(plan: ProvisionPlan): Record<string, unknown> {
  return {
    id: plan.presetId,
    mode: plan.mode,
    memoryTier: plan.presetId,
    localEnabled: plan.localCapable,
    roles: {
      frontier_primary: plan.preset.frontierPrimary,
      local_agent_fast: plan.preset.localAgentFast,
      local_coder_quality: plan.preset.localCoderQuality,
      local_embeddings: plan.preset.localEmbeddings,
    },
  };
}

function ensureQwenProfile(cfg: Record<string, unknown>, plan: ProvisionPlan): void {
  if (cfg.qwen && typeof cfg.qwen === "object") return;
  const profile = qwenProfileForProvisionPlan(plan);
  if (profile) cfg.qwen = profile;
}

type Logger = (line: string) => void;

function run(cmd: string, args: string[], onLog: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    onLog(`$ ${cmd} ${args.join(" ")}`);
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const onData = (b: Buffer) => b.toString().split("\n").filter((l) => l.trim()).forEach(onLog);
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("error", reject);
    p.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
  });
}

/** Install Rapid-MLX into a stable venv; return the binary path. */
async function ensureRapidBinary(onLog: Logger): Promise<string> {
  const existing = resolveRapidBinary();
  if (existing) { onLog(`rapid-mlx found at ${existing}`); return existing; }
  // Use a modern interpreter — the bundled 3.14 in the app, NOT the Mac's system
  // python3 (often 3.9), which has no rapid-mlx wheel.
  const py = provisioningPython();
  const ver = await pythonVersion(py);
  if (!pythonVersionOk(ver)) {
    throw new Error(`rapid-mlx needs Python 3.13+, but the provisioning interpreter is ${ver || "unknown"} (${py}). Install Python 3.13+ (e.g. \`brew install python@3.13\`) and set HIVE_PYTHON to it, or run from the bundled app, then retry.`);
  }
  const venv = join(homedir(), ".hivematrix", "rapidmlx", ".venv");
  const bin = join(venv, "bin", "rapid-mlx");
  onLog(`installing rapid-mlx with Python ${ver} (${py})…`);
  await run(py, ["-m", "venv", "--clear", venv], onLog); // --clear recreates a stale/wrong-version venv
  await run(join(venv, "bin", "pip"), ["install", "--upgrade", "pip", "rapid-mlx"], onLog);
  const localBin = join(homedir(), ".local", "bin");
  mkdirSync(localBin, { recursive: true });
  try { await run("ln", ["-sf", bin, join(localBin, "rapid-mlx")], onLog); } catch { /* best effort */ }
  return bin;
}

/** Perform provisioning: install engine, pull fitting models, write config. */
export async function provisionLocalEngine(opts: { onLog?: Logger; env?: Partial<HardwareProbe> } = {}): Promise<ProvisionPlan> {
  const onLog = opts.onLog ?? (() => {});
  const plan = planLocalEngine(opts.env);
  const cfg = readConfig();

  if (!plan.localCapable) {
    onLog(plan.reason ?? "This Mac can't run a local model — cloud-only.");
    cfg.localEngine = { engine: "rapid-mlx", binary: null, tiers: [] };
    cfg.localModelPreset = resolvedLocalModelPreset(plan);
    writeJsonAtomic(configPath(), cfg);
    onLog("Wrote cloud-only localEngine block.");
    return plan;
  }

  onLog(`Provisioning for ${Math.round(plan.ramGB)} GB ${plan.arch}: ${plan.recommendedTiers.join(" + ")} resident.`);
  const bin = await ensureRapidBinary(onLog);
  for (const t of plan.tiers) {
    onLog(`pulling ${t.alias}…`);
    await run(bin, ["pull", t.alias], onLog);
  }
  cfg.localEngine = { engine: "rapid-mlx", binary: bin, tiers: plan.tiers };
  cfg.localModelPreset = resolvedLocalModelPreset(plan);
  ensureQwenProfile(cfg, plan);
  writeJsonAtomic(configPath(), cfg);
  onLog("Wrote localEngine config. Restart the daemon to serve the configured tiers.");
  return plan;
}

// --- Background job tracker (one provision at a time) ----------------------

export type ProvisionPhase = "idle" | "running" | "done" | "error";
export interface ProvisionStatus {
  phase: ProvisionPhase;
  log: string[];
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  plan: ProvisionPlan | null;
}

const MAX_LOG = 200;
const _state: ProvisionStatus = { phase: "idle", log: [], startedAt: null, finishedAt: null, error: null, plan: null };

export function getProvisionStatus(): ProvisionStatus {
  return { ..._state, log: [..._state.log] };
}

/** Start a background provision (idempotent: no-op if already running). */
export function startProvision(now: () => string = () => new Date().toISOString()): ProvisionStatus {
  if (_state.phase === "running") return getProvisionStatus();
  _state.phase = "running";
  _state.log = [];
  _state.error = null;
  _state.finishedAt = null;
  _state.startedAt = now();
  _state.plan = planLocalEngine();
  const onLog = (line: string) => {
    _state.log.push(line);
    if (_state.log.length > MAX_LOG) _state.log.splice(0, _state.log.length - MAX_LOG);
  };
  provisionLocalEngine({ onLog })
    .then((plan) => { _state.plan = plan; _state.phase = "done"; })
    .catch((e) => { _state.error = e?.message ?? String(e); _state.phase = "error"; })
    .finally(() => { _state.finishedAt = now(); });
  return getProvisionStatus();
}
