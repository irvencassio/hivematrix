import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserLaneAdapter, PageSnapshot } from "./adapter";
import { runBrowserReadinessProbe } from "./readiness";

function adapter(snapshot: PageSnapshot): BrowserLaneAdapter {
  return {
    async open() {
      return { ok: true, pageId: "page-1" };
    },
    async snapshot() {
      return snapshot;
    },
    async act() {
      return { ok: true };
    },
    async screenshot() {
      return { ok: true, path: "/tmp/browser-lane.png" };
    },
    async close() {
      return { ok: true };
    },
  };
}

const site = {
  id: "heygen",
  displayName: "HeyGen",
  homeUrl: "https://app.heygen.com/home",
  loginUrl: "https://app.heygen.com/login",
  allowedDomains: ["app.heygen.com"],
  credentialRef: "hivematrix.browser.heygen.primary",
};

test("readiness probe returns ready when required assertions pass", async () => {
  const events: string[] = [];
  const result = await runBrowserReadinessProbe({
    site,
    probe: {
      id: "heygen-home",
      siteId: "heygen",
      name: "Home",
      url: "https://app.heygen.com/home",
      assertions: [
        { kind: "text", value: "Create video" },
        { kind: "url_contains", value: "/home" },
      ],
    },
    adapter: adapter({
      url: "https://app.heygen.com/home",
      title: "HeyGen",
      state: "authenticated",
      actions: [],
      forms: [],
      text: "Dashboard Create video Avatar",
    }),
    trace: { record: (event) => { events.push(event.eventType); } },
  });

  assert.equal(result.state.status, "ready");
  assert.equal(result.state.color, "green");
  assert.deepEqual(events, ["probe.open", "probe.snapshot", "probe.assertions", "probe.close"]);
});

test("readiness probe matches selector assertions against structured page refs and labels", async () => {
  const result = await runBrowserReadinessProbe({
    site,
    probe: {
      id: "heygen-home",
      siteId: "heygen",
      name: "Home",
      url: "https://app.heygen.com/home",
      assertions: [
        { kind: "selector", value: "button:create-video" },
        { kind: "selector", value: "login-form.email" },
      ],
    },
    adapter: adapter({
      url: "https://app.heygen.com/home",
      title: "HeyGen",
      state: "authenticated",
      actions: [{ ref: "button:create-video", kind: "button", text: "Create video" }],
      forms: [{ ref: "login-form", purpose: "login", fields: [{ ref: "login-form.email", kind: "email", label: "Email" }] }],
      text: "Dashboard",
    }),
  });

  assert.equal(result.state.status, "ready");
});

test("readiness probe fails closed for visual assertions until visual backend is wired", async () => {
  const result = await runBrowserReadinessProbe({
    site,
    probe: {
      id: "heygen-home",
      siteId: "heygen",
      name: "Home",
      url: "https://app.heygen.com/home",
      assertions: [{ kind: "visual", value: "Create video button" }],
    },
    adapter: adapter({
      url: "https://app.heygen.com/home",
      title: "HeyGen",
      state: "authenticated",
      actions: [],
      forms: [],
      text: "Create video button",
    }),
  });

  assert.equal(result.state.status, "probe_failed");
  assert.deepEqual(result.failedAssertions.map((assertion) => assertion.value), ["Create video button"]);
});

test("readiness probe reports human required for CAPTCHA or two factor pages", async () => {
  const result = await runBrowserReadinessProbe({
    site,
    probe: {
      id: "heygen-home",
      siteId: "heygen",
      name: "Home",
      url: "https://app.heygen.com/home",
      assertions: [{ kind: "text", value: "Create video" }],
    },
    adapter: adapter({
      url: "https://app.heygen.com/challenge",
      title: "Verification",
      state: "unauthenticated",
      actions: [],
      forms: [],
      text: "Enter the code from your authenticator app to continue.",
    }),
  });

  assert.equal(result.state.status, "human_required");
  assert.equal(result.humanRequired, "two_factor");
});

test("readiness probe fails closed when required assertion is missing", async () => {
  const result = await runBrowserReadinessProbe({
    site,
    probe: {
      id: "heygen-home",
      siteId: "heygen",
      name: "Home",
      url: "https://app.heygen.com/home",
      assertions: [
        { kind: "text", value: "Create video" },
        { kind: "text", value: "Optional banner", optional: true },
      ],
    },
    adapter: adapter({
      url: "https://app.heygen.com/home",
      title: "HeyGen",
      state: "authenticated",
      actions: [],
      forms: [],
      text: "Dashboard",
    }),
  });

  assert.equal(result.state.status, "probe_failed");
  assert.deepEqual(result.failedAssertions.map((assertion) => assertion.value), ["Create video"]);
});
