/**
 * The set of models the console offers, derived from which backends are
 * actually configured (see backends.ts). Frontier model IDs are pinned to the
 * CLI's version-agnostic aliases (opus/sonnet/haiku).
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { writeJsonAtomic } from "@/lib/config/atomic-write";
import { detectBackends, type BackendStatus, type BackendId } from "./backends";
import { claudeAliasId } from "./catalog";
import { parseUpdateChannel, type UpdateChannel } from "@/lib/updater/channel";

// Claude frontier models are referenced by the CLI's version-agnostic aliases,
// so they always resolve to the latest model for the tier (no version to bump).
export const CLAUDE_OPUS_ID = "opus";     // alias → latest Opus
export const CLAUDE_SONNET_ID = "sonnet"; // alias → latest Sonnet
export const CLAUDE_HAIKU_ID = "haiku";   // alias → latest Haiku
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
  /** Not set up — shown greyed/unselectable so the capability stays discoverable. */
  disabled?: boolean;
}

export function buildAvailableModels(backends: BackendStatus[] = detectBackends()): UiModel[] {
  const by = (id: BackendId) => backends.find((b) => b.id === id);
  const models: UiModel[] = [];

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

  // Frontier providers that aren't set up are shown DISABLED (greyed), not
  // hidden, so the capability is discoverable with a one-line "how to enable".
  if (!claude?.configured) {
    models.push({ id: "claude-setup", name: "Claude Opus / Sonnet", modelId: "", backend: "claude", disabled: true,
      note: claude?.connect || "install the Claude CLI and sign in to enable" });
  }
  if (!codex?.configured) {
    models.push({ id: "codex-setup", name: "ChatGPT / Codex — GPT-5.5", modelId: "", backend: "codex", disabled: true,
      note: codex?.connect || "install the Codex CLI and run 'codex login' to enable" });
  }

  // Mixed: role-based routing — thinking/coding/operational each resolve to
  // their own tier (Opus/Sonnet/Haiku by default; see routing/model-resolver.ts).
  // This is the recommended posture post-cutover — every role still lands on
  // Claude, just the tier suited to the work.
  const hasFrontier = !!(claude?.configured || codex?.configured);
  if (hasFrontier) {
    models.push({
      id: "mixed",
      name: "Mixed — routes by role (thinking/coding/operational)",
      modelId: MIXED_ID,
      backend: "mixed",
      note: "recommended · thinking on Opus, coding on Sonnet, bulk/ambient on Haiku",
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

/**
 * The configured default model id. Falls back to Claude Sonnet when unset
 * and available (the Claude-native default posture — fast/capable, not the
 * highest-cost Opus); if Sonnet isn't configured, falls back to the first
 * selectable model (e.g. a Codex-only install).
 */
export function getDefaultModel(available: UiModel[] = buildAvailableModels()): string | null {
  const selectable = available.filter((m) => !m.disabled);
  const cfg = readConfig();
  const configured = typeof cfg.defaultModel === "string" ? cfg.defaultModel : null;
  if (configured && selectable.some((m) => m.modelId === configured || m.id === configured)) {
    return configured;
  }
  const sonnet = selectable.find((m) => m.modelId === CLAUDE_SONNET_ID);
  return sonnet?.modelId ?? selectable[0]?.modelId ?? null;
}

export function setDefaultModel(modelId: string): void {
  const cfg = readConfig();
  cfg.defaultModel = modelId;
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeJsonAtomic(configPath(), cfg);
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
  writeJsonAtomic(configPath(), cfg);
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

/**
 * Update channel — "stable" (default) or "beta". Beta is an IN-APP OPT-IN: the
 * website download is always stable, so a fresh install has no key here and
 * resolves to stable. Read through the updater's own resolver so the daemon
 * poller, the Rust shell and this settings surface can never disagree.
 */
export function getUpdateChannel(): UpdateChannel {
  return parseUpdateChannel(readConfig().updateChannel);
}
export function setUpdateChannel(channel: UpdateChannel | string): void {
  const cfg = readConfig();
  const next = parseUpdateChannel(channel);
  // Stable is the default, so it is stored as the ABSENCE of the key — that way
  // a config that has never opted in and one that opted back out are the same
  // thing, and both the TS and Rust readers fall to stable.
  if (next === "beta") cfg.updateChannel = "beta"; else delete cfg.updateChannel;
  writeConfig(cfg);
}

export function setTheme(theme: ThemeMode): void {
  const cfg = readConfig();
  cfg.theme = theme;
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeJsonAtomic(configPath(), cfg);
}

/** Set the wallpaper to a file path, or null to clear. */
export function setWallpaperPath(path: string | null): void {
  const cfg = readConfig();
  if (path) cfg.wallpaperPath = path; else delete cfg.wallpaperPath;
  mkdirSync(join(homedir(), ".hivematrix"), { recursive: true });
  writeJsonAtomic(configPath(), cfg);
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
//   operational  → operational tier       → config key `operationalModel`  (default Haiku)
// An empty value means "use the built-in default" (the resolver's fallback).

export interface RoleModels {
  /** Planning/architecture/review — frontier-premium tier. */
  thinking: string;
  /** Critical implementation/UI — frontier tier. */
  coding: string;
  /** Bulk execution/file ops — operational tier (Haiku by default). */
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

export function buildRoleModelOptions(backends: BackendStatus[] = detectBackends()): RoleModelOptions {
  const by = (id: BackendId) => backends.find((b) => b.id === id);
  const claude = by("claude");
  const codex = by("codex");

  const opus = claude?.configured ? roleOption(CLAUDE_OPUS_ID, "Claude Opus", "claude") : null;
  const sonnet = claude?.configured ? roleOption(CLAUDE_SONNET_ID, "Claude Sonnet", "claude") : null;
  const haiku = claude?.configured ? roleOption(CLAUDE_HAIKU_ID, "Claude Haiku", "claude", "fast/cheap — chat and ambient work") : null;
  const gpt55 = codex?.configured ? roleOption(CODEX_NEWEST_ID, "Codex GPT-5.5", "codex") : null;
  const spark = codex?.configured ? roleOption(CODEX_SPARK_ID, "Codex GPT-5.3 Spark", "codex", "separate coding pool") : null;

  return {
    // Thinking defaults to frontier-premium (a weak plan poisons everything
    // downstream); Haiku is offered last-resort for a fully-Claude posture.
    thinking: [opus, sonnet, gpt55, spark, haiku].filter((m): m is RoleModelOption => m !== null),
    coding: [opus, sonnet, gpt55, spark, haiku].filter((m): m is RoleModelOption => m !== null),
    // Operational: Claude-first (Haiku is the default), Codex Spark as the
    // cheap-pool alternative.
    operational: [haiku, sonnet, spark, opus].filter((m): m is RoleModelOption => m !== null),
    // Writer: frontier for quality.
    writer: [sonnet, opus, gpt55, haiku].filter((m): m is RoleModelOption => m !== null),
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
