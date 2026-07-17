import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

// The squircle must be INSET inside the 1024 canvas (~Apple's 0.805 content
// ratio, matching src-tauri/icons/icon.png) with a transparent
// margin — not full-bleed — so the dock doesn't render Browser Lane larger than
// neighboring app icons.
test("Browser Lane bundle icon is inset (~0.805) with a transparent margin", () => {
  for (const file of ["BrowserLane.png", "BrowserLaneWhite.png"]) {
    const icon = inspectPng(join(root, "browser-lane-app/Resources", file));
    assert.deepEqual(icon.size, [1024, 1024]);
    assert.equal(icon.corner[3], 0, `${file} corner should be transparent, not a matte`);
    const [x0, y0, x1] = icon.bbox;
    const ratio = (x1 - x0) / icon.size[0];
    assert.ok(ratio > 0.74 && ratio < 0.86, `${file} squircle should fill ~0.805 of the canvas (got ${ratio.toFixed(3)})`);
    assert.ok(x0 > 40 && y0 > 40, `${file} squircle should sit inside a transparent margin (got x0=${x0}, y0=${y0})`);
  }
});

test("Browser Lane has a Settings screen for appearance, web defaults, daemon, storage, and about", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const screens = readFileSync(join(sourceDir, "Screens.swift"), "utf8");
  const content = readFileSync(join(sourceDir, "ContentViewController.swift"), "utf8");
  const settingsPath = join(sourceDir, "SettingsViewController.swift");
  const prefsPath = join(sourceDir, "BrowserLaneSettings.swift");

  assert.ok(existsSync(settingsPath), "SettingsViewController should exist");
  assert.ok(existsSync(prefsPath), "BrowserLaneSettings should exist");
  // Sites live in the sidebar and the log lives in the right panel, so neither is
  // a content screen; what remains here is what the toolbar and "+" open.
  assert.match(screens, /case browser, addSite, readiness, settings/);
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
  assert.match(addSite, /Open Sign-in/);

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
  const content = readFileSync(join(sourceDir, "ContentViewController.swift"), "utf8");
  const daemonClient = readFileSync(join(sourceDir, "BrowserLaneDaemonClient.swift"), "utf8");

  assert.ok(existsSync(readinessPath), "ReadinessViewController should exist");
  const readiness = readFileSync(readinessPath, "utf8");

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
  assert.doesNotMatch(readiness, /\bpassword\b|\btoken\b|\bcookie\b|\bsecret\b/i);
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
  const popupDelegate = browser.match(/func webView\(\s*_ webView: WKWebView,\s*createWebViewWith[\s\S]*?\n {4}\}/)?.[0] ?? "";

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

// The sites list is the sidebar now (it replaced SitesViewController), so the
// no-jargon / no-secrets invariants follow it there.
test("Browser Lane sidebar shows the account, no jargon, no secrets", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const sidebar = readFileSync(join(sourceDir, "SidebarViewController.swift"), "utf8");
  assert.match(sidebar, /providerAccount/);
  assert.doesNotMatch(sidebar, /\bpassword\b|\btoken\b|\bcookie\b|\bsecret\b/i);
  // No leftover 1980s-admin "metadata" wording.
  assert.doesNotMatch(sidebar, /metadata/i);
});

// The sidebar badge is display-only; the daemon enforces accessMode at dispatch.
// Without a control in the form the badge would show a state the operator can
// see but never change, and the picker would be decorative if buildSite() dropped it.
// Site ids are auto-slugged from the name, so "Knox prdna" and "Knox - prdna"
// both become "knox-prdna". upsert matches on id and the Keychain is keyed by id,
// so a second site with a colliding id would silently replace the first AND
// overwrite its saved sign-in. Real risk: one service with several accounts.
test("Browser Lane refuses a new site whose id would replace an existing one", () => {
  const addSite = readFileSync(
    join(root, "browser-lane-app/Sources/BrowserLaneApp/AddSiteViewController.swift"),
    "utf8",
  );
  // Only on the add path — editing a site must still save over itself.
  assert.match(addSite, /if editingSite == nil, let clash = store\.listSites\(\)\.first\(where: \{ \$0\.id == id \}\)/);
  assert.match(addSite, /already uses the Site ID/);
});

