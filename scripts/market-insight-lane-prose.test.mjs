import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("market-data source comments use Market Insight Lane prose", () => {
  const contracts = read("src/lib/traderbee/contracts.ts");
  const provider = read("src/lib/traderbee/provider.ts");
  const poller = read("src/lib/traderbee/poller.ts");
  const store = read("src/lib/traderbee/store.ts");
  const server = read("src/daemon/server.ts");

  assert.match(contracts, /Market Insight Lane — market-data watch \+ alerts/);
  assert.match(contracts, /Market Insight Lane NEVER places trades/);
  assert.doesNotMatch(contracts, /TraderBee — market-data watch \+ alerts|TraderBee as a whole/);

  assert.match(provider, /Market Insight Lane reads quotes/);
  assert.doesNotMatch(provider, /TraderBee reads quotes/);

  assert.match(poller, /Market Insight Lane poll loop/);
  assert.doesNotMatch(poller, /TraderBee poll loop/);

  assert.match(store, /Market Insight Lane watchlist \+ alert-dedup state/);
  assert.doesNotMatch(store, /TraderBee watchlist \+ alert-dedup state/);

  assert.match(server, /GET \/traderbee — Market Insight Lane watch\/alert status/);
  assert.match(server, /POST \/traderbee\/poll — evaluate the Market Insight Lane watchlist now/);
  assert.doesNotMatch(server, /GET \/traderbee — watch\/alert status|POST \/traderbee\/poll — evaluate the watchlist now/);
});
