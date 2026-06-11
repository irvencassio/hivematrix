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
import { getAllAgentProfiles } from "@/lib/config/agent-profiles";

const CLASSIFIER_TIMEOUT_MS = 8000; // CLI startup is slower than raw API

function buildAgentDescriptions(): string {
  return getAllAgentProfiles()
    .map((p) => `- ${p.id}: ${p.description}`)
    .join("\n");
}

const VALID_TYPES = new Set(
  getAllAgentProfiles().map((p) => p.id)
);

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
 */
export async function classifyTask(description: string): Promise<string> {
  // Try LLM classification via Claude CLI
  const cliResult = classifyWithCLI(description);
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
    const result = execSync(
      `${JSON.stringify(binary)} -p ${JSON.stringify(prompt)} --model claude-haiku-4-5-20251001 --max-turns 1 --output-format text`,
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
    const sonnetResult = execSync(
      `${JSON.stringify(binary)} -p ${JSON.stringify(prompt)} --model claude-sonnet-4-6 --max-turns 1 --output-format text`,
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
  if (match && VALID_TYPES.has(match[1])) return match[1];
  return null;
}