// A single-page sign-in can ask for the same field across two screens (Knox asks
// for the account id twice). Both screens reuse input[type="text"], so waitFor
// matches the screen just left and there is nothing new to wait for.
test("Browser Lane login recipes can pause between screens", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const recipe = readFileSync(join(sourceDir, "BrowserLaneLoginRecipe.swift"), "utf8");
  const runner = readFileSync(join(sourceDir, "BrowserLaneLoginRunner.swift"), "utf8");
  const addSite = readFileSync(join(sourceDir, "AddSiteViewController.swift"), "utf8");

  assert.match(recipe, /case wait\(seconds: TimeInterval\)/);
  assert.match(recipe, /case "wait":/);
  assert.match(runner, /case \.wait\(let seconds\)/);

  // The editor's help must list every verb, or the field is unusable by hand.
  for (const verb of ["click <css>", "clickText <css> <label>", "waitFor <css>", "wait <seconds>", "fill <css>", "submit <css>"]) {
    assert.ok(addSite.includes(verb), `login-steps help documents ${verb}`);
  }
});

test("Browser Lane Add Site can set agent access mode, and saves it", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const addSite = readFileSync(join(sourceDir, "AddSiteViewController.swift"), "utf8");
  const client = readFileSync(join(sourceDir, "BrowserLaneDaemonClient.swift"), "utf8");

  assert.match(addSite, /accessPicker/);
  assert.match(addSite, /BrowserLaneAccessMode/);
  assert.match(addSite, /"Agent access"/);
  // Chosen value reaches the saved site and the daemon, not just the form.
  assert.match(addSite, /accessMode: selectedAccessMode\.rawValue/);
  assert.match(client, /"accessMode": site\.access\.rawValue/);
  // Editing an existing site prefills its current mode rather than resetting it.
  assert.match(addSite, /accessPicker\.selectItem\(at: BrowserLaneAccessMode\.displayOrder\.firstIndex/);

  // The daemon enforces the gate, so the badge must read its value and only fall
  // back to the local copy — a local-only badge can claim read-only while the
  // daemon still permits writes (sync() tolerates "saved locally; sync failed").
  const sidebar = readFileSync(join(sourceDir, "SidebarViewController.swift"), "utf8");
  assert.match(sidebar, /daemonAccessMode/);
  assert.match(sidebar, /daemonAccessMode\.flatMap\(BrowserLaneAccessMode\.init\(rawValue:\)\) \?\? site\.access/);
  assert.match(client, /accessMode: entry\["accessMode"\] as\? String,/);
});

