import test from "node:test";
import assert from "node:assert/strict";
import { requestBrowserLaneRead } from "./read-client";

test("requestBrowserLaneRead bounds the fetch with an abort timeout", async (t) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  await requestBrowserLaneRead({ requestedBy: "test", project: "inbox", query: "current weather" });

  assert.equal(calls.length, 1);
  // A hung Browser Lane service must not stall the calling agent task forever.
  assert.ok(calls[0].init.signal instanceof AbortSignal, "fetch must carry an AbortSignal timeout");
});
