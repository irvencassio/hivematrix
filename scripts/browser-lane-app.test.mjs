import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const python = join(root, "assets/icon/.venv/bin/python");

function inspectPng(path) {
  const script = `
import json, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGBA")
w, h = im.size
pix = im.load()
alpha = []
for y in range(h):
  for x in range(w):
    if pix[x, y][3] > 0:
      alpha.append((x, y))
if alpha:
  xs = [p[0] for p in alpha]
  ys = [p[1] for p in alpha]
  bbox = [min(xs), min(ys), max(xs) + 1, max(ys) + 1]
else:
  bbox = None
print(json.dumps({"size": [w, h], "corner": pix[0, 0], "bbox": bbox}))
`;
  return JSON.parse(execFileSync(python, ["-c", script, path], { encoding: "utf8" }));
}

test("Browser Lane macOS app scaffold pins identity and Keychain posture", () => {
  const info = readFileSync(join(root, "browser-lane-app/Resources/Info.plist"), "utf8");
  const entitlements = readFileSync(join(root, "browser-lane-app/Resources/entitlements.plist"), "utf8");
  const runbook = readFileSync(join(root, "docs/runbooks/browser-lane-macos-app.md"), "utf8");

  assert.match(info, /com\.irvcassio\.hivematrix\.browserlane/);
  assert.match(info, /Browser Lane/);
  assert.doesNotMatch(entitlements, /keychain-access-groups/);
  assert.match(entitlements, /com\.apple\.security\.app-sandbox/);
  assert.match(runbook, /macOS Keychain/);
  assert.match(runbook, /cassio\.irv@gmail\.com/);
  assert.doesNotMatch(runbook, /password.*command line/i);
});

test("Browser Lane app has a real WebKit browser/search surface", () => {
  const browser = readFileSync(
    join(root, "browser-lane-app/Sources/BrowserLaneApp/BrowserViewController.swift"),
    "utf8",
  );
  const screens = readFileSync(join(root, "browser-lane-app/Sources/BrowserLaneApp/Screens.swift"), "utf8");
  const content = readFileSync(
    join(root, "browser-lane-app/Sources/BrowserLaneApp/ContentViewController.swift"),
    "utf8",
  );

  assert.match(browser, /import WebKit/);
  assert.match(browser, /WKWebView/);
  assert.match(browser, /NSSearchField/);
  assert.match(browser, /www\.google\.com\/search\?q=/);
  assert.match(screens, /case browser/);
  assert.match(content, /BrowserViewController/);
});

