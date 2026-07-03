/**
 * The set of models the console offers, derived from which backends are
 * actually configured (see backends.ts). Frontier model IDs are pinned to the
 * current releases; the local model reflects the configured Qwen profile.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { detectBackends, type BackendStatus, type BackendId } from "./backends";
import { SUPPORTED_LOCAL_TIER_PRESETS, type LocalTier } from "./local-engine";
import { LOCAL_MODEL_PRESETS, type LocalModelPreset } from "./local-presets";
import { claudeAliasId } from "./catalog";

// Claude frontier models are referenced by the CLI's version-agnostic aliases,
// so they always resolve to the latest model for the tier (no version to bump).
export const CLAUDE_OPUS_ID = "opus";     // alias → latest Opus
export const CLAUDE_SONNET_ID = "sonnet"; // alias → latest Sonnet
export const CODEX_NEWEST_ID = "codex:gpt-5.5"; // GPT-5.5 (the -codex variants are API-key-only, rejected on ChatGPT subscriptions)
export const CODEX_SPARK_ID = "codex:gpt-5.3-codex-spark"; // Spark has a separate Codex usage pool
export const MIXED_ID = "mixed";
export const CLOUD_ONLY_ID = "cloud-only";

export interface UiModel {
  id: string;        // selection value (unique; e.g. "codex-fast")
  name: string;      // display name with number
  modelId: string;   // concrete model id sent to the task (or "mixed")
  backend: BackendId | "mixed";
  fast?: boolean;
  note?: string;
}

function localTierLabel(tier: LocalTier): string {
  if (tier.key === "coding") return `Local coding — ${tier.alias}`;
  return `Local fast — ${tier.alias}`;
}

function localTierNote(tier: LocalTier): string {
  if (tier.key === "coding") return "on-device 27B-dense — higher coding quality, slower";
  return "on-device fast tier — daily, voice, and operational work";
}

function localPresetUiModels(existingModelIds: Set<string>): UiModel[] {
  const tierModels = SUPPORTED_LOCAL_TIER_PRESETS
    .filter((tier) => !existingModelIds.has(tier.alias))
    .map((tier) => ({
      id: `local-${tier.key}`,
      name: localTierLabel(tier),
      modelId: tier.alias,
      backend: "local" as const,
      note: localTierNote(tier),
    }));
  const presetModels = LOCAL_MODEL_PRESETS
    .filter((preset) => !existingModelIds.has(preset.modelId))
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      modelId: preset.modelId,
      backend: "local" as const,
      note: preset.note,
    }));
  return [...tierModels, ...presetModels];
}

export function buildAvailableModels(backends: BackendStatus[] = detectBackends()): UiModel[] {
  const by = (id: BackendId) => backends.find((b) => b.id === id);
  const models: UiModel[] = [];

  const local = by("local");
  if (local?.configured && local.modelId) {
    models.push({
      id: "local",
      name: `Local — ${local.modelId}`,
      modelId: local.modelId,
      backend: "local",
      note: "runs entirely on your machine",
    });
    for (const tierModel of localPresetUiModels(new Set([local.modelId]))) models.push(tierModel);
  }

  const claude = by("claude");
  if (claude?.configured) {
    models.push({ id: "claude-opus", name: "Claude Opus", modelId: CLAUDE_OPUS_ID, backend: "claude" });
    models.push({ id: "claude-sonnet", name: "Claude Sonnet", modelId: CLAUDE_SONNET_ID, backend: "claude" });
  }

  const codex = by("codex");
  if (codex?.configured) {
    models.push({ id: "codex", name: "Codex — GPT-5.5 (gpt-5.5)", modelId: CODEX_NEWEST_ID, backend: "codex" });
    models.push({ id: "codex-spark", name: "Codex — GPT-5.3 Spark", modelId: CODEX_SPARK_ID, backend: "codex", note: "separate day-to-day coding pool" });
    models.push({ id: "codex-fast", name: "Codex — GPT-5.5, fast mode", modelId: CODEX_NEWEST_ID, backend: "codex", fast: true, note: "lower reasoning effort, faster" });
  }

  // Mixed needs a local backend AND a frontier backend.
  const hasFrontier = !!(claude?.configured || codex?.configured);
  if (local?.configured && hasFrontier) {
    models.push({
      id: "mixed",
      name: "Mixed — frontier thinking + local processing",
      modelId: MIXED_ID,
      backend: "mixed",
      note: "router-driven: frontier when available, local otherwise",
    });
  }

  // Cloud-only is the no-local posture: every role runs on frontier, the local
  // model is never spawned. Only needs a frontier backend (no local required).
  if (hasFrontier) {
    models.push({
      id: "cloud-only",
      name: "Cloud-only — frontier, no local model",
      modelId: CLOUD_ONLY_ID,
      backend: "mixed",
      note: "every role runs on frontier; local model never used",
    });
  }

  return models;
}

// --- Default model (Settings) ---

function configPath(): string {
  return join(homedir(), ".hivematrix", "config.json");
}

function readConfig(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(configPath(), "utf-8")); } catch { return {}; }
}

/** The configured default model id, falling back to the first available. */
export function getDefaultModel(available: UiModel[] = buildAvailableModels()): string | null {
  const cfg = readConfig();
  const configured = typeof cfg.defaultModel === "string" ? cfg.defaultModel : null;
  if (configured && available.some((m) => m.modelId === configured || m.id === configured)) {
    return configured;
  }
  return available[0]?.modelId ?? null;
}

