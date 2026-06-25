/**
 * Alpaca market-DATA client. ONLY the data API (data.alpaca.markets) is ever
 * called — the trading API (orders, positions, account) is NEVER touched.
 * Market Insight Lane reads quotes; it does not trade. Keys come from env vars; self-gates
 * to null when absent. Free IEX data is sufficient for watch/alerts.
 */

import { type Quote } from "./contracts";

const DATA_BASE = "https://data.alpaca.markets/v2/stocks/snapshots";

export interface TraderBeeKeys { keyId: string; secret: string; }

export function getTraderBeeKeys(env: NodeJS.ProcessEnv = process.env): TraderBeeKeys | null {
  const keyId = env.APCA_API_KEY_ID?.trim();
  const secret = env.APCA_API_SECRET_KEY?.trim();
  return keyId && secret ? { keyId, secret } : null;
}

export function isTraderBeeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getTraderBeeKeys(env) !== null;
}

interface SnapshotRaw {
  latestTrade?: { p?: number };
  dailyBar?: { c?: number };
  prevDailyBar?: { c?: number };
}

/** Pure: map one Alpaca snapshot to a Quote (latest trade price + prev close). */
export function mapSnapshot(symbol: string, raw: unknown): Quote | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as SnapshotRaw;
  const price = s.latestTrade?.p ?? s.dailyBar?.c;
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  const prevClose = typeof s.prevDailyBar?.c === "number" ? s.prevDailyBar.c : undefined;
  return { symbol, price, prevClose };
}

/** Fetch quotes for symbols via Alpaca snapshots. null on no-keys/error; [] for no symbols. */
export async function fetchQuotes(symbols: string[], opts: { signal?: AbortSignal } = {}): Promise<Quote[] | null> {
  if (symbols.length === 0) return [];
  const keys = getTraderBeeKeys();
  if (!keys) return null;
  const url = `${DATA_BASE}?symbols=${encodeURIComponent(symbols.join(","))}&feed=iex`;
  try {
    const res = await fetch(url, {
      headers: { "APCA-API-KEY-ID": keys.keyId, "APCA-API-SECRET-KEY": keys.secret },
      signal: opts.signal ?? AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    // Alpaca returns { "AAPL": {snapshot}, ... } (sometimes nested under "snapshots").
    const snaps = (data.snapshots && typeof data.snapshots === "object" ? data.snapshots : data) as Record<string, unknown>;
    const out: Quote[] = [];
    for (const sym of symbols) {
      const q = mapSnapshot(sym, snaps[sym]);
      if (q) out.push(q);
    }
    return out;
  } catch {
    return null;
  }
}