// Per-site login recipes drive a multi-step sign-in from an explicit operator
// click. These assertions pin the security properties of that path — none of them
// would fail a build, and each one is load-bearing.
test("Browser Lane login recipes cannot carry or leak a stored sign-in", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const recipe = readFileSync(join(sourceDir, "BrowserLaneLoginRecipe.swift"), "utf8");
  const runner = readFileSync(join(sourceDir, "BrowserLaneLoginRunner.swift"), "utf8");
  const models = readFileSync(join(sourceDir, "BrowserLaneModels.swift"), "utf8");
  const client = readFileSync(join(sourceDir, "BrowserLaneDaemonClient.swift"), "utf8");

  // A fixed verb set, not a script: arbitrary JS in a context holding the
  // operator's sign-in could read the value and post it anywhere.
  assert.match(recipe, /case click\(selector: String\)/);
  assert.match(recipe, /case fill\(selector: String, value: BrowserLaneLoginValue\)/);
  // Recipes hold placeholders; real values are substituted natively at run time.
  assert.match(recipe, /case username/);
  assert.match(recipe, /return "\$username"/);
  assert.match(recipe, /return "\$password"/);

  // Origin check before any step that types a stored sign-in. Suffix-with-dot,
  // never `contains` — "evil-linkedin.com" contains "linkedin.com".
  assert.match(runner, /func hostIsAllowed/);
  assert.match(runner, /host == domain \|\| host\.hasSuffix\("\." \+ domain\)/);
  assert.doesNotMatch(runner, /\.contains\(host\)/);
  assert.match(runner, /if current\.carriesCredential/);
  assert.match(runner, /completion\(\.originRefused/);

  // Values are JSON-encoded into JS source, never string-concatenated raw.
  assert.match(runner, /JSONSerialization\.data\(withJSONObject: \[value\]/);

  // The recipe is local-only: it must never be in the daemon sync payload, or an
  // agent-side path could drive a login with it.
  assert.match(models, /var loginSteps: String\?/);
  assert.doesNotMatch(client, /loginSteps/);
});

test("Browser Lane login recipes run only from an explicit operator click", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const signIn = readFileSync(join(sourceDir, "BrowserLaneSignIn.swift"), "utf8");
  const readiness = readFileSync(join(sourceDir, "ReadinessViewController.swift"), "utf8");
  const sidebar = readFileSync(join(sourceDir, "SidebarViewController.swift"), "utf8");

  // Exactly one implementation of the credential flow. Both surfaces call it —
  // a second copy is a second place for the origin check, the audit call, or the
  // clipboard timer to drift.
  assert.match(signIn, /enum BrowserLaneSignIn/);
  assert.match(signIn, /static func start\(site incoming: BrowserLaneSite\)/);
  assert.match(readiness, /BrowserLaneSignIn\.start\(site: site\)/);
  assert.match(sidebar, /BrowserLaneSignIn\.start\(site: site\)/);
  // The flow must not be re-implemented in either view.
  assert.doesNotMatch(readiness, /NSPasteboard/);
  assert.doesNotMatch(sidebar, /NSPasteboard/);

  // Both entry points are user actions. Nothing schedules a sign-in.
  assert.match(readiness, /func signInWithSavedCredential/);
  assert.match(sidebar, /@objc private func menuSignIn/);
  assert.doesNotMatch(signIn, /Timer\.scheduledTimer/);

  // The origin check must read the CURRENT allowed domains. The sidebar hands
  // over a row cached since its last reload, so trusting the caller's copy can
  // check a stale allowlist — it refused a domain the operator had already added.
  assert.match(signIn, /static func start\(site incoming: BrowserLaneSite\)/);
  assert.match(signIn, /BrowserLaneSiteStore\.shared\.listSites\(\)\s*\n?\s*\.first\(where: \{ \$0\.id == incoming\.id \}\) \?\? incoming/);

  // Offered only where a stored sign-in exists; SSO/manual sites grey it out.
  assert.match(signIn, /static func isAvailable\(for site: BrowserLaneSite\)/);
  assert.match(sidebar, /func validateMenuItem/);
  assert.match(sidebar, /BrowserLaneSignIn\.isAvailable\(for: site\)/);

  // No recipe → the original clipboard handoff, never a guess at which field is which.
  assert.match(signIn, /handOffViaClipboard/);
  assert.match(signIn, /NSPasteboard/);

  // Success is silent — the signed-in page is the result, and a modal saying so
  // is a click you must dismiss to see it. Only outcomes you cannot see for
  // yourself (stalled / refused / failed) get an alert.
  const completedCase = signIn.match(/case \.completed:[\s\S]*?case \.stalled/)?.[0] ?? "";
  assert.doesNotMatch(completedCase, /alert\(/);
  // ...and readiness is kicked automatically, which is what the alert used to ask for.
  assert.match(completedCase, /runReadiness\(siteId: site\.id\)/);
  for (const failure of ["case .stalled", "case .originRefused", "case .failed"]) {
    assert.ok(signIn.includes(failure), `${failure} still reported`);
  }
});

test("Browser Lane sidebar is the site list, with a session dot and + add", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const sidebar = readFileSync(join(sourceDir, "SidebarViewController.swift"), "utf8");
  const status = readFileSync(join(sourceDir, "BrowserLaneStatus.swift"), "utf8");

  // The sidebar lists configured sites, not app screens.
  assert.match(sidebar, /BrowserLaneSiteStore\.shared\.listSites/);
  assert.match(sidebar, /"Sites"/);
  assert.match(sidebar, /systemSymbolName: "plus"/);
  assert.match(sidebar, /StatusDotView/);
  // Readiness enriches the list; it must not gate rendering it.
  assert.match(sidebar, /fetchDashboard/);

  // A green dot means ready AND fresh — a stale probe is not a live session.
  assert.match(status, /func sessionEstablished/);
  assert.match(status, /color == "green" && !stale/);
});

