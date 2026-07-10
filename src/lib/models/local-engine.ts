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
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir, arch as osArch, totalmem } from "os";
import { findBinary } from "@/lib/config/binary-detection";
import { writeJsonAtomic } from "@/lib/config/atomic-write";
import { quantForAlias, LOCAL_MODEL_CATALOG, type LocalQuant, type LocalModelOption, type LocalSelection } from "./local-quant";
import { DEFAULT_KV_CACHE_DTYPE, KV_CACHE_DTYPES, type KvCacheDtype } from "./local-tuning";

export type LocalEngineKind = "rapid-mlx" | "lmstudio" | "ollama";
export type TierKey = "fast" | "coding";
export type RoleKey = "thinking" | "coding" | "operational";

export interface LocalTier {
  key: TierKey;
  alias: string; // rapid-mlx model alias (or HF path)
  port: number;
  reasoning: boolean; // false → serve with --no-thinking
  /** Display hint only — the alias is the serving source of truth. */
  quant?: LocalQuant | null;
  /** --kv-cache-dtype. Rapid-MLX's own default is int4 (R15 #300); we pass it
   * explicitly so a tier's choice survives a Rapid-MLX version that changes its
   * default. NOTE: `--reasoning` (set when `reasoning: true`) pins int8
   * server-side regardless of this value — see buildServeArgs. */
  kvCacheDtype?: KvCacheDtype;
  /** --cache-memory-percent. Omitted → Rapid-MLX's own default (0.20). */
  cacheMemoryPercent?: number;
}

export interface LocalEngineConfig {
  engine: LocalEngineKind;
  binary: string | null; // path to the rapid-mlx executable (null → resolve at runtime)
  tiers: LocalTier[];
}

