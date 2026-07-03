import type { TermRunResult, TermSessionInfo } from "./contracts";
import {
  createSession as createLocalSession,
  killSession as killLocalSession,
  listSessions as listLocalSessions,
  runCommand as runLocalCommand,
} from "./session";
import { createTerminalLaneAppClient, type TerminalLaneAppClient } from "./app-client";

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
  /**
   * When set, terminal operations are sent to the visible Terminal Lane app
   * first and fall back to `local` only if the app is unreachable. Omitted in
   * unit tests so they exercise the local engine deterministically.
   */
  app?: TerminalLaneAppClient;
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
  const app = opts.app;

  // Prefer the visible app (so runs are watchable); on any transport error the
  // app is treated as absent and the in-process engine takes over.
  async function viaApp<T>(run: (client: TerminalLaneAppClient) => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
    if (app) {
      try {
        return await run(app);
      } catch {
        // App not running / unreachable — fall through to the local engine.
      }
    }
    return fallback();
  }

  return {
    async createSession(sessionOpts = {}) {
      return viaApp((c) => c.createSession(sessionOpts), () => local.createSession(sessionOpts));
    },
    async listSessions() {
      return viaApp((c) => c.listSessions(), () => local.listSessions());
    },
    async killSession(id: string) {
      return viaApp((c) => c.killSession(id), () => local.killSession(id));
    },
    async runCommand(id: string, command: string, timeoutMs?: number) {
      return viaApp((c) => c.runCommand(id, command, timeoutMs), () => local.runCommand(id, command, timeoutMs));
    },
  };
}

export const defaultTermBeeProvider = createTermBeeProvider({ app: createTerminalLaneAppClient() });
