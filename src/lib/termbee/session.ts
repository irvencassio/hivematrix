/**
 * Terminal Lane session manager — long-lived shell sessions the agent can drive across
 * turns. Real shells (no native deps), one command at a time per session, output
 * read back via the completion marker. State (cwd, env, shell vars) persists
 * between commands, so a multi-step build behaves like a real terminal. Works in
 * every connectivity mode — the offline workhorse.
 */

import { spawn, type ChildProcess } from "child_process";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { makeMarker, buildCommandPayload, extractResult, type TermSessionInfo, type TermRunResult } from "./contracts";

const SCROLLBACK_CAP = 200_000; // chars retained per session
const DEFAULT_TIMEOUT_MS = 120_000;

interface Session {
  id: string;
  cwd: string;
  proc: ChildProcess;
  scrollback: string;
  alive: boolean;
  createdAt: string;
  busy: boolean;
}

const sessions = new Map<string, Session>();

function appendScrollback(s: Session, chunk: string): void {
  s.scrollback += chunk;
  if (s.scrollback.length > SCROLLBACK_CAP) s.scrollback = s.scrollback.slice(-SCROLLBACK_CAP);
}

/** Create a new shell session. Returns its id. */
export function createSession(opts: { id?: string; cwd?: string } = {}): string {
  const id = opts.id ?? `term_${randomBytes(5).toString("hex")}`;
  const cwd = opts.cwd ?? homedir();
  // bash with no rc → clean, deterministic; reads commands from stdin.
  const proc = spawn("/bin/bash", ["--norc", "--noprofile"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  const s: Session = { id, cwd, proc, scrollback: "", alive: true, createdAt: new Date().toISOString(), busy: false };
  proc.stdout?.on("data", (b: Buffer) => appendScrollback(s, b.toString("utf-8")));
  proc.stderr?.on("data", (b: Buffer) => appendScrollback(s, b.toString("utf-8")));
  proc.on("exit", () => { s.alive = false; });
  sessions.set(id, s);
  return id;
}

export function listSessions(): TermSessionInfo[] {
  return [...sessions.values()].map((s) => ({ id: s.id, cwd: s.cwd, alive: s.alive, createdAt: s.createdAt }));
}

export function readScrollback(id: string, lastChars = 8_000): string | null {
  const s = sessions.get(id);
  if (!s) return null;
  return s.scrollback.slice(-lastChars);
}

export function killSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  try { s.proc.kill("SIGKILL"); } catch { /* gone */ }
  sessions.delete(id);
  return true;
}

export function killAllSessions(): void {
  for (const id of [...sessions.keys()]) killSession(id);
}

/**
 * Run a command in a session and wait for it to finish (combined stdout+stderr +
 * exit code). Serialized per session. Creates the session on demand if missing.
 */
export function runCommand(
  id: string,
  cmd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TermRunResult> {
  let s = sessions.get(id);
  if (!s) { createSession({ id }); s = sessions.get(id)!; }
  if (!s.alive) return Promise.resolve({ output: "(session is dead)", exitCode: null, timedOut: false });
  if (s.busy) return Promise.resolve({ output: "(session busy with another command)", exitCode: null, timedOut: false });

  const session = s;
  session.busy = true;
  const marker = makeMarker(randomBytes(4).toString("hex"));
  const startLen = session.scrollback.length;

  return new Promise<TermRunResult>((resolve) => {
    let settled = false;
    const finish = (r: TermRunResult) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      session.busy = false;
      resolve(r);
    };
    // Poll the scrollback (which the stdout/stderr handlers fill) for the marker.
    const poll = setInterval(() => {
      const since = session.scrollback.slice(startLen);
      const res = extractResult(since, marker);
      if (res) finish({ output: res.output.trimEnd(), exitCode: res.exitCode, timedOut: false });
    }, 50);
    const timer = setTimeout(() => {
      const since = session.scrollback.slice(startLen);
      finish({ output: since.trimEnd(), exitCode: null, timedOut: true });
    }, timeoutMs);

    try {
      session.proc.stdin?.write(buildCommandPayload(cmd, marker));
    } catch (err) {
      finish({ output: `(write failed: ${err instanceof Error ? err.message : String(err)})`, exitCode: null, timedOut: false });
    }
  });
}
