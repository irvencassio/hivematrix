import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = join(root, "terminal-lane-app");
const source = join(app, "Sources/TerminalLaneApp");

test("Terminal Lane macOS app scaffold pins identity and package dependencies", () => {
  const pkg = readFileSync(join(app, "Package.swift"), "utf8");
  const info = readFileSync(join(app, "Resources/Info.plist"), "utf8");
  const entitlements = readFileSync(join(app, "Resources/entitlements.plist"), "utf8");
  const packager = readFileSync(join(root, "scripts/package-terminal-lane-app.mjs"), "utf8");

  assert.match(pkg, /SwiftTerm/);
  assert.match(pkg, /TerminalLaneApp/);
  assert.match(info, /com\.irvcassio\.hivematrix\.terminallane/);
  assert.match(info, /Terminal Lane/);
  assert.match(entitlements, /keychain-access-groups/);
  assert.match(packager, /Terminal Lane\.app/);
});

test("Terminal Lane app has profile, readiness, traces, settings, and terminal screens", () => {
  for (const file of [
    "AppDelegate.swift",
    "RootSplitViewController.swift",
    "SidebarViewController.swift",
    "ContentViewController.swift",
    "Screens.swift",
    "TerminalViewController.swift",
    "ProfilesViewController.swift",
    "AddProfileViewController.swift",
    "ReadinessViewController.swift",
    "TracesViewController.swift",
    "SettingsViewController.swift",
  ]) {
    assert.ok(existsSync(join(source, file)), `${file} should exist`);
  }

  const screens = readFileSync(join(source, "Screens.swift"), "utf8");
  assert.match(screens, /case terminal, profiles, addProfile, readiness, traces, settings/);
  const content = readFileSync(join(source, "ContentViewController.swift"), "utf8");
  for (const vc of ["TerminalViewController", "ProfilesViewController", "AddProfileViewController", "ReadinessViewController", "TracesViewController", "SettingsViewController"]) {
    assert.match(content, new RegExp(vc));
  }
});

test("Terminal Lane profile model has no secret fields and daemon sync carries credentialRef only", () => {
  const models = readFileSync(join(source, "TerminalLaneModels.swift"), "utf8");
  const daemon = readFileSync(join(source, "TerminalLaneDaemonClient.swift"), "utf8");
  const keychain = readFileSync(join(source, "TerminalLaneKeychain.swift"), "utf8");

  assert.match(models, /struct TerminalLaneProfile/);
  assert.match(models, /credentialRef/);
  assert.match(models, /openCommand/);
  assert.doesNotMatch(models, /\bpassword\b|\bpassphrase\b|\bprivateKey\b|\btoken\b|\bcookie\b|\bsecret\b/i);

  assert.match(daemon, /terminal-lane\/profiles/);
  assert.match(daemon, /terminal-lane\/readiness\/run/);
  assert.match(daemon, /auth-token/);
  assert.doesNotMatch(daemon, /password|passphrase|privateKey/i);

  assert.match(keychain, /import Security/);
  assert.match(keychain, /HiveMatrix Terminal Lane/);
  assert.match(keychain, /SecItemAdd/);
  assert.match(keychain, /SecItemUpdate/);
});

test("Terminal Lane terminal screen uses SwiftTerm PTY and avoids inline credential automation", () => {
  const terminal = readFileSync(join(source, "TerminalViewController.swift"), "utf8");
  assert.match(terminal, /import SwiftTerm/);
  assert.match(terminal, /LocalProcessTerminalView/);
  assert.match(terminal, /startProcess/);
  assert.match(terminal, /openCommand/);
  assert.doesNotMatch(terminal, /password|passphrase|privateKey/i);
});
