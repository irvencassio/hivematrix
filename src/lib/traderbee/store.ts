/**
 * TraderBee watchlist + alert-dedup state — a small JSON file under ~/.hivematrix
 * (no DB migration). Holds the watchlist (symbol + rules) and a fired-alert
 * ledger so an alert notifies once per crossing, not every poll.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { normalizeSymbol, parseWatchRule, type WatchItem, type WatchRule } from "./contracts";

interface State {
  watch: WatchItem[];
  fired: Record<string, string>; // key → ISO of last notification
  lastPollAt: string | null;
  lastError: string | null;
}

function statePath(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "traderbee.json");
}

function read(): State {
  try {
    const s = JSON.parse(readFileSync(statePath(), "utf-8"));
    return {
      watch: Array.isArray(s.watch) ? s.watch : [],
      fired: s.fired && typeof s.fired === "object" ? s.fired : {},
      lastPollAt: typeof s.lastPollAt === "string" ? s.lastPollAt : null,
      lastError: typeof s.lastError === "string" ? s.lastError : null,
    };
  } catch {
    return { watch: [], fired: {}, lastPollAt: null, lastError: null };
  }
}

function write(s: State): void {
  writeFileSync(statePath(), JSON.stringify(s));
}

export function getWatchlist(): WatchItem[] {
  return read().watch;
}

/** Add/replace a watched symbol with its rules. Returns the normalized item. */
export function upsertWatch(symbolRaw: string, rulesRaw: unknown[]): WatchItem | null {
  const symbol = normalizeSymbol(symbolRaw);
  if (!symbol) return null;
  const rules = rulesRaw.map(parseWatchRule).filter((r): r is WatchRule => r !== null);
  const s = read();
  s.watch = s.watch.filter((w) => w.symbol !== symbol);
  const item = { symbol, rules };
  s.watch.push(item);
  write(s);
  return item;
}

export function removeWatch(symbolRaw: string): boolean {
  const symbol = normalizeSymbol(symbolRaw);
  const s = read();
  const before = s.watch.length;
  s.watch = s.watch.filter((w) => w.symbol !== symbol);
  if (s.watch.length === before) return false;
  write(s);
  return true;
}

/** Was this alert key notified within the window? (default 24h) */
export function wasFiredRecently(key: string, nowIso: string, withinHours = 24): boolean {
  const at = read().fired[key];
  if (!at) return false;
  return Date.parse(nowIso) - Date.parse(at) < withinHours * 3_600_000;
}

export function recordFired(key: string, nowIso: string): void {
  const s = read();
  s.fired[key] = nowIso;
  // bound the ledger
  const keys = Object.keys(s.fired);
  if (keys.length > 2_000) for (const k of keys.slice(0, keys.length - 2_000)) delete s.fired[k];
  write(s);
}

export function recordPoll(nowIso: string, error: string | null): void {
  const s = read();
  s.lastPollAt = nowIso;
  s.lastError = error;
  write(s);
}

export function getTraderBeeState(): { watchCount: number; lastPollAt: string | null; lastError: string | null } {
  const s = read();
  return { watchCount: s.watch.length, lastPollAt: s.lastPollAt, lastError: s.lastError };
}
