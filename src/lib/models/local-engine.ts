/**
 * Local model serving via Rapid-MLX (the chosen on-device engine; see the brain
 * doc 2026-06-20-local-model-architecture-rapidmlx). Two resident tiers:
 *   • "fast"   — Qwen3.6-35B-A3B (MoE, ~128 tok/s): daily / agentic / voice / ops
 *   • "coding" — Qwen3.6-27B-dense (77.2 SWE-bench): hard coding / reasoning
 * Reasoning is OFF by default at the ENGINE level (--no-thinking), which is the
 * single biggest latency lever (proven: 35B-A3B 15.5s → 0.76s tool turn).
 *
 * Rapid-MLX serves ONE model per process, so each tier runs its own `rapid-mlx
 * serve` on its own port; HiveMatrix's role router points a role at a tier. The
 * engine is OpenAI-compatible, so LM Studio / Ollama remain drop-in alternates.
 */

import { spawn, type ChildProcess } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir, arch as osArch, totalmem } from "os";

export type LocalEngineKind = "rapid-mlx" | "lmstudio" | "ollama";
export type TierKey = "fast" | "coding";
export type RoleKey = "thinking" | "coding" | "operational";

export interface LocalTier {
  key: TierKey;
  alias: string; // rapid-mlx model alias (or HF path)
  port: number;
  reasoning: boolean; // false → serve with --no-thinking
}

export interface LocalEngineConfig {
  engine: LocalEngineKind;
  binary: string | null; // path to the rapid-mlx executable (null → resolve at runtime)
  tiers: LocalTier[];
}

export const DEFAULT_TIERS: LocalTier[] = [
  { key: "fast", alias: "qwen3.6-35b-4bit", port: 8000, reasoning: false },
  { key: "coding", alias: "qwen3.6-27b-4bit", port: 8001, reasoning: false },
];

export const SUPPORTED_LOCAL_TIER_PRESETS: LocalTier[] = DEFAULT_TIERS;

/** Roles → tier. Operational/voice want speed; coding wants the dense model;
 * thinking stays on the dense local model when offline (cloud handles it when up). */
export const ROLE_TO_TIER: Record<RoleKey, TierKey> = {
  operational: "fast",
  coding: "coding",
  thinking: "coding",
};

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
  } catch {
    return {};
  }
}

function coerceEngine(v: unknown): LocalEngineKind {
  return v === "lmstudio" || v === "ollama" ? v : "rapid-mlx";
}

function parseTier(raw: unknown, fallback: LocalTier): LocalTier {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const key: TierKey = r.key === "coding" ? "coding" : "fast";
  return {
    key,
    alias: typeof r.alias === "string" && r.alias ? r.alias : fallback.alias,
    port: typeof r.port === "number" && r.port > 0 ? r.port : fallback.port,
    reasoning: r.reasoning === true, // default false (reasoning off)
  };
}

/** The local-engine config (config.json `localEngine`), merged over defaults. */
export function getLocalEngineConfig(config: Record<string, unknown> = readConfig()): LocalEngineConfig {
  const le = (config.localEngine ?? {}) as Record<string, unknown>;
  const rawTiers = Array.isArray(le.tiers) ? le.tiers : [];
  const defaultsByKey = new Map(DEFAULT_TIERS.map((tier) => [tier.key, tier]));
  const tiers: LocalTier[] = rawTiers.length > 0
    ? rawTiers.map((raw) => {
        const key = (raw as Record<string, unknown> | null)?.key === "coding" ? "coding" : "fast";
        return parseTier(raw, defaultsByKey.get(key) ?? DEFAULT_TIERS[0]);
      })
    : DEFAULT_TIERS;
  return {
    engine: coerceEngine(le.engine),
    binary: typeof le.binary === "string" && le.binary ? le.binary : null,
    tiers,
  };
}

/** Pure: the `rapid-mlx serve …` argv for a tier (reasoning off → --no-thinking). */
export function buildServeArgs(tier: LocalTier): string[] {
  const args = ["serve", tier.alias, "--host", "127.0.0.1", "--port", String(tier.port)];
  if (!tier.reasoning) args.push("--no-thinking");
  return args;
}

/** OpenAI base URL for a tier's local port. */
export function tierBaseUrl(tier: LocalTier): string {
  return `http://127.0.0.1:${tier.port}/v1`;
}

/** The tier whose alias equals this model id, or null (used to route a chosen
 * local model to the right Rapid-MLX port). */
export function tierForAlias(alias: string, cfg: LocalEngineConfig = getLocalEngineConfig()): LocalTier | null {
  return cfg.tiers.find((t) => t.alias === alias)
    ?? SUPPORTED_LOCAL_TIER_PRESETS.find((t) => t.alias === alias)
    ?? null;
}

