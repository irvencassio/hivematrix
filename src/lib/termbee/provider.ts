import {
  canUseCanopyTerminal,
  invokeCanopyCapability,
  listCanopyCapabilities,
  type CanopyCapability,
  type CanopyResult,
} from "@/lib/canopy/client";
import {
  buildCommandPayload,
  extractResult,
  makeMarker,
  type TermRunResult,
  type TermSessionInfo,
} from "./contracts";
import {
  createSession as createLocalSession,
  killSession as killLocalSession,
  listSessions as listLocalSessions,
  runCommand as runLocalCommand,
} from "./session";

export interface CanopyTerminalClient {
  listCapabilities(): Promise<CanopyCapability[]>;
  invoke(
    capability: string,
    payload: Record<string, string>,
    opts?: { explicitApproval?: boolean },
  ): Promise<CanopyResult>;
}

export interface LocalTermBeeClient {
  createSession(opts: { id?: string; cwd?: string }): string;
  listSessions(): TermSessionInfo[];
  killSession(id: string): boolean;
  runCommand(id: string, command: string, timeoutMs?: number): Promise<TermRunResult>;
}

export interface TermBeeProvider {
  createSession(opts?: { id?: string; cwd?: string }): Promise<string>;
  listSessions(): Promise<TermSessionInfo[]>;
  killSession(id: string): Promise<boolean>;
  runCommand(id: string, command: string, timeoutMs?: number): Promise<TermRunResult>;
}

interface ProviderOptions {
  canopy?: CanopyTerminalClient;
  local?: LocalTermBeeClient;
  pollIntervalMs?: number;
  maxPolls?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_POLLS = 480;

function defaultCanopyClient(): CanopyTerminalClient {
  return {
    listCapabilities: () => listCanopyCapabilities(),
    invoke: (capability, payload, opts) => invokeCanopyCapability(capability, payload, opts),
  };
}

function defaultLocalClient(): LocalTermBeeClient {
  return {
    createSession: (opts) => createLocalSession(opts),
    listSessions: () => listLocalSessions(),
    killSession: (id) => killLocalSession(id),
    runCommand: (id, command, timeoutMs) => runLocalCommand(id, command, timeoutMs),
  };
}

function dataArray(result: CanopyResult): Array<Record<string, unknown>> {
  return Array.isArray(result.data) ? result.data as Array<Record<string, unknown>> : [];
}

function dataRecord(result: CanopyResult): Record<string, unknown> {
  return result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
}

function sessionIdFrom(row: Record<string, unknown>): string | null {
  return typeof row.id === "string" ? row.id : null;
}

function isConnected(row: Record<string, unknown>): boolean {
  const value = row.isConnected;
  return value === true || value === "true" || value === 1 || value === "1";
}

function textFrom(result: CanopyResult): string {
  const record = dataRecord(result);
  return typeof record.text === "string" ? record.text : "";
}

function resultError(result: CanopyResult): string | null {
  return result.error?.message ?? (result.approval ? `${result.approval.status}: ${result.approval.reason}` : null);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTermBeeProvider(opts: ProviderOptions = {}): TermBeeProvider {
  const canopy = opts.canopy ?? defaultCanopyClient();
  const local = opts.local ?? defaultLocalClient();
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = opts.maxPolls ?? DEFAULT_MAX_POLLS;
  const canopySessions = new Map<string, string>();
  let canopyAvailable = false;

  async function canUseCanopy(): Promise<boolean> {
    try {
      canopyAvailable = canUseCanopyTerminal(await canopy.listCapabilities());
    } catch {
      canopyAvailable = false;
    }
    return canopyAvailable;
  }

  async function listCanopySessionRows(): Promise<Array<Record<string, unknown>>> {
    const result = await canopy.invoke("terminal.sessions.list", {});
    const error = resultError(result);
    if (error) throw new Error(error);
    return dataArray(result);
  }

  async function openCanopyLocalSession(publicId: string): Promise<string> {
    const before = new Set((await listCanopySessionRows()).map(sessionIdFrom).filter((id): id is string => !!id));
    const opened = await canopy.invoke("terminal.session.open_local", {}, { explicitApproval: true });
    const openError = resultError(opened);
    if (openError) throw new Error(openError);
    const after = await listCanopySessionRows();
    const created = after.find((row) => {
      const id = sessionIdFrom(row);
      return id && !before.has(id) && isConnected(row);
    }) ?? after.find((row) => {
      const id = sessionIdFrom(row);
      return id && isConnected(row);
    });
    const canopyId = created ? sessionIdFrom(created) : null;
    if (!canopyId) throw new Error("Canopy did not return an open terminal session");
    canopySessions.set(publicId, canopyId);
    return publicId;
  }

  return {
    async createSession(sessionOpts = {}) {
      const publicId = sessionOpts.id ?? `term_${Date.now().toString(36)}`;
      if (await canUseCanopy()) {
        try {
          return await openCanopyLocalSession(publicId);
        } catch {
          canopyAvailable = false;
        }
      }
      return local.createSession({ ...sessionOpts, id: publicId });
    },

    async listSessions() {
      if (await canUseCanopy()) {
        try {
          const rows = await listCanopySessionRows();
          return rows.map((row) => ({
            id: sessionIdFrom(row) ?? "unknown",
            cwd: typeof row.cwd === "string" ? row.cwd : "canopy",
            alive: isConnected(row),
            createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date(0).toISOString(),
          }));
        } catch {
          canopyAvailable = false;
        }
      }
      return local.listSessions();
    },

    async killSession(id: string) {
      if (canopySessions.has(id)) {
        canopySessions.delete(id);
        return false;
      }
      return local.killSession(id);
    },

    async runCommand(id: string, command: string, timeoutMs?: number) {
      const canopyId = canopySessions.get(id);
      if (!canopyId) return local.runCommand(id, command, timeoutMs);

      const marker = makeMarker(Math.random().toString(36).slice(2, 10));
      const sent = await canopy.invoke(
        "terminal.session.send",
        { sessionID: canopyId, text: buildCommandPayload(command, marker) },
        { explicitApproval: true },
      );
      const sendError = resultError(sent);
      if (sendError) return { output: `Canopy send failed: ${sendError}`, exitCode: null, timedOut: false };

      const polls = timeoutMs ? Math.max(1, Math.ceil(timeoutMs / pollIntervalMs)) : maxPolls;
      let lastText = "";
      for (let i = 0; i < polls; i++) {
        const read = await canopy.invoke("terminal.session.read", { sessionID: canopyId, lines: "500" });
        const readError = resultError(read);
        if (readError) return { output: `Canopy read failed: ${readError}`, exitCode: null, timedOut: false };
        lastText = textFrom(read);
        const parsed = extractResult(lastText, marker);
        if (parsed) return { output: parsed.output.trimEnd(), exitCode: parsed.exitCode, timedOut: false };
        await sleep(pollIntervalMs);
      }
      return { output: lastText.trimEnd(), exitCode: null, timedOut: true };
    },
  };
}

export const defaultTermBeeProvider = createTermBeeProvider();