test("Browser Lane has a Canopy-style Command Log panel scoped to a site", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const panelPath = join(sourceDir, "HistoryPanelViewController.swift");
  assert.ok(existsSync(panelPath), "HistoryPanelViewController should exist");
  const panel = readFileSync(panelPath, "utf8");
  const client = readFileSync(join(sourceDir, "BrowserLaneDaemonClient.swift"), "utf8");
  const split = readFileSync(join(sourceDir, "RootSplitViewController.swift"), "utf8");

  assert.match(panel, /Command Log/);
  assert.match(panel, /fetchHistory/);
  assert.match(panel, /NSSearchField/);
  assert.match(client, /browser-lane\/history/);

  // Every chip must map to a signal Browser Lane actually emits, or it would
  // always render empty. Canopy's "Warned" has no analog here and is absent.
  for (const chip of ["Human", "Agent", "Blocked", "Failed", "Security"]) {
    assert.match(panel, new RegExp(`case \\w+ = "${chip}"`), `${chip} chip wired`);
  }
  assert.doesNotMatch(panel, /case \w+ = "Warned"/);

  // The daemon stamps audit ts via JS toISOString() — always with milliseconds.
  // ISO8601DateFormatter rejects fractional seconds unless opted in, so without
  // this every log row silently renders "—" instead of a time.
  const models = readFileSync(join(sourceDir, "BrowserLaneModels.swift"), "utf8");
  assert.match(models, /withFractionalSeconds/);

  // Right pane, collapsed until asked for.
  assert.match(split, /HistoryPanelViewController/);
  assert.match(split, /isCollapsed = true/);
  assert.doesNotMatch(panel, /\bpassword\b|\btoken\b|\bcookie\b|\bsecret\b/i);
});

test("Browser Lane chrome lives in toolbar icons, not sidebar rows", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const appDelegate = readFileSync(join(sourceDir, "AppDelegate.swift"), "utf8");

  assert.match(appDelegate, /NSToolbar/);
  assert.match(appDelegate, /displayMode = \.iconOnly/);
  for (const symbol of ["sidebar.left", "checkmark.shield", "list.bullet.rectangle", "gearshape"]) {
    assert.match(appDelegate, new RegExp(symbol.replace(/\./g, "\\.")), `${symbol} toolbar item`);
  }
});