export function setDefaultModel(modelId: string): void {
  const cfg = readConfig();
  cfg.defaultModel = modelId;
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

// --- Theme + wallpaper (Settings → Appearance) ---

export type ThemeMode = "system" | "light" | "dark" | "matrix";

export interface ThemeSettings {
  theme: ThemeMode;
  wallpaperPath: string | null;
  /** Panel opacity over a wallpaper, 0–100 (% of solid). Default 82. */
  wallpaperOpacity: number;
}

export function getThemeSettings(): ThemeSettings {
  const cfg = readConfig();
  const theme = cfg.theme === "light" || cfg.theme === "dark" || cfg.theme === "matrix" ? cfg.theme : "system";
  const wallpaperPath = typeof cfg.wallpaperPath === "string" && cfg.wallpaperPath ? cfg.wallpaperPath : null;
  const raw = typeof cfg.wallpaperOpacity === "number" ? cfg.wallpaperOpacity : 82;
  const wallpaperOpacity = Math.min(100, Math.max(0, Math.round(raw)));
  return { theme, wallpaperPath, wallpaperOpacity };
}

function writeConfig(cfg: Record<string, unknown>): void {
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

/** Panel translucency over a wallpaper (0–100). */
export function setWallpaperOpacity(pct: number): void {
  const cfg = readConfig();
  cfg.wallpaperOpacity = Math.min(100, Math.max(0, Math.round(pct)));
  writeConfig(cfg);
}

/** Operator location (city/region) shared into location-aware tasks. */
export function getLocation(): string {
  const cfg = readConfig();
  return typeof cfg.location === "string" ? cfg.location : "";
}
export function setLocation(location: string): void {
  const cfg = readConfig();
  const v = location.trim();
  if (v) cfg.location = v; else delete cfg.location;
  writeConfig(cfg);
}

/** Whether updates install automatically on app launch (default false = manual). */
export function getAutoUpdate(): boolean {
  return readConfig().autoUpdate === true;
}
export function setAutoUpdate(on: boolean): void {
  const cfg = readConfig();
  cfg.autoUpdate = !!on;
  writeConfig(cfg);
}

export type AppIconChoice = "dark-green" | "white";

export function getAppIconChoice(): AppIconChoice {
  return readConfig().appIconChoice === "dark-green" ? "dark-green" : "white";
}

export function setAppIconChoice(choice: AppIconChoice): void {
  const cfg = readConfig();
  cfg.appIconChoice = choice;
  writeConfig(cfg);
}

export function setTheme(theme: ThemeMode): void {
  const cfg = readConfig();
  cfg.theme = theme;
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

/** Set the wallpaper to a file path, or null to clear. */
export function setWallpaperPath(path: string | null): void {
  const cfg = readConfig();
  if (path) cfg.wallpaperPath = path; else delete cfg.wallpaperPath;
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

/** Save an uploaded wallpaper (base64) to ~/.hivematrix and set it. Returns the path. */
export function saveWallpaperUpload(base64: string, ext: string): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  const safeExt = /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : "png";
  const path = join(dir, `wallpaper.${safeExt}`);
  writeFileSync(path, Buffer.from(base64, "base64"));
  setWallpaperPath(path);
  return path;
}

// --- Frontier provider (Settings → Models) ---

export type FrontierProvider = "claude" | "codex";

export function getFrontierProvider(): FrontierProvider {
  const cfg = readConfig();
  return cfg.frontierProvider === "codex" ? "codex" : "claude";
}

export function setFrontierProvider(provider: FrontierProvider): void {
  const cfg = readConfig();
  cfg.frontierProvider = provider;
  writeConfig(cfg);
}

// --- Mixed-mode role models (Settings → Models) ---
//
// In Mixed mode the router maps roles to tiers and the model-resolver turns a
// tier into a concrete model. Three of those are operator-pickable here:
//   thinking     → frontier-premium tier  → config key `thinkModel`        (default Opus)
//   coding       → frontier tier          → config key `frontierModel`     (default Sonnet)
//   operational  → local-secondary tier   → config key `operationalModel`  (default Qwen profile)
// An empty value means "use the built-in default" (the resolver's fallback).

export interface RoleModels {
  /** Planning/architecture/review — frontier-premium tier. */
  thinking: string;
  /** Critical implementation/UI — frontier tier. */
  coding: string;
  /** Bulk execution/file ops — local-secondary tier (on-device in Mixed mode). */
  operational: string;
  /** Prose generation (video scripts, briefings, summaries, drafted messages).
   * A frontier model id → frontier when cloud-ok; a local model id → locked to
   * free/local; empty → default (frontier favorite when cloud-ok, else local). */
  writer: string;
}

export interface RoleModelOption {
  modelId: string;
  name: string;
  backend: BackendId;
  note?: string;
}

export interface RoleModelOptions {
  thinking: RoleModelOption[];
  coding: RoleModelOption[];
  operational: RoleModelOption[];
  writer: RoleModelOption[];
}

function roleOption(modelId: string, name: string, backend: BackendId, note?: string): RoleModelOption {
  return { modelId, name, backend, note };
}

function presetRoleOption(preset: LocalModelPreset): RoleModelOption {
  return roleOption(preset.modelId, preset.name, "local", preset.note);
}

function localRoleOptions(local: BackendStatus | undefined): RoleModelOption[] {
  if (!local?.configured || !local.modelId) return [];
  const out: RoleModelOption[] = [
    roleOption(local.modelId, `Local — ${local.modelId}`, "local", "runs on this Mac"),
  ];
  const seen = new Set(out.map((m) => m.modelId));
  for (const tier of SUPPORTED_LOCAL_TIER_PRESETS) {
    if (seen.has(tier.alias)) continue;
    out.push(roleOption(tier.alias, localTierLabel(tier), "local", localTierNote(tier)));
    seen.add(tier.alias);
  }
  for (const preset of LOCAL_MODEL_PRESETS) {
    if (seen.has(preset.modelId)) continue;
    out.push(presetRoleOption(preset));
    seen.add(preset.modelId);
  }
  return out;
}

export function buildRoleModelOptions(backends: BackendStatus[] = detectBackends()): RoleModelOptions {
  const by = (id: BackendId) => backends.find((b) => b.id === id);
  const local = by("local");
  const claude = by("claude");
  const codex = by("codex");

  const localOptions = localRoleOptions(local);
  const opus = claude?.configured ? roleOption(CLAUDE_OPUS_ID, "Claude Opus", "claude") : null;
  const sonnet = claude?.configured ? roleOption(CLAUDE_SONNET_ID, "Claude Sonnet", "claude") : null;
  const gpt55 = codex?.configured ? roleOption(CODEX_NEWEST_ID, "Codex GPT-5.5", "codex") : null;
  const spark = codex?.configured ? roleOption(CODEX_SPARK_ID, "Codex GPT-5.3 Spark", "codex", "separate coding pool") : null;

  return {
    thinking: [opus, sonnet, gpt55, spark].filter((m): m is RoleModelOption => m !== null),
    coding: [opus, sonnet, gpt55, spark, ...localOptions].filter((m): m is RoleModelOption => m !== null),
    operational: [...localOptions, spark, sonnet].filter((m): m is RoleModelOption => m !== null),
    // Writer: frontier for quality, or the local model to lock everything free.
    writer: [sonnet, opus, gpt55, ...localOptions].filter((m): m is RoleModelOption => m !== null),
  };
}

export function getRoleModels(): RoleModels {
  const cfg = readConfig();
  const str = (k: string) => (typeof cfg[k] === "string" ? (cfg[k] as string) : "");
  return {
    thinking: str("thinkModel"),
    coding: str("frontierModel"),
    operational: str("operationalModel"),
    writer: str("writerModel"),
  };
}

/**
 * Role models normalized for the Settings dropdowns: a legacy pinned Claude
 * full id (`claude-opus-4-8`) collapses to the bare CLI alias the catalog now
 * offers, so the stored value matches the "Claude Opus"/"Claude Sonnet" option
 * instead of rendering as a raw id. Storage is untouched — the resolver keeps
 * matching the full id via its `claude-*` predicates.
 */
export function getRoleModelsForDisplay(): RoleModels {
  const rm = getRoleModels();
  return {
    thinking: claudeAliasId(rm.thinking),
    coding: claudeAliasId(rm.coding),
    operational: claudeAliasId(rm.operational),
    writer: claudeAliasId(rm.writer),
  };
}

const ROLE_CONFIG_KEY: Record<keyof RoleModels, string> = {
  thinking: "thinkModel",
  coding: "frontierModel",
  operational: "operationalModel",
  writer: "writerModel",
};

/** Set one role's model override. Empty/blank clears it (reverts to default). */
export function setRoleModel(role: keyof RoleModels, modelId: string): void {
  const key = ROLE_CONFIG_KEY[role];
  const cfg = readConfig();
  const v = modelId.trim();
  if (v) cfg[key] = v; else delete cfg[key];
  writeConfig(cfg);
}

/** Persist the local-server endpoint (Settings → Models → local config). */
export function setLocalEndpoint(endpoint: string): void {
  const cfg = readConfig();
  const lm = (cfg.localModel as Record<string, unknown>) ?? {};
  lm.endpoint = endpoint;
  cfg.localModel = lm;
  const qwen = cfg.qwen as Record<string, unknown> | undefined;
  if (qwen && qwen.primary && typeof qwen.primary === "object") {
    (qwen.primary as Record<string, unknown>).endpoint = endpoint;
  }
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}
