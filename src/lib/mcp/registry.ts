/**
 * MCP server registry — the data layer behind "see what MCP servers exist, are
 * they running, restart them." Servers are declared in ~/.hivematrix/config.json
 * under `mcpServers` (name → { transport, command/args/url }). HTTP/SSE servers
 * are health-probed for reachability; stdio servers are launched per-session by
 * the executor (so "configured" is the honest status, with restart a relaunch
 * hint). Config parsing + status mapping are pure and testable.
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { adoMcpServer } from "@/lib/ado/mcp";

export type McpTransport = "stdio" | "http" | "sse";

/**
 * Where an entry came from:
 *  - "config"      the user's ~/.hivematrix/config.json → mcpServers
 *  - "auto"        HiveMatrix auto-registered it (e.g. Azure DevOps)
 *  - "internal"    an always-on internal server materialized by HiveMatrix
 *                   itself (e.g. the flash lane-tools server the in-app chat uses)
 *  - "claude-code" a read-only reflection of Claude Code's own registry
 *                   (~/.claude.json → mcpServers) — registered for Claude Code
 *                   sessions, NOT exposed to the in-app chat
 * Optional (defaults to "config") so existing construction sites (e.g.
 * buildAdoMcpServer) and tests that build a bare McpServerConfig keep compiling.
 */
export type McpServerScope = "config" | "auto" | "internal" | "claude-code";

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  /** Optional human-readable description surfaced in the UI. */
  description?: string;
  scope?: McpServerScope;
  /**
   * True for entries HiveMatrix doesn't own/control (informational only): no
   * restart action applies regardless of transport, and status is descriptive
   * rather than actionable. Set on the internal flash entry and on every
   * ~/.claude.json reflection.
   */
  readOnly?: boolean;
}

