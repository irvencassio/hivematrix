import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanopyActSteps,
  requestCanopyBrowserAct,
  resolveBrowserLaneEngine,
  resolveCanopyBrowserBaseUrl,
  summarizeCanopyActResult,
  type CanopyActResult,
} from "./canopy-client";

test("requestCanopyBrowserAct posts the /act envelope with action + requester and a bounded timeout", async (t) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  await requestCanopyBrowserAct({
    action: "authenticated_research",
    requester: "hivematrix",
    steps: [{ action: "navigate", url: "https://example.com" }, { action: "extract" }],
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/act$/, "the client must target the app's /act endpoint");
  // A hung app must not stall the calling agent task forever.
  assert.ok(calls[0].init.signal instanceof AbortSignal, "fetch must carry an AbortSignal timeout");
  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.equal(body.action, "authenticated_research");
  assert.equal(body.requester, "hivematrix");
  assert.equal((body.steps as unknown[]).length, 2);
});

test("resolveCanopyBrowserBaseUrl defaults to loopback :4021 and honours CANOPY_BROWSER_BASE_URL", (t) => {
  const original = process.env.CANOPY_BROWSER_BASE_URL;
  t.after(() => {
    if (original === undefined) delete process.env.CANOPY_BROWSER_BASE_URL;
    else process.env.CANOPY_BROWSER_BASE_URL = original;
  });

  delete process.env.CANOPY_BROWSER_BASE_URL;
  assert.equal(resolveCanopyBrowserBaseUrl(), "http://127.0.0.1:4021");

  process.env.CANOPY_BROWSER_BASE_URL = "http://127.0.0.1:9999/";
  assert.equal(resolveCanopyBrowserBaseUrl(), "http://127.0.0.1:9999", "a trailing slash must be trimmed");
});

test("resolveBrowserLaneEngine defaults to canopy and honours an explicit desktop rollback", () => {
  // T6 step 6: absent (or unreadable) config means the Canopy Browser app.
  assert.equal(resolveBrowserLaneEngine({}), "canopy");
  assert.equal(resolveBrowserLaneEngine({ browserLane: {} }), "canopy");
  assert.equal(resolveBrowserLaneEngine({ browserLane: { engine: "nonsense" } }), "canopy");
  assert.equal(resolveBrowserLaneEngine({ browserLane: { engine: "canopy" } }), "canopy");
  // The one-edit rollback lever.
  assert.equal(resolveBrowserLaneEngine({ browserLane: { engine: " Desktop " } }), "desktop");
});

test("buildCanopyActSteps navigates then extracts when no structured steps are given", () => {
  const plan = buildCanopyActSteps({ startUrl: "https://example.com/page" });
  assert.deepEqual(plan.steps, [
    { action: "navigate", url: "https://example.com/page" },
    { action: "extract" },
  ]);
  assert.deepEqual(plan.unexecutable, []);
});

test("buildCanopyActSteps reports prose steps as unexecutable instead of silently dropping them", () => {
  const plan = buildCanopyActSteps({
    startUrl: "https://example.com/",
    steps: ["click the invitations tab", "read the first three names"],
  });
  assert.deepEqual(plan.steps, [
    { action: "navigate", url: "https://example.com/" },
    { action: "extract" },
  ]);
  assert.deepEqual(plan.unexecutable, ["click the invitations tab", "read the first three names"]);
});

test("buildCanopyActSteps passes structured steps through and keeps a leading navigate", () => {
  const plan = buildCanopyActSteps({
    startUrl: "https://example.com/",
    steps: [
      { action: "waitFor", selector: "#app", timeoutMs: 5000 },
      { action: "click", selector: "button.next" },
    ],
  });
  assert.deepEqual(plan.steps, [
    { action: "navigate", url: "https://example.com/" },
    { action: "waitFor", selector: "#app", timeoutMs: 5000 },
    { action: "click", selector: "button.next" },
    { action: "extract" },
  ]);
});

test("buildCanopyActSteps does not double a navigate the caller already supplied", () => {
  const plan = buildCanopyActSteps({
    startUrl: "https://example.com/",
    steps: [{ action: "navigate", url: "https://other.example/" }, { action: "extract" }],
  });
  assert.deepEqual(plan.steps, [
    { action: "navigate", url: "https://other.example/" },
    { action: "extract" },
  ]);
});

test("summarizeCanopyActResult renders per-step outcomes and the final page", () => {
  const result: CanopyActResult = {
    ok: true,
    failedStep: null,
    steps: [
      { index: 0, action: "navigate", ok: true, detail: "navigated to https://example.com" },
      { index: 1, action: "extract", ok: true, detail: "extracted 129 chars, 1 links" },
    ],
    finalPage: {
      url: "https://example.com/",
      title: "Example Domain",
      text: "Example Domain",
      links: [{ title: "Learn more", url: "https://iana.org/domains/example" }],
    },
    refusal: null,
    humanLoginRequired: null,
  };
  const text = summarizeCanopyActResult(result);
  assert.match(text, /✓ \[0\] navigate/);
  assert.match(text, /✓ \[1\] extract/);
  assert.match(text, /Final page: Example Domain — https:\/\/example\.com\//);
  assert.match(text, /Learn more/);
});
