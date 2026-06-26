import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBrowserReadinessState,
  normalizeBrowserSite,
  normalizeReadinessProbe,
} from "./contracts";

test("browser site stores keychain references but no secret values", () => {
  const site = normalizeBrowserSite({
    id: "heygen",
    displayName: "HeyGen",
    homeUrl: "https://app.heygen.com/home",
    loginUrl: "https://app.heygen.com/login",
    allowedDomains: ["app.heygen.com"],
    credentialRef: "hivematrix.browser.heygen.primary",
  });
  assert.equal(site.credentialRef, "hivematrix.browser.heygen.primary");
  assert.deepEqual(site.allowedDomains, ["app.heygen.com"]);
});

test("readiness states map to green yellow orange red semantics", () => {
  assert.equal(normalizeBrowserReadinessState("ready").color, "green");
  assert.equal(normalizeBrowserReadinessState("needs_reauth").color, "orange");
  assert.equal(normalizeBrowserReadinessState("probe_failed").color, "yellow");
  assert.equal(normalizeBrowserReadinessState("blocked").color, "red");
});

test("browser site accepts SSO strategies and a non-secret provider account", () => {
  const ssoSite = normalizeBrowserSite({
    id: "heygen",
    displayName: "HeyGen",
    homeUrl: "https://app.heygen.com/home",
    loginUrl: "https://app.heygen.com/login",
    allowedDomains: ["app.heygen.com", "accounts.google.com", "google.com"],
    authStrategy: "google_sso",
    providerAccount: "cassio.irv@gmail.com",
  });
  assert.equal(ssoSite.authStrategy, "google_sso");
  assert.equal(ssoSite.providerAccount, "cassio.irv@gmail.com");
  assert.equal(ssoSite.credentialRef, null);

  const microsoft = normalizeBrowserSite({
    id: "entra",
    displayName: "Entra",
    homeUrl: "https://portal.example.com",
    allowedDomains: ["portal.example.com", "login.microsoftonline.com"],
    authStrategy: "microsoft_sso",
  });
  assert.equal(microsoft.authStrategy, "microsoft_sso");
  assert.equal(microsoft.providerAccount, null);
});

test("browser site rejects inline secret-looking values", () => {
  assert.throws(
    () => normalizeBrowserSite({
      id: "bad",
      displayName: "Bad",
      homeUrl: "https://example.com",
      allowedDomains: ["example.com"],
      password: "nope",
    }),
    /secret/i,
  );
});

test("readiness probe normalizes assertions", () => {
  const probe = normalizeReadinessProbe({
    id: "heygen-dashboard",
    siteId: "heygen",
    name: "Dashboard",
    url: "https://app.heygen.com/home",
    assertions: [
      { kind: "text", value: "Create video" },
      { kind: "url_contains", value: "/home" },
    ],
  });
  assert.equal(probe.assertions.length, 2);
  assert.equal(probe.assertions[0].kind, "text");
});
