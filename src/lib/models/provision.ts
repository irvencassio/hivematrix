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
  type LocalTier, type TierKey, type HardwareProbe, type LocalMemoryPresetId, type LocalPresetMode, type LocalMemoryPreset, type LocalRolePreset,
  type LocalTuning,
} from "./local-engine";
import { DEFAULT_KV_CACHE_DTYPE } from "./local-tuning";
import { optionFor, LOCAL_MODEL_CATALOG, type LocalSelection } from "./local-quant";
import { type QwenProfile, DEFAULT_SAMPLING } from "@/lib/config/qwen-profile";
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
  /** Operator context/KV-cache overrides (Settings §3.5) — already folded into
   * `tiers[].kvCacheDtype`; kept here too because `qwenProfileForProvisionPlan`
   * needs the contextLimit override, which isn't part of LocalTier. */
  tuning: LocalTuning;
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

function tierPort(key: TierKey): number {
  return (DEFAULT_TIERS.find((t) => t.key === key) ?? DEFAULT_TIERS[0]).port;
}

function presetRoleForTier(key: TierKey, preset: LocalMemoryPreset): LocalRolePreset {
  return key === "coding" ? preset.localCoderQuality : preset.localAgentFast;
}

function kvCacheDtypeForTier(key: TierKey, preset: LocalMemoryPreset, tuning: LocalTuning) {
  return tuning[key]?.kvCacheDtype ?? presetRoleForTier(key, preset).kvCacheDtype ?? DEFAULT_KV_CACHE_DTYPE;
}

/** Reasoning/thinking mode for a tier: operator override if set, else off
 * (the compiled DEFAULT_TIERS default — the biggest latency lever). Mirrors
 * kvCacheDtypeForTier so the provision plan matches getLocalEngineConfig's overlay. */
function reasoningForTier(key: TierKey, tuning: LocalTuning): boolean {
  return tuning[key]?.reasoning ?? false;
}

/** Resolve an operator selection into concrete LocalTier objects — one per
 * selected tier, at its chosen quant. `kvCacheDtype` comes from the operator's
 * tuning override if set, else the RAM-band preset's role for that tier (a
 * KV-dtype pick, orthogonal to the weight-quant pick made here). Skips a tier
 * whose (tier, quant) isn't in the catalog rather than guessing an alias. */
function tiersForSelection(selection: LocalSelection, preset: LocalMemoryPreset, tuning: LocalTuning): LocalTier[] {
  return (Object.keys(selection) as TierKey[])
    .map((key): LocalTier | null => {
      const quant = selection[key];
      if (!quant) return null;
      const opt = optionFor(key, quant);
      if (!opt) return null;
      return { key, alias: opt.alias, port: tierPort(key), reasoning: reasoningForTier(key, tuning), quant: opt.quant, kvCacheDtype: kvCacheDtypeForTier(key, preset, tuning) };
    })
    .filter((t): t is LocalTier => t !== null);
}

/** Auto pick: the RAM-band preset's quant/kvCacheDtype for each recommended
 * tier (2026-07-09 tuning spec §3.2), operator tuning overrides applied — NOT
 * the hardcoded 4-bit DEFAULT_TIERS, which would silently ignore what the
 * preset recommends (e.g. 8-bit at 128GB). A role that's disabled or has no
 * quant (DISABLED_ROLE) is skipped. */
function tiersForPreset(recommendedTiers: TierKey[], preset: LocalMemoryPreset, tuning: LocalTuning): LocalTier[] {
  return recommendedTiers
    .map((key): LocalTier | null => {
      const role = presetRoleForTier(key, preset);
      if (!role.enabled || !role.quant) return null;
      const opt = optionFor(key, role.quant);
      if (!opt) return null;
      return { key, alias: opt.alias, port: tierPort(key), reasoning: reasoningForTier(key, tuning), quant: opt.quant, kvCacheDtype: kvCacheDtypeForTier(key, preset, tuning) };
    })
    .filter((t): t is LocalTier => t !== null);
}

/**
 * Pure: what this Mac should run, as resolved LocalTier objects.
 *
 * `selection === null` (the default) auto-picks the RAM-band preset's
 * quant/context/KV-dtype for each recommended tier (`cap.recommendedTiers`) —
 * see `LOCAL_MEMORY_PRESETS`. An explicit `selection` is the operator's
 * HuggingFace-style model/quant picks (§ local-engine-toggle-model-picker spec)
 * and overrides the auto pick's quant entirely — including dropping a tier the
 * operator didn't select, even if it would otherwise be recommended. `tuning`
 * is the operator's context/KV-cache overrides (Settings §3.5); applies on top
 * of either pick and is independent of it.
 */
