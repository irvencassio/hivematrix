/**
 * Watcher state — which playlist videos we've already seen (so we don't
 * re-summarize) and which have had their brain doc written (so we write once).
 * A small JSON file under ~/.hivematrix (no DB migration needed). Bounded.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface State {
  seen: string[];
  written: string[];
  lastError: string | null;
  lastPollAt: string | null;
}

const MAX_IDS = 5_000;

function statePath(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "youtube-state.json");
}

function read(): State {
  try {
    const s = JSON.parse(readFileSync(statePath(), "utf-8"));
    return {
      seen: Array.isArray(s.seen) ? s.seen : [],
      written: Array.isArray(s.written) ? s.written : [],
      lastError: typeof s.lastError === "string" ? s.lastError : null,
      lastPollAt: typeof s.lastPollAt === "string" ? s.lastPollAt : null,
    };
  } catch {
    return { seen: [], written: [], lastError: null, lastPollAt: null };
  }
}

function write(s: State): void {
  writeFileSync(statePath(), JSON.stringify({
    seen: s.seen.slice(-MAX_IDS),
    written: s.written.slice(-MAX_IDS),
    lastError: s.lastError,
    lastPollAt: s.lastPollAt,
  }));
}

export function seenIds(): Set<string> {
  return new Set(read().seen);
}

export function markSeen(ids: string[]): void {
  if (ids.length === 0) return;
  const s = read();
  const set = new Set(s.seen);
  for (const id of ids) set.add(id);
  s.seen = [...set];
  write(s);
}

export function isWritten(id: string): boolean {
  return read().written.includes(id);
}

export function markWritten(id: string): void {
  const s = read();
  if (!s.written.includes(id)) {
    s.written.push(id);
    write(s);
  }
}

export function recordPoll(error: string | null): void {
  const s = read();
  s.lastPollAt = new Date().toISOString();
  s.lastError = error;
  write(s);
}

export function getWatcherState(): { seenCount: number; writtenCount: number; lastError: string | null; lastPollAt: string | null } {
  const s = read();
  return { seenCount: s.seen.length, writtenCount: s.written.length, lastError: s.lastError, lastPollAt: s.lastPollAt };
}
