/**
 * LLM-based task intent classification with keyword fallback.
 * Pipeline: Claude CLI (Haiku) → Keywords → "developer" default.
 * Uses the standard Claude CLI session (no separate ANTHROPIC_API_KEY needed).
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { classifyByKeywords } from "./keyword-classifier";
import { getCoreAgentProfiles } from "@/lib/config/agent-profiles";
import { isProviderEnabled } from "@/lib/config/frontier-providers";

const CLASSIFIER_TIMEOUT_MS = 8000; // CLI startup is slower than raw API

// Node's built-in child_process module exports are non-configurable, so
// test-runner mock.method() can't patch execSync directly — this thin
// swappable reference is the DI seam tests use instead (mirrors this
// codebase's _setXDepsForTests convention, e.g. mailbee/status.ts).
let _execSyncImpl: typeof execSync = execSync;
export function _setExecSyncForTests(fn: typeof execSync | null): void {
  _execSyncImpl = fn ?? execSync;
}

// getCoreAgentProfiles() is deliberately re-read on every call (never
// cached to a module-level const) — a custom-profile edit or the roster
// itself changing must take effect on the next classification, not require
// a daemon restart. It also restricts the classifier's choice set to
// tier==="core" — any domain profile (e.g. trader) must never be
// auto-selected; only an explicit pick reaches it. coo was gated out of
// this set (coordinator-tier) until it could read back its own delegated
// children's results — Spec 3 Phase 4 promoted it to core now that it can.
function buildAgentDescriptions(): string {
  return getCoreAgentProfiles()
    .map((p) => `- ${p.id}: ${p.description}`)
    .join("\n");
}

function validAgentTypes(): Set<string> {
  return new Set(getCoreAgentProfiles().map((p) => p.id));
}

/**
 * Resolve the claude binary path — mirrors subprocess.ts logic.
 */
function resolveClaudeBinary(): string {
  const CLAUDE_SEARCH_PATHS = [
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    join(homedir(), ".npm-global", "bin", "claude"),
    join(homedir(), ".claude", "bin", "claude"),
    join(homedir(), ".local", "bin", "claude"),
  ];

  // Check config for custom command or cached path
  try {
    const configPath = join(homedir(), ".hivematrix", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.claudeCommand && typeof config.claudeCommand === "string" && config.claudeCommand.trim()) {
      return config.claudeCommand.trim().split(/\s+/)[0];
    }
    if (config.claudeBinaryPath && existsSync(config.claudeBinaryPath)) {
      return config.claudeBinaryPath;
    }
  } catch { /* no config */ }

  // Try which
  try {
    const result = execSync("which claude", { encoding: "utf-8", timeout: 3000 }).trim();
    if (result && existsSync(result)) return result;
  } catch { /* not on PATH */ }

  // Check common install locations
  for (const p of CLAUDE_SEARCH_PATHS) {
    if (existsSync(p)) return p;
  }

  return "claude";
}

/**
 * Classify a task description to determine the best agent type.
 * Tries Claude CLI (Haiku) first, falls back to keywords, then "developer".
 *
 * The CLI step is SKIPPED ENTIRELY — never even attempted — when Claude is
 * disabled as a frontier provider (Settings → Models toggle) or its binary
 * isn't installed. Without this, every task classification would shell out
 * and eat up to two 8s execSync timeouts (Haiku, then a Sonnet retry) before
 * ever reaching the free, instant keyword fallback — the scheduler's claim
 * loop would stall for up to 16s per task for a call that was always going
 * to fail. isProviderEnabled mirrors the exact enablement check the
 * Settings UI and Usage screen already use, so "Claude disabled" behaves
 * identically everywhere in the app.
 */
export async function classifyTask(description: string): Promise<string> {
  // Try LLM classification via Claude CLI — only if Claude is actually usable.
  const cliResult = isProviderEnabled("claude") ? classifyWithCLI(description) : null;
  if (cliResult) return cliResult;

  // Fall back to keyword classification
  const keywordResult = classifyByKeywords(description);
  if (keywordResult) return keywordResult;

  // Default
  return "developer";
}

/**
 * Classify using Claude CLI with Haiku model.
 * Uses the CLI's own auth — no separate API key needed.
 */
function classifyWithCLI(description: string): string | null {
  const binary = resolveClaudeBinary();
  const agentDescriptions = buildAgentDescriptions();
  const prompt = `Classify this task to the best agent type. Respond with JSON only: {"agent":"<type>"}\n\nAgent types:\n${agentDescriptions}\n\nTask: "${description.slice(0, 500)}"`;

  try {
    // Use Haiku for fast, cheap classification
    const result = _execSyncImpl(
      `${JSON.stringify(binary)} -p ${JSON.stringify(prompt)} --model haiku --max-turns 1 --output-format text`,
      {
        encoding: "utf-8",
        timeout: CLASSIFIER_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      }
    ).trim();

    const agentType = extractAgentType(result);
    if (agentType) return agentType;

    // Retry with Sonnet if Haiku didn't return a valid type
    const sonnetResult = _execSyncImpl(
      `${JSON.stringify(binary)} -p ${JSON.stringify(prompt)} --model sonnet --max-turns 1 --output-format text`,
      {
        encoding: "utf-8",
        timeout: CLASSIFIER_TIMEOUT_MS,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      }
    ).trim();

    return extractAgentType(sonnetResult);
  } catch {
    return null;
  }
}

function extractAgentType(content: string): string | null {
  const match = content.match(/"agent"\s*:\s*"(\w+)"/);
  if (match && validAgentTypes().has(match[1])) return match[1];
  return null;
}
