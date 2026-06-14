/**
 * Azure DevOps integration — registers Microsoft's official local Azure DevOps
 * MCP server (`npx @azure-devops/mcp <org>`) so agents can operate repos, PRs,
 * pipelines, and work items. Gated by the `ado` feature flag AND a configured org.
 * Local stdio variant is used because it works with any MCP client (Claude Code /
 * Codex / Qwen); the remote HTTP variant only supports MS clients today.
 *
 * Auth modes (passed to the MCP server): "azcli" (Entra via `az login` — preferred,
 * no secret), "pat" (base64 email:pat in PERSONAL_ACCESS_TOKEN env), "envvar"
 * (Entra bearer in ADO_MCP_AUTH_TOKEN env), "interactive" (browser).
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { isFeatureEnabled } from "@/lib/config/features";
import type { McpServerConfig } from "@/lib/mcp/registry";

export type AdoAuthMode = "azcli" | "pat" | "envvar" | "interactive";

export interface AdoConfig {
  org: string;
  authMode: AdoAuthMode;
}

function coerceAuthMode(v: unknown): AdoAuthMode {
  return v === "pat" || v === "envvar" || v === "interactive" ? v : "azcli";
}

/** Parse the `ado` config block. Pure. Null when no org is set. */
export function parseAdoConfig(config: Record<string, unknown>): AdoConfig | null {
  const raw = config.ado;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const org = typeof r.org === "string" ? r.org.trim() : "";
  if (!org) return null;
  return { org, authMode: coerceAuthMode(r.authMode) };
}

export function getAdoConfig(): AdoConfig | null {
  try {
    return parseAdoConfig(JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8")));
  } catch {
    return null;
  }
}

/** Build the MCP server entry for the Azure DevOps local server. Pure. */
export function buildAdoMcpServer(cfg: AdoConfig): McpServerConfig {
  return {
    name: "azure-devops",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@azure-devops/mcp", cfg.org, "--authentication", cfg.authMode],
  };
}

/** The ADO MCP server IF the feature flag is on and an org is configured, else null. */
export function adoMcpServer(): McpServerConfig | null {
  if (!isFeatureEnabled("ado")) return null;
  const cfg = getAdoConfig();
  return cfg ? buildAdoMcpServer(cfg) : null;
}

/** ADO status for settings: flag on? org set? which auth + whether its env key is present. */
export function adoStatus(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  configured: boolean;
  org: string | null;
  authMode: AdoAuthMode | null;
  authReady: boolean;
} {
  const enabled = isFeatureEnabled("ado");
  const cfg = getAdoConfig();
  const authReady = !cfg
    ? false
    : cfg.authMode === "pat"
      ? !!env.PERSONAL_ACCESS_TOKEN?.trim()
      : cfg.authMode === "envvar"
        ? !!env.ADO_MCP_AUTH_TOKEN?.trim()
        : true; // azcli/interactive don't need an env key
  return { enabled, configured: !!cfg, org: cfg?.org ?? null, authMode: cfg?.authMode ?? null, authReady };
}
