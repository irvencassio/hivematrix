/**
 * Terminal Lane app client — POSTs terminal operations to the visible Terminal
 * Lane app (default http://127.0.0.1:4012), the ONE app per lane the operator
 * can watch. The daemon prefers this over the in-process shell engine so agent
 * commands run where they can be seen; the provider falls back to the local
 * engine when the app is not running (see provider.ts).
 */

import type { TermRunResult, TermSessionInfo } from "./contracts";

const DEFAULT_TERMINAL_LANE_BASE_URL = "http://127.0.0.1:4012";

export function resolveTerminalLaneBaseUrl(): string {
  const configured = process.env.TERMINAL_LANE_BASE_URL?.trim();
  return (configured && configured.length > 0 ? configured : DEFAULT_TERMINAL_LANE_BASE_URL).replace(/\/$/, "");
}

export interface TerminalLaneAppClient {
  createSession(opts: { id?: string; cwd?: string; profileId?: string; openCommand?: string }): Promise<string>;
  listSessions(): Promise<TermSessionInfo[]>;
  killSession(id: string): Promise<boolean>;
  runCommand(id: string, command: string, timeoutMs?: number): Promise<TermRunResult>;
}

async function postJson(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const res = await fetch(`${resolveTerminalLaneBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Terminal Lane app returned HTTP ${res.status}`);
  return res.json();
}

export function createTerminalLaneAppClient(): TerminalLaneAppClient {
  return {
    async createSession(opts) {
      const data = await postJson("/session", { action: "create", sessionId: opts.id, cwd: opts.cwd }, 10_000) as { id?: string };
      if (!data.id) throw new Error("Terminal Lane app did not return a session id");
      return data.id;
    },
    async listSessions() {
      const data = await postJson("/session", { action: "list" }, 10_000) as { sessions?: TermSessionInfo[] };
      return Array.isArray(data.sessions) ? data.sessions : [];
    },
    async killSession(id) {
      const data = await postJson("/session", { action: "kill", sessionId: id }, 10_000) as { killed?: boolean };
      return data.killed === true;
    },
    async runCommand(id, command, timeoutMs) {
      // Give the HTTP call headroom beyond the command's own timeout so a slow
      // command completes rather than the fetch aborting first.
      const budget = (timeoutMs ?? 120_000) + 10_000;
      const data = await postJson("/run", { sessionId: id, command, timeoutMs }, budget) as Partial<TermRunResult>;
      return {
        output: typeof data.output === "string" ? data.output : "",
        exitCode: typeof data.exitCode === "number" ? data.exitCode : null,
        timedOut: data.timedOut === true,
      };
    },
  };
}
