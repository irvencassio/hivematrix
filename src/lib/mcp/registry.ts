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

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
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
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
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
  if (ado && !configured.some((s) => s.name === ado.name)) configured.push(ado);

  return configured.sort((a, b) => a.name.localeCompare(b.name));
}

export type McpStatus = "reachable" | "unreachable" | "configured";

export interface McpServerStatus extends McpServerConfig {
  status: McpStatus;
  detail: string;
  /** Whether a restart action applies (HTTP/SSE managed endpoints). */
  restartable: boolean;
}

/** Probe one server's status. HTTP/SSE → reachability; stdio → configured. */
export async function probeMcpServer(s: McpServerConfig, opts: { signal?: AbortSignal } = {}): Promise<McpServerStatus> {
  if ((s.transport === "http" || s.transport === "sse") && s.url) {
    try {
      const res = await fetch(s.url, { method: "GET", signal: opts.signal ?? AbortSignal.timeout(4_000) });
      // Any HTTP response (even 4xx) means the server is up and listening.
      return { ...s, status: "reachable", detail: `HTTP ${res.status}`, restartable: true };
    } catch (err) {
      return { ...s, status: "unreachable", detail: err instanceof Error ? err.message : String(err), restartable: true };
    }
  }
  return { ...s, status: "configured", detail: "stdio server — launched per session by the executor", restartable: false };
}

export async function listMcpStatus(): Promise<McpServerStatus[]> {
  return Promise.all(getMcpServers().map((s) => probeMcpServer(s)));
}
