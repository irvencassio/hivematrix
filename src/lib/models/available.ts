/**
 * The set of models the console offers, derived from which backends are
 * actually configured (see backends.ts). Frontier model IDs are pinned to the
 * current releases; the local model reflects the configured Qwen profile.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { detectBackends, type BackendStatus, type BackendId } from "./backends";

// Pinned current frontier model IDs (2026-06).
export const CLAUDE_OPUS_ID = "claude-opus-4-8";   // Opus 4.8
export const CLAUDE_FABLE_ID = "claude-fable-5";   // Fable 5 (latest "F")
export const CODEX_NEWEST_ID = "codex:gpt-5.5-codex"; // GPT-5.5 (newest Codex, 2026-04-23)
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
  }

  const claude = by("claude");
  if (claude?.configured) {
    models.push({ id: "claude-opus", name: "Claude Opus 4.8 (claude-opus-4-8)", modelId: CLAUDE_OPUS_ID, backend: "claude" });
    models.push({ id: "claude-fable", name: "Claude Fable 5 (claude-fable-5)", modelId: CLAUDE_FABLE_ID, backend: "claude" });
  }

  const codex = by("codex");
  if (codex?.configured) {
    models.push({ id: "codex", name: "Codex — GPT-5.5 (gpt-5.5-codex)", modelId: CODEX_NEWEST_ID, backend: "codex" });
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

export type ThemeMode = "system" | "light" | "dark";

export interface ThemeSettings {
  theme: ThemeMode;
  wallpaperPath: string | null;
}

export function getThemeSettings(): ThemeSettings {
  const cfg = readConfig();
  const theme = cfg.theme === "light" || cfg.theme === "dark" ? cfg.theme : "system";
  const wallpaperPath = typeof cfg.wallpaperPath === "string" && cfg.wallpaperPath ? cfg.wallpaperPath : null;
  return { theme, wallpaperPath };
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
