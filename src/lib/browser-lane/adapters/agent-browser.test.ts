import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentBrowserSnapshot, createAgentBrowserAdapter, type FetchPage } from "./agent-browser";

// ── Snapshot extractor ────────────────────────────────────────────────

test("extracts title and text from a plain public page", () => {
  const html = `<!DOCTYPE html><html><head><title>Acme &amp; Co</title>
    <style>.x{color:red}</style><script>var s = "ignore me";</script></head>
    <body><h1>Welcome</h1><p>Create video now.</p></body></html>`;
  const snap = buildAgentBrowserSnapshot("https://acme.example/home", html);
  assert.equal(snap.url, "https://acme.example/home");
  assert.equal(snap.title, "Acme & Co");
  assert.match(snap.text, /Welcome/);
  assert.match(snap.text, /Create video now/);
  assert.doesNotMatch(snap.text, /ignore me/);   // scripts stripped
  assert.doesNotMatch(snap.text, /color:red/);    // styles stripped
  assert.equal(snap.state, "unknown");            // no login wall, no session proof
});

test("a login form is detected as unauthenticated with a labeled password field", () => {
  const html = `<html><head><title>Sign in</title></head><body>
    <form action="/login">
      <label for="email">Email address</label>
      <input id="email" name="email" type="email" />
      <label for="pw">Password</label>
      <input id="pw" name="password" type="password" />
      <button type="submit">Log in</button>
    </form></body></html>`;
  const snap = buildAgentBrowserSnapshot("https://app.example/login", html);
  assert.equal(snap.state, "unauthenticated");
  assert.equal(snap.forms.length, 1);
  assert.equal(snap.forms[0].purpose, "login");
  const pw = snap.forms[0].fields.find((f) => f.kind === "password");
  assert.ok(pw, "password field present");
  assert.equal(pw.label, "Password");
  const email = snap.forms[0].fields.find((f) => f.ref === "email");
  assert.equal(email?.label, "Email address");
});

test("never reports authenticated (a cookieless fetch cannot prove a session)", () => {
  const html = `<html><head><title>Dashboard</title></head><body>Welcome back, you are logged in.</body></html>`;
  const snap = buildAgentBrowserSnapshot("https://app.example/home", html);
  assert.notEqual(snap.state, "authenticated");
});

test("extracts link and button actions", () => {
  const html = `<html><body>
    <a href="/pricing">Pricing</a>
    <a href="/docs">Docs</a>
    <button>Start trial</button>
    <input type="submit" value="Submit form" />
  </body></html>`;
  const snap = buildAgentBrowserSnapshot("https://acme.example/", html);
  const texts = snap.actions.map((a) => a.text);
  assert.ok(texts.includes("Pricing"));
  assert.ok(texts.includes("Docs"));
  assert.ok(texts.includes("Start trial"));
  assert.ok(texts.includes("Submit form"));
  assert.ok(snap.actions.some((a) => a.kind === "link"));
  assert.ok(snap.actions.some((a) => a.kind === "button"));
});

test("redacts password/token/cookie-looking values from snapshot text", () => {
  const html = `<html><head><title>Leaky</title></head><body>
    <p>debug: password=hunter2 token=abc.def-123</p>
    <p>Authorization: Bearer secretBearerXYZ</p>
    <p>set-cookie: session=topsecretcookie</p>
  </body></html>`;
  const snap = buildAgentBrowserSnapshot("https://acme.example/debug", html);
  for (const leak of ["hunter2", "abc.def-123", "secretBearerXYZ", "topsecretcookie"]) {
    assert.ok(!snap.text.includes(leak), `text must not leak "${leak}" — got: ${snap.text}`);
  }
  assert.match(snap.text, /\[redacted\]/);
});

// ── Adapter (injected fetch — deterministic, offline) ─────────────────

function fakeFetch(html: string, finalUrl = "https://acme.example/home"): FetchPage {
  return async () => ({ ok: true, status: 200, finalUrl, html });
}

test("createAgentBrowserAdapter open+snapshot works for a basic page (no unavailable stub)", async () => {
  const adapter = createAgentBrowserAdapter({ fetchPage: fakeFetch("<html><head><title>Home</title></head><body>Create video</body></html>") });
  const open = await adapter.open({ url: "https://acme.example/home" });
  assert.equal(open.ok, true);
  assert.ok(open.pageId);
  const snap = await adapter.snapshot({ pageId: open.pageId });
  assert.equal(snap.title, "Home");
  assert.match(snap.text, /Create video/);
  // Crucially NOT the unavailable stub text.
  assert.doesNotMatch(snap.text, /not wired yet/i);
});

test("open rejects non-http(s) URLs and surfaces fetch failures honestly", async () => {
  const adapter = createAgentBrowserAdapter({ fetchPage: async () => ({ ok: false, error: "network down" }) });
  const bad = await adapter.open({ url: "file:///etc/passwd" });
  assert.equal(bad.ok, false);
  assert.match(bad.error ?? "", /http/i);

  const failed = await adapter.open({ url: "https://acme.example/home" });
  assert.equal(failed.ok, false);
  assert.match(failed.error ?? "", /network down/);
  assert.doesNotMatch(failed.error ?? "", /not wired yet/i);
});

test("act is read-only in the MVP (credential_fill unsupported, no bypass)", async () => {
  const adapter = createAgentBrowserAdapter({ fetchPage: fakeFetch("<html></html>") });
  const fill = await adapter.act({ type: "credential_fill", credentialRef: "hivematrix.browser.x.primary" });
  assert.equal(fill.ok, false);
  assert.match(fill.error ?? "", /read-only|not supported|unsupported/i);
});