export function planLocalEngine(
  env: Partial<HardwareProbe> = {},
  selection: LocalSelection | null = null,
  tuning: LocalTuning = {},
): ProvisionPlan {
  const cap = localEngineCapability(env);
  const preset = selectLocalMemoryPreset({ ramGB: cap.ramGB });
  const tiers = selection
    ? tiersForSelection(selection, preset, tuning)
    : tiersForPreset(cap.recommendedTiers, preset, tuning);
  return {
    arch: cap.arch, ramGB: cap.ramGB, presetId: cap.presetId, mode: cap.mode,
    localCapable: cap.localCapable,
    recommendedTiers: cap.recommendedTiers,
    tiers, preset, tuning, reason: cap.reason,
  };
}

export function qwenProfileForProvisionPlan(plan: ProvisionPlan): QwenProfile | null {
  if (!plan.localCapable || plan.tiers.length === 0) return null;
  const primaryTier = plan.tiers.find((t) => t.key === "fast") ?? plan.tiers[0];
  const secondaryTier = plan.tiers.find((t) => t.key === "coding") ?? null;
  const modelForTier = (tier: LocalTier) => {
    const presetDefault = tier.key === "coding"
      ? plan.preset.localCoderQuality.defaultContext
      : plan.preset.localAgentFast.defaultContext;
    const contextLimit = plan.tuning[tier.key]?.contextLimit ?? presetDefault;
    return {
      modelId: tier.alias,
      endpoint: tierBaseUrl(tier),
      provider: "mlx" as const,
      contextLimit,
      // Output cap, not the window — leave headroom for prompt + reasoning tokens.
      maxOutputTokens: Math.min(16384, contextLimit),
    };
  };
  return {
    location: "local",
    primary: modelForTier(primaryTier),
    secondary: secondaryTier ? modelForTier(secondaryTier) : null,
    thinkingEnabled: false,
    minDecodeRate: 15,
    probeTimeoutMs: 60_000,
    sampling: DEFAULT_SAMPLING,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeEndpoint(endpoint: unknown): string {
  return typeof endpoint === "string" ? endpoint.trim().replace(/\/+$/, "") : "";
}

function knownTierEndpoints(): Set<string> {
  return new Set(DEFAULT_TIERS.map((tier) => normalizeEndpoint(tierBaseUrl(tier))));
}

/** Every alias this provisioner could ever write into `qwen.primary` — the full
 * catalog (all tiers × all quants), not just the 4-bit defaults. Used to decide
 * whether a stored `qwen` profile is HiveMatrix-managed (safe to overwrite on
 * the next provision/quant-switch) or operator-authored (leave it alone).
 * Getting this wrong in the 4-bit-only direction means a quant switch to 6/8-bit
 * silently stops updating `qwen.primary`: the UI would claim the new quant while
 * the supervisor keeps serving the old one. */
function knownTierAliases(): Set<string> {
  return new Set(LOCAL_MODEL_CATALOG.map((opt) => opt.alias));
}

function isManagedRapidTierRef(modelId: unknown, endpoint: unknown): boolean {
  const model = typeof modelId === "string" ? modelId : "";
  const url = normalizeEndpoint(endpoint);
  return knownTierAliases().has(model) || knownTierEndpoints().has(url);
}

function qwenPrimary(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw) || !isRecord(raw.primary)) return null;
  return raw.primary;
}

function isManagedTierQwenProfile(raw: unknown): boolean {
  const primary = qwenPrimary(raw);
  return !!primary && isManagedRapidTierRef(primary.modelId, primary.endpoint);
}

function isManagedTierLocalModel(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return isManagedRapidTierRef(raw.modelName, raw.endpoint);
}

function localModelForQwenLike(raw: unknown): Record<string, unknown> | null {
  const primary = qwenPrimary(raw);
  if (!primary) return null;
  const modelName = typeof primary.modelId === "string" ? primary.modelId : "";
  const endpoint = typeof primary.endpoint === "string" ? primary.endpoint : "";
  const provider = typeof primary.provider === "string" ? primary.provider : "mlx";
  if (!modelName || !endpoint) return null;
  return { provider, endpoint, modelName };
}

