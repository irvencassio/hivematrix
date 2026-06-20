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
import { homedir } from "os";

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
  const tiers: LocalTier[] = DEFAULT_TIERS.map((def) => {
    const match = rawTiers.find((t) => (t as Record<string, unknown>)?.key === def.key);
    return match ? parseTier(match, def) : def;
  });
  return {
    engine: coerceEngine(le.engine),
    binary: typeof le.binary === "string" && le.binary ? le.binary : null,
    tiers,
  };
}

/** Pure: the `rapid-mlx serve …` argv for a tier (reasoning off → --no-thinking). */
export function buildServeArgs(tier: LocalTier): string[] {
  const args = ["serve", tier.alias, "--port", String(tier.port)];
  if (!tier.reasoning) args.push("--no-thinking");
  return args;
}

/** OpenAI base URL for a tier's local port. */
export function tierBaseUrl(tier: LocalTier): string {
  return `http://127.0.0.1:${tier.port}/v1`;
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