/** Pure: parse a `mcpServers` config object into a normalized list. */
export function parseMcpServers(raw: unknown): McpServerConfig[] {
  if (!raw || typeof raw !== "object") return [];
  const out: McpServerConfig[] = [];
  for (const [name, vRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!vRaw || typeof vRaw !== "object") continue;
    const v = vRaw as Record<string, unknown>;
    const url = typeof v.url === "string" ? v.url : undefined;
    const command = typeof v.command === "string" ? v.command : undefined;
    const transport: McpTransport =
      v.transport === "http" || v.transport === "sse" || v.transport === "stdio"
        ? v.transport
        : url
          ? (url.includes("/sse") ? "sse" : "http")
          : "stdio";
    out.push({
      name,
      transport,
      command,
      args: Array.isArray(v.args) ? v.args.filter((a): a is string => typeof a === "string") : undefined,
      url,
      scope: "config",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Name of the internal flash lane-tools MCP server — kept as a local constant
 *  (rather than importing lib/flash/flash-mcp.ts, which pulls in connectivity
 *  policy, config loading, and the websocket broadcaster) since this module
 *  only needs the name/config shape for display, not the server itself.
 *  Must match FLASH_MCP_SERVER_NAME in src/lib/flash/flash-mcp.ts. */
const FLASH_SERVER_NAME = "flash";
const FLASH_SERVER_DESCRIPTION = "HiveMatrix lane tools (built-in, always available to chat)";

/**
 * Synthetic, always-on entry for the internal flash lane-tools MCP server.
 * It isn't declared in config.json — it's materialized per chat session by
 * ensureFlashMcpServer()/prepareFlashMcp() in lib/flash/flash-mcp.ts — so
 * without this the Settings list looked empty even though chat has tools
 * available right now. Best-effort read of the last-materialized config file
 * for command/args; falls back to a name-only entry if it hasn't run yet.
 */
function flashInternalServer(): McpServerConfig {
  let command: string | undefined;
  let args: string[] | undefined;
  try {
    const raw = JSON.parse(
      readFileSync(join(homedir(), ".hivematrix", "mcp", "flash-mcp-config.json"), "utf-8"),
    ) as { mcpServers?: Record<string, { command?: unknown; args?: unknown }> };
    const entry = raw?.mcpServers?.[FLASH_SERVER_NAME];
    if (entry && typeof entry.command === "string") command = entry.command;
    if (entry && Array.isArray(entry.args)) args = entry.args.filter((a): a is string => typeof a === "string");
  } catch { /* not materialized since the last restart — still surface the entry */ }

  return {
    name: FLASH_SERVER_NAME,
    transport: "stdio",
    command,
    args,
    description: FLASH_SERVER_DESCRIPTION,
    scope: "internal",
    readOnly: true,
  };
}

/**
 * Read-only reflection of Claude Code's own MCP registry (~/.claude.json →
 * mcpServers), e.g. `canopy`. These are registered for Claude Code sessions —
 * NOT the in-app chat, which runs flash with --strict-mcp-config and only
 * ever sees the flash server above. Surfaced purely as information.
 */
function claudeCodeServers(): McpServerConfig[] {
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf-8"));
    return parseMcpServers(raw?.mcpServers).map((s) => ({
      ...s,
      description: "Registered for Claude Code (~/.claude.json) — not exposed to the in-app chat (flash runs with --strict-mcp-config).",
      scope: "claude-code" as const,
      readOnly: true,
    }));
  } catch {
    return [];
  }
}

export function getMcpServers(): McpServerConfig[] {
  let configured: McpServerConfig[] = [];
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".hivematrix", "config.json"), "utf-8"));
    configured = parseMcpServers(cfg?.mcpServers);
  } catch { /* none */ }

  // Auto-register the Azure DevOps MCP server when the `ado` feature flag is on
  // and an org is configured.
  const ado = adoMcpServer();
  if (ado && !configured.some((s) => s.name === ado.name)) configured.push({ ...ado, scope: ado.scope ?? "auto" });

  // Always-on internal server backing the in-app chat itself.
  if (!configured.some((s) => s.name === FLASH_SERVER_NAME)) configured.push(flashInternalServer());

  // Informational reflection of Claude Code's registry (e.g. canopy) — never
  // shadows a real config.json/auto entry of the same name.
  for (const s of claudeCodeServers()) {
    if (!configured.some((c) => c.name === s.name)) configured.push(s);
  }

  return configured.sort((a, b) => a.name.localeCompare(b.name));
}

export type McpStatus = "reachable" | "unreachable" | "configured";

export interface McpServerStatus extends McpServerConfig {
  status: McpStatus;
  detail: string;
  /** Whether a restart action applies (HTTP/SSE managed endpoints). */
  restartable: boolean;
}

/** Probe one server's status. HTTP/SSE → reachability; stdio → configured.
 *  `readOnly` entries (internal flash, ~/.claude.json reflections) are never
 *  restartable from here regardless of transport — HiveMatrix doesn't own them. */
export async function probeMcpServer(s: McpServerConfig, opts: { signal?: AbortSignal } = {}): Promise<McpServerStatus> {
  if ((s.transport === "http" || s.transport === "sse") && s.url) {
    try {
      const res = await fetch(s.url, { method: "GET", signal: opts.signal ?? AbortSignal.timeout(4_000) });
      // Any HTTP response (even 4xx) means the server is up and listening.
      return { ...s, status: "reachable", detail: `HTTP ${res.status}`, restartable: !s.readOnly };
    } catch (err) {
      return { ...s, status: "unreachable", detail: err instanceof Error ? err.message : String(err), restartable: !s.readOnly };
    }
  }
  const detail = s.readOnly
    ? (s.description ?? "informational — not managed by HiveMatrix")
    : "stdio server — launched per session by the executor";
  return { ...s, status: "configured", detail, restartable: false };
}

export async function listMcpStatus(): Promise<McpServerStatus[]> {
  return Promise.all(getMcpServers().map((s) => probeMcpServer(s)));
}