export function syncLocalModelProfilesForProvisionPlan(cfg: Record<string, unknown>, plan: ProvisionPlan): void {
  const profile = qwenProfileForProvisionPlan(plan);
  if (!profile) return;

  const shouldUseProvisionedProfile = !isRecord(cfg.qwen) || isManagedTierQwenProfile(cfg.qwen);
  if (shouldUseProvisionedProfile) cfg.qwen = profile;

  const desiredLocalModel = localModelForQwenLike(cfg.qwen);
  if (!desiredLocalModel) return;
  if (!isRecord(cfg.localModel) || isManagedTierLocalModel(cfg.localModel)) {
    cfg.localModel = desiredLocalModel;
  }
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

/**
 * Repos already on disk, per `rapid-mlx ls`. Substring-matched against the
 * catalog's known repo ids rather than parsed as a formatted table — robust to
 * column-alignment changes, and `rapid-mlx info` reports no size/cached-state at
 * all, so `ls` is the only source. Best-effort: returns empty on any failure
 * (missing binary, engine crash, unexpected output) rather than throwing —
 * this only affects a "downloaded" badge in the UI, never correctness of pull.
 */
export async function listCachedModelRepos(bin: string): Promise<Set<string>> {
  try {
    const { stdout } = await execFileP(bin, ["ls"], { timeout: 15_000 });
    const cached = new Set<string>();
    for (const opt of LOCAL_MODEL_CATALOG) {
      if (stdout.includes(opt.repo)) cached.add(opt.repo);
    }
    return cached;
  } catch {
    return new Set();
  }
}

/** Perform provisioning: install engine, pull fitting models, write config. */
export async function provisionLocalEngine(
  opts: { onLog?: Logger; env?: Partial<HardwareProbe>; selection?: LocalSelection | null; tuning?: LocalTuning } = {},
): Promise<ProvisionPlan> {
  const onLog = opts.onLog ?? (() => {});
  const plan = planLocalEngine(opts.env, opts.selection ?? null, opts.tuning ?? {});
  const cfg = readConfig();
  // Preserve `enabled`/`selection` — this function only owns `engine`/`binary`/
  // `tiers`; overwriting the whole block would silently wipe the operator's
  // toggle state and picks on the very next provision run.
  const existingLocalEngine = (cfg.localEngine && typeof cfg.localEngine === "object")
    ? cfg.localEngine as Record<string, unknown>
    : {};

  if (!plan.localCapable) {
    onLog(plan.reason ?? "This Mac can't run a local model — cloud-only.");
    cfg.localEngine = { ...existingLocalEngine, engine: "rapid-mlx", binary: null, tiers: [] };
    cfg.localModelPreset = resolvedLocalModelPreset(plan);
    writeJsonAtomic(configPath(), cfg);
    onLog("Wrote cloud-only localEngine block.");
    return plan;
  }

  const tierSummary = plan.tiers.length
    ? plan.tiers.map((t) => t.quant ? `${t.key}@${t.quant}` : t.key).join(" + ")
    : "nothing";
  onLog(`Provisioning for ${Math.round(plan.ramGB)} GB ${plan.arch}: ${tierSummary} resident.`);
  const bin = await ensureRapidBinary(onLog);
  for (const t of plan.tiers) {
    onLog(`pulling ${t.alias}…`);
    await run(bin, ["pull", t.alias], onLog);
  }
  cfg.localEngine = { ...existingLocalEngine, engine: "rapid-mlx", binary: bin, tiers: plan.tiers };
  cfg.localModelPreset = resolvedLocalModelPreset(plan);
  syncLocalModelProfilesForProvisionPlan(cfg, plan);
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

/**
 * Start a background provision (idempotent: no-op if already running).
 * `selection` omitted/null ⇒ auto pick (today's behavior); an explicit
 * selection is the operator's model/quant picks and is also what
 * `POST /local-engine/provision` should pass once it's read the persisted
 * selection (server layer's job — this function stays pure/injectable).
 * `tuning` is the operator's persisted context/KV-cache overrides, likewise
 * the server layer's job to read and pass.
 */
export function startProvision(
  selection: LocalSelection | null = null,
  now: () => string = () => new Date().toISOString(),
  tuning: LocalTuning = {},
): ProvisionStatus {
  if (_state.phase === "running") return getProvisionStatus();
  _state.phase = "running";
  _state.log = [];
  _state.error = null;
  _state.finishedAt = null;
  _state.startedAt = now();
  _state.plan = planLocalEngine(undefined, selection, tuning);
  const onLog = (line: string) => {
    _state.log.push(line);
    if (_state.log.length > MAX_LOG) _state.log.splice(0, _state.log.length - MAX_LOG);
  };
  provisionLocalEngine({ onLog, selection, tuning })
    .then((plan) => { _state.plan = plan; _state.phase = "done"; })
    .catch((e) => { _state.error = e?.message ?? String(e); _state.phase = "error"; })
    .finally(() => { _state.finishedAt = now(); });
  return getProvisionStatus();
}