export const DEFAULT_TIERS: LocalTier[] = [
  { key: "fast", alias: "qwen3.6-35b-4bit", port: 8000, reasoning: false, quant: "4bit", kvCacheDtype: DEFAULT_KV_CACHE_DTYPE },
  { key: "coding", alias: "qwen3.6-27b-4bit", port: 8001, reasoning: false, quant: "4bit", kvCacheDtype: DEFAULT_KV_CACHE_DTYPE },
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
  const alias = typeof r.alias === "string" && r.alias ? r.alias : fallback.alias;
  const quant = typeof r.quant === "string" ? (r.quant as LocalQuant) : quantForAlias(alias);
  const kvCacheDtype = typeof r.kvCacheDtype === "string" && (KV_CACHE_DTYPES as string[]).includes(r.kvCacheDtype)
    ? (r.kvCacheDtype as KvCacheDtype)
    : fallback.kvCacheDtype ?? DEFAULT_KV_CACHE_DTYPE;
  const cacheMemoryPercent = typeof r.cacheMemoryPercent === "number" && r.cacheMemoryPercent > 0 && r.cacheMemoryPercent <= 1
    ? r.cacheMemoryPercent
    : fallback.cacheMemoryPercent;
  return {
    key,
    alias,
    port: typeof r.port === "number" && r.port > 0 ? r.port : fallback.port,
    reasoning: r.reasoning === true, // default false (reasoning off)
    quant,
    kvCacheDtype,
    cacheMemoryPercent,
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
  // Overlay the operator's per-tier reasoning override (localEngine.tuning) onto
  // the tier's compiled default, so every serve/route/status reader (ensureTier,
  // tierForAlias, localEngineStatus) honors the thinking-mode toggle with no
  // change of their own. Map to fresh objects only when overriding, so
  // DEFAULT_TIERS is never mutated.
  const tuning = parseTuning((le as LocalEngineTuningBlock).tuning);
  const tiersWithReasoning = tiers.map((t) => {
    const override = tuning[t.key]?.reasoning;
    return typeof override === "boolean" && override !== t.reasoning ? { ...t, reasoning: override } : t;
  });
  return {
    engine: coerceEngine(le.engine),
    binary: typeof le.binary === "string" && le.binary ? le.binary : null,
    tiers: tiersWithReasoning,
  };
}

interface LocalEngineEnablement { enabled?: boolean }

function readLocalEngineBlock(config: Record<string, unknown>): LocalEngineEnablement {
  const raw = config.localEngine;
  return raw && typeof raw === "object" ? (raw as LocalEngineEnablement) : {};
}

function configFilePath(): string {
  return join(homedir(), ".hivematrix", "config.json");
}

/**
 * Default when the key is absent: enabled iff the engine binary resolves AND
 * this Mac is capable — mirrors frontier providers' "detected ⇒ enabled"
 * first-run rule (config/frontier-providers.ts `isProviderEnabled`), so an
 * already-working local engine doesn't go dark on upgrade. Once the operator
 * has explicitly toggled, the stored value wins regardless of detection.
 *
 * `detect` is injectable for tests; defaults to the real binary + capability probe.
 */
export function isLocalEngineEnabled(
  config: Record<string, unknown> = readConfig(),
  detect: () => boolean = () =>
    resolveRapidBinary(getLocalEngineConfig(config)) !== null && localEngineCapability().localCapable,
): boolean {
  const entry = readLocalEngineBlock(config);
  if (typeof entry.enabled === "boolean") return entry.enabled;
  return detect();
}

/** Atomic merge write — copies the frontier-providers.ts setProviderEnabled pattern. */
export function setLocalEngineEnabled(enabled: boolean): void {
  const config = readConfig();
  const existing = readLocalEngineBlock(config);
  config.localEngine = { ...existing, enabled };
  writeJsonAtomic(configFilePath(), config);
}

interface LocalEngineSelectionBlock { selection?: unknown }

function parseSelection(raw: unknown): LocalSelection {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: LocalSelection = {};
  for (const key of ["fast", "coding"] as TierKey[]) {
    const v = r[key];
    if (typeof v === "string" && LOCAL_MODEL_CATALOG.some((opt) => opt.tier === key && opt.quant === v)) {
      out[key] = v as LocalQuant;
    }
  }
  return out;
}

/** The operator's persisted model/quant picks (config.json `localEngine.selection`) —
 * distinct from `tiers`, which is what's actually installed/serving as of the
 * last provision. Absent key ⇒ {} (no explicit selection yet). */
export function getLocalEngineSelection(config: Record<string, unknown> = readConfig()): LocalSelection {
  const entry = readLocalEngineBlock(config) as LocalEngineSelectionBlock;
  return parseSelection(entry.selection);
}

/**
 * Merges a per-tier patch over the persisted selection — a tier key omitted
 * from `patch` leaves that tier's current pick untouched; a tier key set to
 * `null` deselects it (removed from the stored object, not stored as null); a
 * tier key set to a quant updates/adds it. Full-replace would let editing one
 * tier's radio silently drop the other tier's pick.
 */
export function setLocalEngineSelection(patch: LocalSelection): void {
  const config = readConfig();
  const existing = readLocalEngineBlock(config) as LocalEngineSelectionBlock;
  const merged: LocalSelection = parseSelection(existing.selection);
  for (const key of Object.keys(patch) as TierKey[]) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v === null) delete merged[key];
    else merged[key] = v;
  }
  config.localEngine = { ...existing, selection: merged };
  writeJsonAtomic(configFilePath(), config);
}

// --- Operator context/KV-cache overrides (Settings §3.5, 2026-07-09 tuning spec) ---
// Distinct from `selection` (which weight quant to install): a tier's context
// budget and KV dtype are RAM-band decisions the operator can override per tier,
// independent of the weight quant. Absent ⇒ the preset role's default applies.

export interface TierTuning {
  /** Client-enforced prompt+history budget — see context-governor.ts. */
  contextLimit?: number;
  kvCacheDtype?: KvCacheDtype;
  /** Operator override for the tier's reasoning/thinking mode. Absent ⇒ the
   * tier's compiled default (DEFAULT_TIERS, currently false → `--no-thinking`).
   * When set it is overlaid onto the tier in getLocalEngineConfig, so the
   * launcher, router, and status all serve with `--reasoning` vs `--no-thinking`
   * to match. Latency lever: true re-enables `<think>` (slower turns). */
  reasoning?: boolean;
}
export type LocalTuning = Partial<Record<TierKey, TierTuning>>;

interface LocalEngineTuningBlock { tuning?: unknown }

function parseTierTuning(raw: unknown): TierTuning | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: TierTuning = {};
  if (typeof r.contextLimit === "number" && r.contextLimit > 0) out.contextLimit = r.contextLimit;
  if (typeof r.kvCacheDtype === "string" && (KV_CACHE_DTYPES as string[]).includes(r.kvCacheDtype)) {
    out.kvCacheDtype = r.kvCacheDtype as KvCacheDtype;
  }
  if (typeof r.reasoning === "boolean") out.reasoning = r.reasoning;
  return Object.keys(out).length ? out : undefined;
}

