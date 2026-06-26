import type { TermRunResult, TermSessionInfo } from "./contracts";
import {
  createSession as createLocalSession,
  killSession as killLocalSession,
  listSessions as listLocalSessions,
  runCommand as runLocalCommand,
} from "./session";

export interface LocalTermBeeClient {
  createSession(opts: { id?: string; cwd?: string; profileId?: string; openCommand?: string }): string;
  listSessions(): TermSessionInfo[];
  killSession(id: string): boolean;
  runCommand(id: string, command: string, timeoutMs?: number): Promise<TermRunResult>;
}

/**
 * Terminal Lane provider — a thin async facade over the in-process shell engine
 * (`session.ts`). HiveMatrix-owned and self-contained: real shells, no native
 * deps, no external provider. The async interface is kept so callers don't change
 * if the engine ever grows remote/host-bound sessions.
 */
export interface TermBeeProvider {
  createSession(opts?: { id?: string; cwd?: string; profileId?: string; openCommand?: string }): Promise<string>;
  listSessions(): Promise<TermSessionInfo[]>;
  killSession(id: string): Promise<boolean>;
  runCommand(id: string, command: string, timeoutMs?: number): Promise<TermRunResult>;
}

interface ProviderOptions {
  local?: LocalTermBeeClient;
}

function defaultLocalClient(): LocalTermBeeClient {
  return {
    createSession: (opts) => createLocalSession(opts),
    listSessions: () => listLocalSessions(),
    killSession: (id) => killLocalSession(id),
    runCommand: (id, command, timeoutMs) => runLocalCommand(id, command, timeoutMs),
  };
}

export function createTermBeeProvider(opts: ProviderOptions = {}): TermBeeProvider {
  const local = opts.local ?? defaultLocalClient();
  return {
    async createSession(sessionOpts = {}) {
      return local.createSession(sessionOpts);
    },
    async listSessions() {
      return local.listSessions();
    },
    async killSession(id: string) {
      return local.killSession(id);
    },
    async runCommand(id: string, command: string, timeoutMs?: number) {
      return local.runCommand(id, command, timeoutMs);
    },
  };
}

export const defaultTermBeeProvider = createTermBeeProvider();
