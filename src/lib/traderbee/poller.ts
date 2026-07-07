/**
 * Market Insight Lane poll loop — fetch quotes for the watchlist, evaluate alert rules,
 * notify on new crossings (deduped). DATA + ALERTS ONLY; never trades. Self-gates
 * on Alpaca keys + a non-empty watchlist.
 */

import { notify } from "@/lib/notify/notify";
import { evaluateAlerts } from "./contracts";
import { fetchQuotes, isTraderBeeConfigured } from "./provider";
import { getWatchlist, wasFiredRecently, recordFired, recordPoll } from "./store";
import { startPollLoop } from "@/lib/lanes/poll-loop";

const POLL_INTERVAL_MS = 5 * 60_000; // 5 min — IEX data, gentle on the free tier

export async function pollOnce(now: () => string = () => new Date().toISOString()): Promise<void> {
  if (!isTraderBeeConfigured()) return;
  const watch = getWatchlist();
  if (watch.length === 0) return;

  const nowIso = now();
  try {
    const quotes = await fetchQuotes(watch.map((w) => w.symbol));
    if (!quotes) {
      recordPoll(nowIso, "market-data fetch failed (check Alpaca keys / rate limit)");
      return;
    }
    const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
    for (const item of watch) {
      const quote = bySymbol.get(item.symbol);
      if (!quote) continue;
      for (const alert of evaluateAlerts(quote, item.rules)) {
        if (wasFiredRecently(alert.key, nowIso)) continue;
        recordFired(alert.key, nowIso);
        await notify(`📈 ${alert.message}`);
      }
    }
    recordPoll(nowIso, null);
  } catch (err) {
    recordPoll(nowIso, err instanceof Error ? err.message : String(err));
  }
}

let stopFn: (() => void) | null = null;

export function startTraderBeePoller(intervalMs = POLL_INTERVAL_MS): () => void {
  if (stopFn) return stopTraderBeePoller;
  stopFn = startPollLoop({
    name: "traderbee",
    intervalMs,
    tick: () => { if (!isTraderBeeConfigured()) return; return pollOnce(); },
  });
  return stopTraderBeePoller;
}

export function stopTraderBeePoller(): void {
  if (stopFn) { stopFn(); stopFn = null; }
}