function parseTuning(raw: unknown): LocalTuning {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: LocalTuning = {};
  for (const key of ["fast", "coding"] as TierKey[]) {
    const t = parseTierTuning(r[key]);
    if (t) out[key] = t;
  }
  return out;
}

/** The operator's persisted context/KV-cache overrides (config.json
 * `localEngine.tuning`). Absent key ⇒ {} (preset defaults apply). */
export function getLocalEngineTuning(config: Record<string, unknown> = readConfig()): LocalTuning {
  const entry = readLocalEngineBlock(config) as LocalEngineTuningBlock;
  return parseTuning(entry.tuning);
}

/** Merges a per-tier patch over the persisted tuning — a tier key omitted from
 * `patch` leaves it untouched; a tier key set to `null` clears the override
 * (reverts to the preset default); a tier key set to an object merges its
 * fields (so setting only `kvCacheDtype` doesn't clobber a stored `contextLimit`). */
export function setLocalEngineTuning(patch: Partial<Record<TierKey, TierTuning | null>>): void {
  const config = readConfig();
  const existing = readLocalEngineBlock(config) as LocalEngineTuningBlock;
  const merged: LocalTuning = parseTuning(existing.tuning);
  for (const key of Object.keys(patch) as TierKey[]) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v === null) delete merged[key];
    else merged[key] = { ...merged[key], ...v };
  }
  config.localEngine = { ...existing, tuning: merged };
  writeJsonAtomic(configFilePath(), config);
}

export type TuningInput = Partial<Record<TierKey, unknown>>;
export type TuningValidation = { ok: true; tuning: Partial<Record<TierKey, TierTuning | null>> } | { ok: false; error: string };

/** Validates a raw (untrusted) tuning payload against the RAM band's preset —
 * contextLimit must fall within [1024, role.maxRecommendedContext] and
 * kvCacheDtype must be a known dtype. Pure, mirrors local-quant.ts's
 * validateSelection so the HTTP layer stays a thin parse-then-branch. */
export function validateTuning(raw: TuningInput, preset: LocalMemoryPreset): TuningValidation {
  const tuning: Partial<Record<TierKey, TierTuning | null>> = {};
  for (const key of Object.keys(raw) as TierKey[]) {
    if (key !== "fast" && key !== "coding") continue;
    const v = raw[key];
    if (v === undefined) continue;
    if (v === null) { tuning[key] = null; continue; }
    if (typeof v !== "object") return { ok: false, error: `invalid tuning payload for ${key}` };
    const role = key === "coding" ? preset.localCoderQuality : preset.localAgentFast;
    const r = v as Record<string, unknown>;
    const out: TierTuning = {};
    if (r.contextLimit !== undefined) {
      if (typeof r.contextLimit !== "number" || r.contextLimit < 1024 || r.contextLimit > role.maxRecommendedContext) {
        return { ok: false, error: `contextLimit for ${key} must be between 1024 and ${role.maxRecommendedContext}` };
      }
      out.contextLimit = r.contextLimit;
    }
    if (r.kvCacheDtype !== undefined) {
      if (typeof r.kvCacheDtype !== "string" || !(KV_CACHE_DTYPES as string[]).includes(r.kvCacheDtype)) {
        return { ok: false, error: `invalid kvCacheDtype for ${key}: ${JSON.stringify(r.kvCacheDtype)}` };
      }
      out.kvCacheDtype = r.kvCacheDtype as KvCacheDtype;
    }
    if (r.reasoning !== undefined) {
      if (typeof r.reasoning !== "boolean") {
        return { ok: false, error: `reasoning for ${key} must be a boolean` };
      }
      out.reasoning = r.reasoning;
    }
    tuning[key] = out;
  }
  return { ok: true, tuning };
}

/**
 * Pure: the `rapid-mlx serve …` argv for a tier.
 *
 * `--reasoning` (Rapid-MLX's own flag) pins `--kv-cache-dtype` to int8
 * SERVER-SIDE regardless of what we pass — its own help text: "pins
 * --kv-cache-dtype to int8 regardless of the dtype flag (sub-4-bit drops -20pt
 * on AIME-class math for Qwen3 thinking variants)". So a reasoning tier's
 * `kvCacheDtype` is advisory only; we omit the flag rather than pass a value
 * the server will silently override, since a printed-but-ignored arg is
 * confusing to read from a process list.
 */