// The active icon must be blue while its pane is showing (Canopy parity). This
// broke twice in ways a build can't catch: contentTintColor is silently ignored
// for toolbar images, and the first tint pass runs before the split view loads.
test("Browser Lane toolbar tints the icon of whichever pane is showing", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const appDelegate = readFileSync(join(sourceDir, "AppDelegate.swift"), "utf8");
  const split = readFileSync(join(sourceDir, "RootSplitViewController.swift"), "utf8");

  // Color must ride on the symbol: the toolbar ignores a button's contentTintColor.
  assert.match(appDelegate, /SymbolConfiguration\(paletteColors:/);
  assert.match(appDelegate, /controlAccentColor/);
  // Comments stripped — the code documents why contentTintColor is the wrong tool.
  const appDelegateCode = appDelegate
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("///"))
    .join("\n");
  assert.doesNotMatch(appDelegateCode, /contentTintColor/);

  // Re-tinted after the window is up, because the toolbar builds its items
  // before viewDidLoad and would otherwise read "no panes visible" forever.
  assert.match(appDelegate, /makeKeyAndOrderFront[\s\S]{0,400}refreshActiveStates/);

  // Tracks real pane state, including a collapse via the split divider.
  assert.match(split, /var isSidebarVisible: Bool \{ isViewLoaded/);
  assert.match(split, /var isHistoryVisible: Bool \{ isViewLoaded/);
  assert.match(split, /onPaneStateChanged/);
  assert.match(split, /override func splitViewDidResizeSubviews/);

  // The screen icons light too, so "where am I" is always answerable.
  assert.match(appDelegate, /ItemID\.readiness, active: split\.currentScreen == \.readiness/);
  assert.match(appDelegate, /ItemID\.settings, active: split\.currentScreen == \.settings/);
});

// The sidebar is sites-only, so there is no nav row to click back with: a toolbar
// screen that only pushed would strand you with no way home (hit on Readiness).
test("Browser Lane toolbar screens toggle back to the browser", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const split = readFileSync(join(sourceDir, "RootSplitViewController.swift"), "utf8");
  const content = readFileSync(join(sourceDir, "ContentViewController.swift"), "utf8");

  assert.match(split, /@objc func showReadiness\(\) \{ toggleScreen\(\.readiness\) \}/);
  assert.match(split, /@objc func showSettings\(\) \{ toggleScreen\(\.settings\) \}/);
  assert.match(split, /content\.show\(content\.currentScreen == screen \? \.browser : screen\)/);
  assert.match(content, /private\(set\) var currentScreen: Screen/);
  assert.match(content, /onScreenChanged/);
});

// AppKit's clip view is not flipped, so hand-built scrolling content shorter than
// the pane lays out from the bottom — the whole Readiness screen sat at the
// bottom of a tall window until its document view was flipped.
test("Browser Lane hand-built scroll content lays out from the top", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const status = readFileSync(join(sourceDir, "BrowserLaneStatus.swift"), "utf8");
  const readiness = readFileSync(join(sourceDir, "ReadinessViewController.swift"), "utf8");

  assert.match(status, /final class FlippedView: NSView/);
  assert.match(status, /override var isFlipped: Bool \{ true \}/);
  assert.match(readiness, /let documentView = FlippedView\(\)/);
});

// A window built in code has no key view loop unless asked for one, so Tab did
// nothing between form fields — every field was an island. Nib-loaded windows get
// the loop from the nib; ours are all code, so AppKit must derive it from geometry.
test("Browser Lane windows have a key view loop so Tab moves between fields", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const appDelegate = readFileSync(join(sourceDir, "AppDelegate.swift"), "utf8");
  const addSite = readFileSync(join(sourceDir, "AddSiteViewController.swift"), "utf8");

  assert.match(appDelegate, /window\.autorecalculatesKeyViewLoop = true/);
  // The form arrives focused, so Tab has a starting point without a click first.
  assert.match(addSite, /override func viewDidAppear/);
  assert.match(addSite, /makeFirstResponder\(nameField\)/);
});

test("Browser Lane installs a standard Edit menu so Cmd-C/V/X/A work in text fields", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const appDelegate = readFileSync(join(sourceDir, "AppDelegate.swift"), "utf8");
  assert.match(appDelegate, /NSMenu/);
  assert.match(appDelegate, /installMainMenu|mainMenu/);
  for (const sel of ["cut:", "copy:", "paste:", "selectAll:"]) {
    assert.match(appDelegate, new RegExp(sel.replace(":", "\\:")), `${sel} wired`);
  }
});

test("Browser Lane Add Site auto-generates ids, hides technical fields, edits, and gives field-specific errors", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const addSite = readFileSync(join(sourceDir, "AddSiteViewController.swift"), "utf8");
  const models = readFileSync(join(sourceDir, "BrowserLaneModels.swift"), "utf8");
  const sidebar = readFileSync(join(sourceDir, "SidebarViewController.swift"), "utf8");

  // Technical Site id + Credential ref are tucked under an Advanced disclosure.
  assert.match(addSite, /Advanced/);
  // Site id is auto-generated from the display name / domain (a slug helper).
  assert.match(addSite, /autoSiteId|slug/i);
  // credentialRef is auto-generated for Keychain auth.
  assert.match(addSite, /hivematrix\.browser\./);
  assert.match(addSite, /\.primary/);

  // Editing an existing site: a cross-screen edit target + prefill.
  assert.match(models, /BrowserLaneEditTarget/);
  assert.match(addSite, /BrowserLaneEditTarget/);
  assert.match(addSite, /createdAt/);
  // Blank password on edit preserves the existing Keychain secret (no overwrite).
  assert.match(addSite, /leave blank to keep|keep the existing|keep existing/i);

  // Field-specific errors focus the offending field.
  assert.match(addSite, /makeFirstResponder/);

  // The sidebar offers an Edit affordance per site.
  assert.match(sidebar, /"Edit…"/);

  // Still reference-only: the daemon payload never carries a password value.
  const daemonClient = readFileSync(join(sourceDir, "BrowserLaneDaemonClient.swift"), "utf8");
  assert.doesNotMatch(daemonClient, /password/i);
});

