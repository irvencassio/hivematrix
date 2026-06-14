import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts, normalizeSymbol, parseWatchRule } from "./contracts";
import { mapSnapshot, getTraderBeeKeys, isTraderBeeConfigured } from "./provider";

test("normalizeSymbol uppercases and strips junk", () => {
  assert.equal(normalizeSymbol(" aapl "), "AAPL");
  assert.equal(normalizeSymbol("brk.b!"), "BRK.B");
});

test("parseWatchRule accepts valid rules, rejects junk", () => {
  assert.deepEqual(parseWatchRule({ type: "above", value: 200 }), { type: "above", value: 200 });
  assert.deepEqual(parseWatchRule({ type: "pct_move", value: 5 }), { type: "pct_move", value: 5 });
  assert.equal(parseWatchRule({ type: "above", value: -1 }), null);
  assert.equal(parseWatchRule({ type: "buy", value: 1 }), null);
  assert.equal(parseWatchRule("nope"), null);
});

test("evaluateAlerts fires above/below at the threshold", () => {
  const above = evaluateAlerts({ symbol: "AAPL", price: 205 }, [{ type: "above", value: 200 }]);
  assert.equal(above.length, 1);
  assert.equal(above[0].ruleType, "above");
  assert.equal(above[0].key, "AAPL:above:200");

  assert.equal(evaluateAlerts({ symbol: "AAPL", price: 195 }, [{ type: "above", value: 200 }]).length, 0);
  assert.equal(evaluateAlerts({ symbol: "AAPL", price: 190 }, [{ type: "below", value: 200 }]).length, 1);
});

test("evaluateAlerts pct_move uses prevClose; no-op without it", () => {
  const moved = evaluateAlerts({ symbol: "TSLA", price: 110, prevClose: 100 }, [{ type: "pct_move", value: 5 }]);
  assert.equal(moved.length, 1);
  assert.match(moved[0].message, /\+10\.0%/);

  assert.equal(evaluateAlerts({ symbol: "TSLA", price: 102, prevClose: 100 }, [{ type: "pct_move", value: 5 }]).length, 0);
  assert.equal(evaluateAlerts({ symbol: "TSLA", price: 110 }, [{ type: "pct_move", value: 5 }]).length, 0, "no prevClose → no fire");
});

test("mapSnapshot reads latest trade price + prev close; null when missing", () => {
  const q = mapSnapshot("AAPL", { latestTrade: { p: 201.5 }, prevDailyBar: { c: 198 } });
  assert.deepEqual(q, { symbol: "AAPL", price: 201.5, prevClose: 198 });
  assert.equal(mapSnapshot("AAPL", {}), null);
  assert.equal(mapSnapshot("AAPL", { dailyBar: { c: 200 } })?.price, 200, "falls back to dailyBar close");
});

test("keys gate: configured only when both env vars present", () => {
  assert.equal(getTraderBeeKeys({ APCA_API_KEY_ID: "k", APCA_API_SECRET_KEY: "s" } as NodeJS.ProcessEnv)?.keyId, "k");
  assert.equal(getTraderBeeKeys({ APCA_API_KEY_ID: "k" } as NodeJS.ProcessEnv), null);
  assert.equal(isTraderBeeConfigured({} as NodeJS.ProcessEnv), false);
});
