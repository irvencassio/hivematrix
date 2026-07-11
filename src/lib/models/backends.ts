/**
 * Model-backend detection for the Settings/New-Task UI.
 *
 * Reports which backends are actually set up on this machine so the console can
 * (a) only offer models whose backend is configured, and (b) show an
 * install/connect flow for the missing ones.
 *
 * Backends:
 *   claude — the `claude` CLI (Claude Code)
 *   codex  — the `codex` CLI (OpenAI Codex)
 */

import { findBinary, CLAUDE_BINARY_SEARCH_PATHS, CODEX_BINARY_SEARCH_PATHS } from "@/lib/config/binary-detection";
import { isProviderEnabled } from "@/lib/config/frontier-providers";

export type BackendId = "claude" | "codex";

export interface BackendStatus {
  id: BackendId;
  name: string;
  /** installed && enabled — the historical meaning; every existing gate reads this. */
  configured: boolean;
  /** Binary found on disk, independent of the operator's enable/disable toggle. */
  installed: boolean;
  /** Operator's HiveMatrix-side enable/disable toggle. */
  enabled: boolean;
  detail: string;
  /** Shown when not configured — how to install/connect it. */
  connect?: string;
  endpoint?: string;
  modelId?: string;
}

/** Injectable for tests — real binary/config lookups are process-global and hard to sandbox. */
export interface DetectBackendsEnv {
  findBinary?: typeof findBinary;
  isProviderEnabled?: typeof isProviderEnabled;
}

export function detectBackends(env: DetectBackendsEnv = {}): BackendStatus[] {
  const find = env.findBinary ?? findBinary;
  const enabled = env.isProviderEnabled ?? isProviderEnabled;
  const out: BackendStatus[] = [];

  // Claude Code CLI
  const claudePath = find("claude", CLAUDE_BINARY_SEARCH_PATHS);
  const claudeInstalled = !!claudePath;
  const claudeEnabled = enabled("claude");
  out.push({
    id: "claude",
    name: "Claude Code",
    configured: claudeInstalled && claudeEnabled,
    installed: claudeInstalled,
    enabled: claudeEnabled,
    detail: claudeInstalled ? `claude CLI at ${claudePath}` : "claude CLI not found",
    connect: claudeInstalled ? undefined : "Install Claude Code (https://claude.com/claude-code) and run `claude` once to sign in.",
  });

  // Codex CLI
  const codexPath = find("codex", CODEX_BINARY_SEARCH_PATHS);
  const codexInstalled = !!codexPath;
  const codexEnabled = enabled("codex");
  out.push({
    id: "codex",
    name: "Codex",
    configured: codexInstalled && codexEnabled,
    installed: codexInstalled,
    enabled: codexEnabled,
    detail: codexInstalled ? `codex CLI at ${codexPath}` : "codex CLI not found",
    connect: codexInstalled ? undefined : "Install the Codex CLI and run `codex login` (ChatGPT subscription).",
  });

  return out;
}

export function backendConfigured(id: BackendId): boolean {
  return detectBackends().find((b) => b.id === id)?.configured ?? false;
}