// Browser Lane is a site-agnostic surface: every site is user-defined via Add
// Site. A hardcoded vendor (BrowserLaneSite.heyGen + a "Use HeyGen preset"
// button) shipped until 2026-07-17 and made one tenant's site read as a product
// concept. This guard keeps any single site from being designed around again.
// Test fixtures elsewhere may still *name* real sites — that's data, not design.
test("Browser Lane app code is site-agnostic — no vendor is hardcoded as a preset", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const sources = readdirSync(sourceDir).filter((f) => f.endsWith(".swift"));
  assert.ok(sources.length > 0, "expected Swift sources to scan");

  for (const file of sources) {
    const src = readFileSync(join(sourceDir, file), "utf8");
    // Strip comments: the models file documents the removal by name on purpose.
    const code = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("///"))
      .join("\n");
    assert.doesNotMatch(code, /heygen/i, `${file} should not hardcode a specific vendor site`);
  }
});

test("Browser Lane Add Site starts empty and derives from one Website field", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const addSite = readFileSync(join(sourceDir, "AddSiteViewController.swift"), "utf8");
  const screens = readFileSync(join(sourceDir, "Screens.swift"), "utf8");

  // Empty by default: an explicit empty-state helper, no auto-loaded vendor.
  assert.match(addSite, /startEmpty/);
  assert.doesNotMatch(addSite, /defaults loaded/i);

  // Friendly, view-layer sign-in labels (not in the model).
  assert.match(addSite, /pickerTitle/);
  assert.match(addSite, /displayOrder/);
  assert.match(addSite, /Username \+ password/);
  assert.match(addSite, /Google sign-in/);
  assert.match(addSite, /Microsoft sign-in/);
  assert.match(addSite, /Manual session/);

  // One primary Website field; home/login/domains are derived, not hand-entered twice.
  assert.match(addSite, /websiteField/);
  assert.match(addSite, /"Website"/);
  assert.match(addSite, /normalizedWebsite/);
  assert.match(addSite, /deriveAllowedDomains/);
  assert.match(addSite, /accountEmailField/);

  // Advanced disclosure carries the technical identifiers incl. the optional login override.
  assert.match(addSite, /Advanced/);
  assert.match(addSite, /Login URL override/);
  assert.match(addSite, /loginOverrideField/);
  assert.match(addSite, /hivematrix\.browser\./);

  // Modern buttons + no admin-form jargon.
  assert.match(addSite, /"Save Site"/);
  assert.match(addSite, /Open Sign-in/);
  assert.doesNotMatch(addSite, /metadata/i);

  // Sidebar/Screens use the modern "New Site" label, no stale metadata copy.
  assert.match(screens, /New Site/);
  assert.doesNotMatch(screens, /metadata/i);
});

