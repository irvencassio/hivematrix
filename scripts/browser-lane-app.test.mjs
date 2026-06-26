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
  assert.match(entitlements, /keychain-access-groups/);
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
