import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

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