test("Browser Lane sidebar sites are editable and deletable from a context menu", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const sidebar = readFileSync(join(sourceDir, "SidebarViewController.swift"), "utf8");
  const store = readFileSync(join(sourceDir, "BrowserLaneSiteStore.swift"), "utf8");
  const keychain = readFileSync(join(sourceDir, "BrowserLaneKeychain.swift"), "utf8");

  // Canopy-style right-click menu on a site row.
  assert.match(sidebar, /NSMenu/);
  assert.match(sidebar, /"Edit…"/);
  assert.match(sidebar, /"Delete"/);
  assert.match(sidebar, /"Duplicate"/);
  assert.match(sidebar, /"View Command Log"/);

  // A context-menu action must act on the right-clicked row, not the selection —
  // otherwise right-clicking an unselected site deletes a different one.
  assert.match(sidebar, /clickedRow/);

  // Delete is confirmed (never silent) and removes the local record + Keychain entry.
  assert.match(sidebar, /NSAlert/);
  assert.match(store, /func delete/);
  assert.match(keychain, /deleteCredential/);
  assert.match(keychain, /SecItemDelete/);
});

test("BrowserLaneKeychain can read back a saved credential without a daemon round-trip", () => {
  const keychain = readFileSync(
    join(root, "browser-lane-app/Sources/BrowserLaneApp/BrowserLaneKeychain.swift"),
    "utf8",
  );
  assert.match(keychain, /func readCredential\(siteId: String\) throws -> \(username: String, password: String\)/);
  assert.match(keychain, /kSecReturnData as String: true/);
  assert.match(keychain, /case notFound/);
  assert.match(keychain, /errSecItemNotFound/);
});

test("BrowserLaneDaemonClient can record a credential-use audit signal", () => {
  const client = readFileSync(
    join(root, "browser-lane-app/Sources/BrowserLaneApp/BrowserLaneDaemonClient.swift"),
    "utf8",
  );
  assert.match(client, /func recordCredentialUse\(siteId: String/);
  // Path literal is "/browser-lane/sites/\(siteId)/credential-used" — note the "/"
  // before the string-interpolation escape, which the plan draft's regex omitted.
  assert.match(client, /\/browser-lane\/sites\/\\\(siteId\)\/credential-used/);
});

// Note: the existing "Browser Lane has a Readiness dashboard with per-site status
// and actions" test above already asserts
// `doesNotMatch(readiness, /\bpassword\b|\btoken\b|\bcookie\b|\bsecret\b/i)` for this
// same file, so that invariant isn't re-checked here — only the four new
// assertions for this feature. Button copy says "saved credential", not "saved
// password", specifically so this addition keeps passing that existing guard.
// The clipboard handoff moved into the shared BrowserLaneSignIn path when the
// sidebar gained the same action; the Readiness card keeps the affordance and
// delegates. The behaviour is asserted where it now lives.
test("One-click sign-in with saved credentials is offered for keychain_password sites", () => {
  const sourceDir = join(root, "browser-lane-app/Sources/BrowserLaneApp");
  const readiness = readFileSync(join(sourceDir, "ReadinessViewController.swift"), "utf8");
  const sidebar = readFileSync(join(sourceDir, "SidebarViewController.swift"), "utf8");
  const signIn = readFileSync(join(sourceDir, "BrowserLaneSignIn.swift"), "utf8");

  // Both surfaces offer it.
  assert.match(readiness, /Sign in with saved credential/);
  assert.match(readiness, /signInWithSavedCredential/);
  assert.match(sidebar, /"Sign in with saved credential"/);

  // The clipboard fallback (and its auto-clear) live in the shared path.
  assert.match(signIn, /NSPasteboard/);
  assert.match(signIn, /scheduleClipboardClear|asyncAfter\(deadline: \.now\(\) \+ 45\)/);
});

// run() returns immediately — every step is an async JS callback — so a caller's
// local `let runner` dies the moment it returns, and the runner's own [weak self]
// callbacks then find nil and end the run silently: no click, no error, no alert.
// Reproduced with a fake driver: 1 step executed, then nothing.
test("Browser Lane login runner outlives the call that started it", () => {
  const runner = readFileSync(
    join(root, "browser-lane-app/Sources/BrowserLaneApp/BrowserLaneLoginRunner.swift"),
    "utf8",
  );
  assert.match(runner, /private var activeRun: BrowserLaneLoginRunner\?/);
  assert.match(runner, /activeRun = self/);
  // ...and released when the run ends, so the self-reference stays scoped.
  assert.match(runner, /self\?\.activeRun = nil/);
});