test("Browser Lane app can be packaged as a normal macOS app", () => {
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  const packagerPath = join(root, "scripts/package-browser-lane-app.mjs");
  const packager = readFileSync(packagerPath, "utf8");

  assert.ok(existsSync(packagerPath));
  assert.match(ignore, /\*\*\/\.build\//);
  assert.match(packager, /Browser Lane\.app/);
  assert.match(packager, /Info\.plist/);
  assert.match(packager, /BrowserLane/);
});

test("Browser Lane app has a HiveMatrix-themed bundle icon", () => {
  const info = readFileSync(join(root, "browser-lane-app/Resources/Info.plist"), "utf8");
  const packager = readFileSync(join(root, "scripts/package-browser-lane-app.mjs"), "utf8");
  const sourcePath = join(root, "browser-lane-app/Resources/browser-lane-icon.svg");
  const whiteSourcePath = join(root, "browser-lane-app/Resources/browser-lane-icon-white.svg");
  const pngPath = join(root, "browser-lane-app/Resources/BrowserLane.png");
  const whitePngPath = join(root, "browser-lane-app/Resources/BrowserLaneWhite.png");
  const icnsPath = join(root, "browser-lane-app/Resources/BrowserLane.icns");
  const whiteIcnsPath = join(root, "browser-lane-app/Resources/BrowserLaneWhite.icns");

  assert.ok(existsSync(sourcePath), "Browser Lane icon source SVG should exist");
  assert.ok(existsSync(whiteSourcePath), "Browser Lane white icon source SVG should exist");
  assert.ok(existsSync(pngPath), "Browser Lane PNG preview should exist");
  assert.ok(existsSync(whitePngPath), "Browser Lane white PNG preview should exist");
  assert.ok(existsSync(icnsPath), "Browser Lane .icns should exist");
  assert.ok(existsSync(whiteIcnsPath), "Browser Lane white .icns should exist");
  const source = readFileSync(sourcePath, "utf8");
  assert.match(source, /#39ff7e|#3bff5e|#17b333/i, "icon should use HiveMatrix green accents");
  assert.match(source, /#020c06|#06250f|#0e451f/i, "icon should use HiveMatrix dark green base");
  assert.match(source, /browser-window|lane-path|hex-node/i, "icon should encode Browser Lane-specific symbols");
  assert.match(info, /CFBundleIconFile/);
  assert.match(info, /BrowserLane/);
  assert.match(packager, /BrowserLane\.icns/);
  assert.match(packager, /BrowserLaneWhite\.icns/);

  const icon = inspectPng(pngPath);
  assert.deepEqual(icon.size, [1024, 1024]);
  assert.equal(icon.corner[3], 0, "Browser Lane icon corners should be transparent, not white");
  const whiteIcon = inspectPng(whitePngPath);
  assert.deepEqual(whiteIcon.size, [1024, 1024]);
  assert.equal(whiteIcon.corner[3], 0, "Browser Lane white icon corners should be transparent, not white");
});

test("Browser Lane has a Settings screen for appearance, web defaults, daemon, storage, and about", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const screens = readFileSync(join(sourceDir, "Screens.swift"), "utf8");
  const content = readFileSync(join(sourceDir, "ContentViewController.swift"), "utf8");
  const settingsPath = join(sourceDir, "SettingsViewController.swift");
  const prefsPath = join(sourceDir, "BrowserLaneSettings.swift");

  assert.ok(existsSync(settingsPath), "SettingsViewController should exist");
  assert.ok(existsSync(prefsPath), "BrowserLaneSettings should exist");
  assert.match(screens, /case browser, sites, addSite, readiness, traces, settings/);
  assert.match(screens, /Settings/);
  assert.match(content, /SettingsViewController/);

  const settings = readFileSync(settingsPath, "utf8");
  assert.match(settings, /Icon state/);
  assert.match(settings, /Default URL/);
  assert.match(settings, /Daemon/);
  assert.match(settings, /Storage/);
  assert.match(settings, /About/);
  assert.match(settings, /CFBundleShortVersionString|CFBundleVersion|CFBundleIdentifier/);

  const prefs = readFileSync(prefsPath, "utf8");
  assert.match(prefs, /iconState/);
  assert.match(prefs, /defaultURL/);
  assert.match(prefs, /NSApplication\.shared\.applicationIconImage/);
  assert.doesNotMatch(prefs, /\bpassword\b|\bcookie\b|\bsecret\b/i);
  assert.doesNotMatch(prefs, /String\(contentsOf:.*auth-token/i);
});

test("Browser Lane Add Site is wired to metadata, daemon sync, and Keychain-only credentials", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const addSitePath = join(sourceDir, "AddSiteViewController.swift");
  const siteStorePath = join(sourceDir, "BrowserLaneSiteStore.swift");
  const keychainPath = join(sourceDir, "BrowserLaneKeychain.swift");
  const daemonClientPath = join(sourceDir, "BrowserLaneDaemonClient.swift");
  const modelsPath = join(sourceDir, "BrowserLaneModels.swift");
  const content = readFileSync(join(sourceDir, "ContentViewController.swift"), "utf8");
  const screens = readFileSync(join(sourceDir, "Screens.swift"), "utf8");

  for (const path of [addSitePath, siteStorePath, keychainPath, daemonClientPath, modelsPath]) {
    assert.ok(existsSync(path), `${path} should exist`);
  }

  const addSite = readFileSync(addSitePath, "utf8");
  assert.match(addSite, /final class AddSiteViewController/);
  assert.match(addSite, /NSTextField/);
  assert.match(addSite, /NSSecureTextField/);
  assert.match(addSite, /saveSite/);
  assert.match(addSite, /Open auth flow/);

  const keychain = readFileSync(keychainPath, "utf8");
  assert.match(keychain, /import Security/);
  assert.match(keychain, /HiveMatrix Browser Lane/);
  assert.match(keychain, /SecItemAdd/);
  assert.match(keychain, /SecItemUpdate/);

  const daemonClient = readFileSync(daemonClientPath, "utf8");
  assert.match(daemonClient, /browser-lane\/sites/);
  assert.match(daemonClient, /auth-token/);
  assert.doesNotMatch(daemonClient, /password/i);

  const models = readFileSync(modelsPath, "utf8");
  assert.match(models, /struct BrowserLaneSite/);
  assert.match(models, /credentialRef/);
  assert.doesNotMatch(models, /\bpassword\b|\btoken\b|\bcookie\b|\bsecret\b/i);

  assert.match(content, /AddSiteViewController/);
  assert.match(content, /SitesViewController/);
  assert.doesNotMatch(screens, /not wired yet/i);
});

test("Browser Lane Add Site has an auth strategy picker that gates password capture", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const addSite = readFileSync(join(sourceDir, "AddSiteViewController.swift"), "utf8");
  const models = readFileSync(join(sourceDir, "BrowserLaneModels.swift"), "utf8");

  // Auth strategy picker exposing the four real strategies.
  assert.match(addSite, /NSPopUpButton/);
  assert.match(addSite, /BrowserLaneAuthStrategy/);
  for (const strategy of ["keychain_password", "google_sso", "microsoft_sso", "manual_session"]) {
    assert.match(models, new RegExp(strategy));
  }

  // keychain_password is the only strategy that captures a secret, into the
  // macOS Keychain — the secure field + the Security.framework path stay.
  assert.match(addSite, /NSSecureTextField/);
  assert.match(addSite, /usesKeychainPassword/);

  // SSO/manual: password capture is gated off and the copy says no password is stored.
  assert.match(addSite, /No password is stored/i);

  // Non-secret provider account/email metadata field + provider domain defaults.
  assert.match(addSite, /providerAccount/);
  assert.match(models, /providerAccount/);
  assert.match(models, /accounts\.google\.com/);
  assert.match(models, /login\.microsoftonline\.com/);
  assert.match(models, /login\.live\.com/);

  // Model stays metadata-only: no secret-bearing fields.
  assert.doesNotMatch(models, /\bpassword\b|\btoken\b|\bcookie\b|\bsecret\b/i);
});

test("Browser Lane has a Readiness dashboard with per-site status and actions", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const readinessPath = join(sourceDir, "ReadinessViewController.swift");
  const tracesPath = join(sourceDir, "TracesViewController.swift");
  const content = readFileSync(join(sourceDir, "ContentViewController.swift"), "utf8");
  const daemonClient = readFileSync(join(sourceDir, "BrowserLaneDaemonClient.swift"), "utf8");

  assert.ok(existsSync(readinessPath), "ReadinessViewController should exist");
  assert.ok(existsSync(tracesPath), "TracesViewController should exist");
  const readiness = readFileSync(readinessPath, "utf8");
  const traces = readFileSync(tracesPath, "utf8");

  // Status colors green/orange/yellow/red are represented.
  assert.match(readiness, /green/);
  assert.match(readiness, /orange/);
  assert.match(readiness, /yellow/);
  assert.match(readiness, /red/);

  // Per-site metadata + next action.
  assert.match(readiness, /Last checked/i);
  assert.match(readiness, /Next action/i);

  // Action buttons.
  assert.match(readiness, /Open auth flow/);
  assert.match(readiness, /Run readiness/);
  assert.match(readiness, /Refresh/);

  // Wired into navigation and backed by the daemon dashboard endpoint.
  assert.match(content, /ReadinessViewController/);
  assert.match(daemonClient, /browser-lane\/dashboard/);
  assert.match(content, /TracesViewController/);
  assert.match(daemonClient, /browser-lane\/traces/);
  assert.match(daemonClient, /browser-lane\/traces\/latest/);
  assert.match(traces, /Latest trace/);
  assert.match(traces, /Refresh traces/);
  assert.match(traces, /fetchLatestTrace/);
  assert.match(traces, /fetchTraces/);
  assert.doesNotMatch(readiness, /\bpassword\b|\btoken\b|\bcookie\b|\bsecret\b/i);
  assert.doesNotMatch(traces, /\bpassword\b|\btoken\b|\bcookie\b|\bsecret\b/i);
});

