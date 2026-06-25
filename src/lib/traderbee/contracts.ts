/**
 * Market Insight Lane — market-data watch + alerts. ANALYSIS & ALERTS ONLY.
 * Market Insight Lane NEVER places trades, submits orders, or moves money;
 * it only reads quotes and notifies. Pure types + alert evaluation here.
 */

export type WatchRuleType = "above" | "below" | "pct_move";

export interface WatchRule {
  type: WatchRuleType;
  /** Price threshold for above/below; absolute percent for pct_move. */
  value: number;
}

export interface WatchItem {
  symbol: string;
  rules: WatchRule[];
}

export interface Quote {
  symbol: string;
  price: number;
  /** Previous close, for pct_move. */
  prevClose?: number;
}

export interface FiredAlert {
  symbol: string;
  ruleType: WatchRuleType;
  value: number;
  price: number;
  message: string;
  /** Stable key for once-per-crossing de-dup. */
  key: string;
}

export function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 12);
}

/** Pure: which rules fire for this quote. */
export function evaluateAlerts(quote: Quote, rules: WatchRule[]): FiredAlert[] {
  const out: FiredAlert[] = [];
  const fire = (type: WatchRuleType, value: number, message: string) =>
    out.push({ symbol: quote.symbol, ruleType: type, value, price: quote.price, message, key: `${quote.symbol}:${type}:${value}` });

  for (const r of rules) {
    if (r.type === "above" && quote.price >= r.value) {
      fire("above", r.value, `${quote.symbol} is at ${quote.price} — at/above ${r.value}`);
    } else if (r.type === "below" && quote.price <= r.value) {
      fire("below", r.value, `${quote.symbol} is at ${quote.price} — at/below ${r.value}`);
    } else if (r.type === "pct_move" && typeof quote.prevClose === "number" && quote.prevClose > 0) {
      const pct = ((quote.price - quote.prevClose) / quote.prevClose) * 100;
      if (Math.abs(pct) >= r.value) {
        fire("pct_move", r.value, `${quote.symbol} moved ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% (≥ ${r.value}%) to ${quote.price}`);
      }
    }
  }
  return out;
}

export function parseWatchRule(raw: unknown): WatchRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  const value = typeof r.value === "number" ? r.value : Number(r.value);
  if ((type === "above" || type === "below" || type === "pct_move") && Number.isFinite(value) && value > 0) {
    return { type, value };
  }
  return null;
}