/** Resolve a role to its tier's endpoint + model, or null if unmapped. */
export function localTargetForRole(
  role: RoleKey,
  cfg: LocalEngineConfig = getLocalEngineConfig(),
): { endpoint: string; model: string; tier: TierKey } | null {
  const tierKey = ROLE_TO_TIER[role];
  const tier = cfg.tiers.find((t) => t.key === tierKey) ?? cfg.tiers.find((t) => t.key === "fast");
  if (!tier) return null;
  return { endpoint: tierBaseUrl(tier), model: tier.alias, tier: tier.key };
}

/** Locate the rapid-mlx executable: config → env → PATH-ish known locations. */
export function resolveRapidBinary(cfg: LocalEngineConfig = getLocalEngineConfig()): string | null {
  const candidates = [
    cfg.binary,
    process.env.HIVE_RAPID_MLX,
    join(homedir(), "hivematrix", ".rapidmlx-eval", ".venv", "bin", "rapid-mlx"),
    join(homedir(), ".local", "bin", "rapid-mlx"),
    "/opt/homebrew/bin/rapid-mlx",
  ].filter((p): p is string => !!p);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

// --- Process management: keep each tier's `rapid-mlx serve` alive on its port.
// Modeled on realtime-session.ts. Lazy: callers ensure a tier before routing to
// it. If the binary can't be found we assume the model is served externally
// (e.g. a manually-launched serve) and just rely on the health check. ---

const _procs = new Map<number, ChildProcess>();

async function isHealthy(port: number, timeoutMs = 2500): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Ensure a tier is serving on its port. Returns true if healthy (already up,
 * external, or freshly spawned). Best-effort: never throws. */
export async function ensureTier(tier: LocalTier, cfg: LocalEngineConfig = getLocalEngineConfig()): Promise<boolean> {
  if (await isHealthy(tier.port)) return true;
  const existing = _procs.get(tier.port);
  if (existing && existing.exitCode === null && !existing.killed) {
    // spawned but not ready yet — wait below
  } else {
    const bin = resolveRapidBinary(cfg);
    if (!bin) return false; // not manageable here; assume served externally
    try {
      const proc = spawn(bin, buildServeArgs(tier), { stdio: "ignore" });
      proc.on("exit", () => { if (_procs.get(tier.port) === proc) _procs.delete(tier.port); });
      proc.on("error", () => { if (_procs.get(tier.port) === proc) _procs.delete(tier.port); });
      _procs.set(tier.port, proc);
    } catch {
      return false;
    }
  }
  for (let i = 0; i < 60; i++) { // up to ~2 min for cold model load
    if (await isHealthy(tier.port)) return true;
    await sleep(2000);
  }
  return false;
}

/** Ensure every configured tier is serving (used at daemon start, best-effort). */
export async function ensureLocalEngine(cfg: LocalEngineConfig = getLocalEngineConfig()): Promise<void> {
  if (cfg.engine !== "rapid-mlx") return;
  await Promise.allSettled(cfg.tiers.map((t) => ensureTier(t, cfg)));
}

/** Stop daemon-managed tier processes (externally-launched serves are left alone). */
export function stopLocalEngine(): void {
  for (const proc of _procs.values()) { try { proc.kill(); } catch { /* ignore */ } }
  _procs.clear();
}

export interface TierStatus { key: TierKey; alias: string; port: number; healthy: boolean; reasoning: boolean; optional?: boolean; }
export interface LocalEngineStatus {
  engine: LocalEngineKind;
  /** True when at least the primary (fast) tier is reachable — i.e. local is usable. */
  up: boolean;
  tiers: TierStatus[];
}

// --- Hardware-aware tier capability ---------------------------------------
// Which local tiers THIS Mac can run, and which can stay resident together.
// Mirrors config/features.ts `featureCapability` (arm64 + RAM gate) but extended
// for the two resident tiers, so the installer/UI can size the engine to the
// machine and grey out what won't fit. Pure (env injectable) for tests.

export interface HardwareProbe { arch: string; ramGB: number }

export function probeHardware(): HardwareProbe {
  return { arch: osArch(), ramGB: totalmem() / 1e9 };
}

/** Resident 4-bit footprint per tier (weights + KV/overhead), GB. From the
 * locked local-model architecture doc (M5 Max measurements): 35B-A3B ~20, 27B
 * dense ~15. */
export const TIER_FOOTPRINT_GB: Record<TierKey, number> = { fast: 20, coding: 15 };
/** RAM that must stay free for macOS + the daemon + the voice sidecar. */
const HEADROOM_GB = 14;

export interface TierCapability {
  key: TierKey;
  /** Can this Mac run the tier at all (even as the only / on-demand model)? */
  capable: boolean;
  /** Can it stay resident alongside the other recommended tier(s)? */
  residentCapable: boolean;
  reason?: string;
}

export interface LocalEngineCapability {
  arch: string;
  ramGB: number;
  presetId: LocalMemoryPresetId;
  mode: LocalPresetMode;
  /** arm64 + enough RAM for at least one tier. False → run cloud-only. */
  localCapable: boolean;
  tiers: TierCapability[];
  /** Tier keys recommended to serve resident by default on this hardware. */
  recommendedTiers: TierKey[];
  /** Set when localCapable is false (why local is unavailable). */
  reason?: string;
}

const RESIDENT_TIER_KEYS: TierKey[] = ["fast", "coding"];

export type LocalMemoryTier = "less_than_32gb" | "32gb" | "48gb" | "64gb" | "128gb";
export type LocalMemoryPresetId = LocalMemoryTier;
export type LocalPresetMode =
  | "frontier_only"
  | "local_agent_light"
  | "local_agent_standard"
  | "dual_local_compact"
  | "dual_local_quality";

export interface LocalRolePreset {
  enabled: boolean;
  model: string;
  quant: string;
  defaultContext: number;
  maxRecommendedContext: number;
  role: string;
}

export interface EmbeddingPreset {
  enabled: boolean;
  model: string;
  role: string;
}

export interface LocalMemoryPreset {
  id: LocalMemoryPresetId;
  minGB: number;
  mode: LocalPresetMode;
  localEnabled: boolean;
  recommendedTiers: TierKey[];
  localAgentFast: LocalRolePreset;
  localCoderQuality: LocalRolePreset;
  localEmbeddings: EmbeddingPreset;
  frontierPrimary: { enabled: boolean; role: string };
  rationale: string;
}

const DISABLED_ROLE: LocalRolePreset = {
  enabled: false,
  model: "",
  quant: "",
  defaultContext: 0,
  maxRecommendedContext: 0,
  role: "disabled",
};

export const LOCAL_MEMORY_PRESETS: LocalMemoryPreset[] = [
  {
    id: "less_than_32gb",
    minGB: 0,
    mode: "frontier_only",
    localEnabled: false,
    recommendedTiers: [],
    localAgentFast: DISABLED_ROLE,
    localCoderQuality: DISABLED_ROLE,
    localEmbeddings: { enabled: false, model: "", role: "disabled by default" },
    frontierPrimary: { enabled: true, role: "remote frontier model" },
    rationale: "below 32GB, local large-model operation is not realistic enough for HiveMatrix defaults",
  },
  {
    id: "32gb",
    minGB: 32,
    mode: "local_agent_light",
    localEnabled: true,
    recommendedTiers: ["fast"],
    localAgentFast: { enabled: true, model: "qwen3.6-35b-a3b", quant: "UD-Q4_K_M or IQ4_XS", defaultContext: 8192, maxRecommendedContext: 16384, role: "fast local agent/planner" },
    localCoderQuality: DISABLED_ROLE,
    localEmbeddings: { enabled: true, model: "bge-small or nomic-embed-text", role: "small local retrieval embedding model" },
    frontierPrimary: { enabled: true, role: "fallback when local is unavailable or insufficient" },
    rationale: "32GB can run Qwen3.6-35B-A3B at Q4 with a small embedding model, but should not keep Qwen3.6-27B hot",
  },
  {
    id: "48gb",
    minGB: 48,
    mode: "local_agent_standard",
    localEnabled: true,
    recommendedTiers: ["fast"],
    localAgentFast: { enabled: true, model: "qwen3.6-35b-a3b", quant: "Q5_K_M or Q6_K if available, otherwise UD-Q4_K_M", defaultContext: 16384, maxRecommendedContext: 32768, role: "primary local agent/planner" },
    localCoderQuality: DISABLED_ROLE,
    localEmbeddings: { enabled: true, model: "bge-small or nomic-embed-text", role: "small local retrieval embedding model" },
    frontierPrimary: { enabled: true, role: "fallback when local is unavailable or insufficient" },
    rationale: "48GB should optimize for a strong single local agent model rather than splitting memory across two large models",
  },
  {
    id: "64gb",
    minGB: 64,
    mode: "dual_local_compact",
    localEnabled: true,
    recommendedTiers: ["fast", "coding"],
    localAgentFast: { enabled: true, model: "qwen3.6-35b-a3b", quant: "UD-Q4_K_M or Q5_K_M", defaultContext: 16384, maxRecommendedContext: 32768, role: "fast planner, triage, subagent, summarizer" },
    localCoderQuality: { enabled: true, model: "qwen3.6-27b", quant: "Q5_K_M or Q6_K", defaultContext: 16384, maxRecommendedContext: 32768, role: "coding quality model" },
    localEmbeddings: { enabled: true, model: "bge-small or nomic-embed-text", role: "small local retrieval embedding model" },
    frontierPrimary: { enabled: true, role: "fallback when local is unavailable or insufficient" },
    rationale: "64GB can run both Qwen models if context is capped and the system accepts some memory pressure",
  },
  {
    id: "128gb",
    minGB: 128,
    mode: "dual_local_quality",
    localEnabled: true,
    recommendedTiers: ["fast", "coding"],
    localAgentFast: { enabled: true, model: "qwen3.6-35b-a3b", quant: "Q6_K or Q8_0, prefer Q6_K when both models are hot", defaultContext: 32768, maxRecommendedContext: 65536, role: "fast local agent/planner" },
    localCoderQuality: { enabled: true, model: "qwen3.6-27b", quant: "Q8_0 or UD-Q8_K_XL", defaultContext: 32768, maxRecommendedContext: 65536, role: "primary local coding model" },
    localEmbeddings: { enabled: true, model: "bge-small, nomic-embed-text, or mxbai-embed-large", role: "small local retrieval embedding model" },
    frontierPrimary: { enabled: true, role: "fallback when local is unavailable or insufficient" },
    rationale: "128GB is the first tier where both models can be kept usable at the same time while preserving high coding quality",
  },
];

export function memoryTierForGB(ramGB: number): LocalMemoryTier {
  if (!Number.isFinite(ramGB) || ramGB < 32) return "less_than_32gb";
  if (ramGB >= 128) return "128gb";
  if (ramGB >= 64) return "64gb";
  if (ramGB >= 48) return "48gb";
  return "32gb";
}

export function selectLocalMemoryPreset(env: Partial<HardwareProbe> = {}): LocalMemoryPreset {
  const ramGB = env.ramGB ?? totalmem() / 1e9;
  const tier = memoryTierForGB(ramGB);
  return LOCAL_MEMORY_PRESETS.find((preset) => preset.id === tier) ?? LOCAL_MEMORY_PRESETS[0];
}

/** Compute which tiers this Mac can run + the recommended resident profile. */
export function localEngineCapability(env: Partial<HardwareProbe> = {}): LocalEngineCapability {
  const arch = env.arch ?? osArch();
  const ramGB = env.ramGB ?? totalmem() / 1e9;
  const gb = Math.round(ramGB);
  const isArm = arch === "arm64";
  const preset = selectLocalMemoryPreset({ ramGB });

  const tiers: TierCapability[] = RESIDENT_TIER_KEYS.map((key) => {
    if (!isArm) return { key, capable: false, residentCapable: false, reason: "Requires an Apple Silicon Mac" };
    if (!preset.recommendedTiers.includes(key)) {
      const role = key === "coding" ? preset.localCoderQuality : preset.localAgentFast;
      return { key, capable: role.enabled, residentCapable: false, reason: role.enabled ? "Available on demand, but not enabled by default for this memory tier" : "Disabled by default for this memory tier" };
    }
    return { key, capable: true, residentCapable: true };
  });

  const recommendedTiers = isArm ? preset.recommendedTiers : [];
  const localCapable = isArm && preset.localEnabled && recommendedTiers.length > 0;
  const reason = localCapable ? undefined
    : isArm ? `Detected ${gb} GB RAM; local model disabled by ${preset.mode} — running cloud-only`
            : "Requires an Apple Silicon Mac — running cloud-only";

  return { arch, ramGB, presetId: preset.id, mode: preset.mode, localCapable, tiers, recommendedTiers, reason };
}

/** Live health of the local engine + each tier (probes each tier's port). Used
 * for the "Rapid-MLX up?" status in the console. Never throws. */
export async function localEngineStatus(cfg: LocalEngineConfig = getLocalEngineConfig()): Promise<LocalEngineStatus> {
  const configuredAliases = new Set(cfg.tiers.map((t) => t.alias));
  const statusTiers = cfg.engine === "rapid-mlx"
    ? [
        ...cfg.tiers.map((t) => ({ tier: t, optional: false })),
        ...SUPPORTED_LOCAL_TIER_PRESETS
          .filter((t) => !configuredAliases.has(t.alias))
          .map((t) => ({ tier: t, optional: true })),
      ]
    : cfg.tiers.map((t) => ({ tier: t, optional: false }));
  const tiers = await Promise.all(
    statusTiers.map(async ({ tier: t, optional }): Promise<TierStatus> => ({
      key: t.key, alias: t.alias, port: t.port, healthy: await isHealthy(t.port), reasoning: t.reasoning, optional,
    })),
  );
  const fast = tiers.find((t) => t.key === "fast");
  return { engine: cfg.engine, up: fast ? fast.healthy : tiers.some((t) => t.healthy), tiers };
}