test("Browser Lane WebKit view persists the session and supports OAuth popups", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const browser = readFileSync(join(sourceDir, "BrowserViewController.swift"), "utf8");

  // Persistent website data store so a completed SSO login is reused.
  assert.match(browser, /WKWebsiteDataStore/);
  assert.match(browser, /\.default\(\)/);

  // WKUIDelegate + new-window/popup support for OAuth flows.
  assert.match(browser, /WKUIDelegate/);
  assert.match(browser, /createWebViewWith/);
});

test("Browser Lane keeps Google SSO popups as real opener-preserving WebKit popups", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const browser = readFileSync(join(sourceDir, "BrowserViewController.swift"), "utf8");
  const popupDelegate = browser.match(/func webView\(\s*_ webView: WKWebView,\s*createWebViewWith[\s\S]*?\n    \}/)?.[0] ?? "";

  assert.match(browser, /popupWebView/);
  assert.match(browser, /popupContainer/);
  assert.match(browser, /showPopup/);
  assert.match(browser, /webViewDidClose/);
  assert.match(popupDelegate, /return popup/);
  assert.doesNotMatch(popupDelegate, /webView\.load\(navigationAction\.request\)/);
});

test("Browser Lane Google auth pages expose a visible recovery path instead of white-screening silently", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const browser = readFileSync(join(sourceDir, "BrowserViewController.swift"), "utf8");

  assert.match(browser, /accounts\.google\.com/);
  assert.match(browser, /authRecoveryView/);
  assert.match(browser, /Google sign-in can block embedded browser flows/);
  assert.match(browser, /Reload auth/);
  assert.match(browser, /Open in Chrome/);
  assert.match(browser, /Open in Safari/);
  assert.match(browser, /javaScriptCanOpenWindowsAutomatically/);
  assert.match(browser, /customUserAgent/);
});

test("Browser Lane Sites view shows auth strategy and session/credential label", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const sites = readFileSync(join(sourceDir, "SitesViewController.swift"), "utf8");
  assert.match(sites, /authStrategy/);
  assert.match(sites, /providerAccount/);
  assert.doesNotMatch(sites, /\bpassword\b|\btoken\b|\bcookie\b|\bsecret\b/i);
});