export function buildServeArgs(tier: LocalTier): string[] {
  const args = ["serve", tier.alias, "--host", "127.0.0.1", "--port", String(tier.port)];
  if (tier.reasoning) {
    args.push("--reasoning");
  } else {
    args.push("--no-thinking");
    if (tier.kvCacheDtype) args.push("--kv-cache-dtype", tier.kvCacheDtype);
  }
  if (tier.cacheMemoryPercent != null) args.push("--cache-memory-percent", String(tier.cacheMemoryPercent));
  return args;
}

/** OpenAI base URL for a tier's local port. */
export function tierBaseUrl(tier: LocalTier): string {
  return `http://127.0.0.1:${tier.port}/v1`;
}

/** The tier whose alias equals this model id, or null (used to route a chosen
 * local model to the right Rapid-MLX port). */
function catalogOptionForAlias(alias: string): LocalModelOption | null {
  return LOCAL_MODEL_CATALOG.find((opt) => opt.alias === alias || opt.repo === alias) ?? null;
}

/** Resolves both the short alias (qwen3.6-35b-8bit) and the full HF repo id
 * (mlx-community/Qwen3.6-35B-A3B-8bit) for every published quant, not just the
 * two currently-configured tiers — used to recognize "this model id belongs to
 * the local mlx engine" for routing regardless of which quant is installed. */
export function tierForAlias(alias: string, cfg: LocalEngineConfig = getLocalEngineConfig()): LocalTier | null {
  const direct = cfg.tiers.find((t) => t.alias === alias);
  if (direct) return direct;

  const legacy = SUPPORTED_LOCAL_TIER_PRESETS.find((t) => t.alias === alias);
  if (legacy) return legacy;

  const opt = catalogOptionForAlias(alias);
  if (!opt) return null;
  const sameTier = cfg.tiers.find((t) => t.key === opt.tier) ?? DEFAULT_TIERS.find((t) => t.key === opt.tier)!;
  return {
    key: opt.tier, alias: opt.alias, port: sameTier.port, reasoning: sameTier.reasoning, quant: opt.quant,
    kvCacheDtype: sameTier.kvCacheDtype, cacheMemoryPercent: sameTier.cacheMemoryPercent,
  };
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

/** `pip install --user rapid-mlx` on macOS lands under ~/Library/Python/<major.minor>/bin —
 * a directory GUI-launched apps rarely have on PATH. Enumerate whichever Python
 * versions are present rather than guessing one. */
function pythonUserBinCandidates(home: string, listVersions: (base: string) => string[]): string[] {
  const base = join(home, "Library", "Python");
  return listVersions(base).map((version) => join(base, version, "bin", "rapid-mlx"));
}

function defaultListVersions(base: string): string[] {
  try {
    return readdirSync(base);
  } catch {
    return [];
  }
}

/**
 * Locate the rapid-mlx executable: explicit config/env win outright; otherwise
 * PATH (covers venv/homebrew/pipx installs) via the same `which`-based lookup
 * claude/codex use, then a handful of known install locations as a fallback for
 * GUI-launched apps whose PATH never saw the user's shell profile.
 *
 * `probe` is a test seam — real callers omit it.
 */
export function resolveRapidBinary(
  cfg: LocalEngineConfig = getLocalEngineConfig(),
  probe: {
    exists?: (path: string) => boolean;
    home?: string;
    hiveEnv?: string;
    listPythonVersions?: (base: string) => string[];
    findOnPath?: (name: string, searchPaths: string[]) => string | null;
  } = {},
): string | null {
  const exists = probe.exists ?? existsSync;
  const home = probe.home ?? homedir();
  const hiveEnv = probe.hiveEnv ?? process.env.HIVE_RAPID_MLX;
  const listPythonVersions = probe.listPythonVersions ?? defaultListVersions;
  const findOnPath = probe.findOnPath ?? findBinary;

  const configured = [cfg.binary, hiveEnv].filter((p): p is string => !!p);
  for (const p of configured) if (exists(p)) return p;

  const searchPaths = [
    ...pythonUserBinCandidates(home, listPythonVersions),
    join(home, ".local", "bin", "rapid-mlx"),
    join(home, "hivematrix", ".rapidmlx-eval", ".venv", "bin", "rapid-mlx"),
    "/opt/homebrew/bin/rapid-mlx",
  ].filter((p) => exists(p));

  return findOnPath("rapid-mlx", searchPaths);
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
  /** MLX quant (matches LOCAL_MODEL_CATALOG's alias suffix) — null when disabled.
   * NOT a GGUF/llama.cpp quant name; Rapid-MLX only serves MLX weights. */
  quant: LocalQuant | null;
  /** Client-enforced prompt+history budget (context-governor.ts) — Rapid-MLX
   * has no server-side context flag, so this is the only place it takes effect. */
  defaultContext: number;
  /** Upper bound offered in the Settings context slider — not itself enforced. */
  maxRecommendedContext: number;
  /** --kv-cache-dtype for this tier at this RAM band. See local-tuning.ts for
   * the footprint arithmetic these picks are derived from (2026-07-09 spec §1). */
  kvCacheDtype: KvCacheDtype | null;
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
  quant: null,
  defaultContext: 0,
  maxRecommendedContext: 0,
  kvCacheDtype: null,
  role: "disabled",
};

/**
 * Per-RAM-band quant/context/KV-dtype picks. Derived (2026-07-09 tuning spec §1)
 * from each model's real KV shape, not guessed: the coding tier (64 layers x 4
 * kv_heads) costs ~3.2x more KV per token than the fast tier (40 layers x 2
 * kv_heads), so identical context budgets across tiers — the pre-2026-07-09
 * shape of this table — were backwards. `local-tuning.ts` computes the exact
 * footprint; use `estimateKvCacheGiB` before hand-editing these numbers.
 */
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
    localAgentFast: { enabled: true, model: "qwen3.6-35b-a3b", quant: "4bit", defaultContext: 16384, maxRecommendedContext: 32768, kvCacheDtype: "int4", role: "fast local agent/planner" },
    localCoderQuality: DISABLED_ROLE,
    localEmbeddings: { enabled: true, model: "bge-small or nomic-embed-text", role: "small local retrieval embedding model" },
    frontierPrimary: { enabled: true, role: "fallback when local is unavailable or insufficient" },
    rationale: "32GB can run Qwen3.6-35B-A3B at 4-bit with a small embedding model, but should not keep Qwen3.6-27B hot",
  },
  {
    id: "48gb",
    minGB: 48,
    mode: "local_agent_standard",
    localEnabled: true,
    recommendedTiers: ["fast"],
    localAgentFast: { enabled: true, model: "qwen3.6-35b-a3b", quant: "4bit", defaultContext: 32768, maxRecommendedContext: 65536, kvCacheDtype: "int4", role: "primary local agent/planner" },
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
    localAgentFast: { enabled: true, model: "qwen3.6-35b-a3b", quant: "4bit", defaultContext: 32768, maxRecommendedContext: 65536, kvCacheDtype: "int4", role: "fast planner, triage, subagent, summarizer" },
    localCoderQuality: { enabled: true, model: "qwen3.6-27b", quant: "4bit", defaultContext: 16384, maxRecommendedContext: 32768, kvCacheDtype: "int4", role: "coding quality model" },
    localEmbeddings: { enabled: true, model: "bge-small or nomic-embed-text", role: "small local retrieval embedding model" },
    frontierPrimary: { enabled: true, role: "fallback when local is unavailable or insufficient" },
    rationale: "64GB can run both Qwen models resident at 4-bit; the coding tier gets a smaller context budget than fast — it costs ~3.2x more KV per token (64 layers x 4 kv_heads vs 40 x 2)",
  },
  {
    id: "128gb",
    minGB: 128,
    mode: "dual_local_quality",
    localEnabled: true,
    recommendedTiers: ["fast", "coding"],
    // 8-bit weights (34.0+62.7=... see local-tuning.ts) fit comfortably under the
    // ~115G Metal ceiling at these contexts: ~68.6G resident. int8 KV on coding
    // only — Rapid-MLX's own --reasoning profile pins int8 for exactly this
    // model/role combination (AIME-class math loses ~20pt under sub-4-bit KV).
    localAgentFast: { enabled: true, model: "qwen3.6-35b-a3b", quant: "8bit", defaultContext: 65536, maxRecommendedContext: 131072, kvCacheDtype: "int4", role: "fast local agent/planner" },
    localCoderQuality: { enabled: true, model: "qwen3.6-27b", quant: "8bit", defaultContext: 32768, maxRecommendedContext: 65536, kvCacheDtype: "int8", role: "primary local coding model" },
    localEmbeddings: { enabled: true, model: "bge-small, nomic-embed-text, or mxbai-embed-large", role: "small local retrieval embedding model" },
    frontierPrimary: { enabled: true, role: "fallback when local is unavailable or insufficient" },
    rationale: "128GB is the first tier where both models can run at 8-bit weights while staying resident together (~68.6G at 65536/32768 context, int4/int8 KV — see local-tuning.ts)",
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
