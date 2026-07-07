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
  assert.doesNotMatch(entitlements, /keychain-access-groups/);
  assert.match(entitlements, /com\.apple\.security\.app-sandbox/);
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
    "TerminalLaneSettings.swift",
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

test("Terminal Lane profile model has an honest authMethod enum and stores no secret VALUES", () => {
  const models = readFileSync(join(source, "TerminalLaneModels.swift"), "utf8");
  const daemon = readFileSync(join(source, "TerminalLaneDaemonClient.swift"), "utf8");
  const keychain = readFileSync(join(source, "TerminalLaneKeychain.swift"), "utf8");
  const settings = readFileSync(join(source, "TerminalLaneSettings.swift"), "utf8");

  assert.match(models, /struct TerminalLaneProfile/);
  assert.match(models, /credentialRef/);
  assert.match(models, /openCommand/);
  // Honest auth model with all five methods + key-file path metadata.
  assert.match(models, /enum TerminalLaneAuthMethod/);
  for (const m of ["local", "ssh_key_agent", "ssh_key_file", "password_keychain", "manual_password"]) {
    assert.match(models, new RegExp(`case ${m}`));
  }
  assert.match(models, /keyPath/);
  assert.match(models, /autoConnect/);
  // No STORED secret value property (a credentialRef/keyPath is metadata, not a secret).
  assert.doesNotMatch(models, /var (password|passphrase|privateKey|secret|token)\b/i);

  // Daemon payload carries metadata only (authMethod, keyPath, credentialRef) — never a secret value.
  assert.match(daemon, /terminal-lane\/profiles/);
  assert.match(daemon, /terminal-lane\/readiness\/run/);
  assert.match(daemon, /authMethod/);
  assert.match(daemon, /auth-token/);
  assert.match(daemon, /TerminalLaneSettings\.shared\.daemonURL/);
  assert.match(settings, /daemonURL/);
  assert.match(settings, /http:\/\/127\.0\.0\.1:3747/);
  // No secret VALUE smuggled into the payload (credentialValue/private key body).
  assert.doesNotMatch(daemon, /credentialValue|kSecValueData|sshpass|--password/i);

  assert.match(keychain, /import Security/);
  assert.match(keychain, /HiveMatrix Terminal Lane/);
  assert.match(keychain, /SecItemAdd/);
  assert.match(keychain, /SecItemUpdate/);
  // SSH passwords are Internet Password items keyed by host/user/port/protocol —
  // shared with other SSH tools on this Mac — with a permissive ACL so SPM
  // rebuilds and the daemon can still read them.
  assert.match(keychain, /kSecClassInternetPassword/);
  assert.match(keychain, /kSecAttrProtocolSSH/);
  assert.match(keychain, /kSecAttrServer/);
  assert.match(keychain, /kSecAttrPort/);
  assert.match(keychain, /permissiveAccess/);
  assert.match(keychain, /hasPassword/);
});

test("Terminal Lane daemon client distinguishes sync failure from local save and supports delete", () => {
  const daemon = readFileSync(join(source, "TerminalLaneDaemonClient.swift"), "utf8");
  // A daemon sync error must NOT be reported as success.
  assert.match(daemon, /daemon sync FAILED|\.failure\(/);
  assert.match(daemon, /Saved locally and synced/);
  // Typed delete against the id-constrained endpoint.
  assert.match(daemon, /func delete\(/);
  assert.match(daemon, /httpMethod = "DELETE"|"DELETE"/);
});

test("Terminal Lane terminal screen shows connect mode and never autotypes a secret", () => {
  const terminal = readFileSync(join(source, "TerminalViewController.swift"), "utf8");
  assert.match(terminal, /import SwiftTerm/);
  assert.match(terminal, /LocalProcessTerminalView/);
  assert.match(terminal, /startProcess/);
  assert.match(terminal, /openCommand/);
  // Surfaces connect mode + honest auto-connect support.
  assert.match(terminal, /autoConnect/);
  assert.match(terminal, /not auto-connectable|connect manually|key auth/i);
  // Never autotypes / injects a secret into the PTY.
  assert.doesNotMatch(terminal, /sshpass|--password|credentialValue|kSecValueData/i);
});

test("Terminal Lane Add/Edit profile is auth-method driven and keeps secrets in Keychain only", () => {
  const addProfile = readFileSync(join(source, "AddProfileViewController.swift"), "utf8");
  const settings = readFileSync(join(source, "SettingsViewController.swift"), "utf8");

  assert.match(addProfile, /Use Local Mac defaults/);
  // Auth-method-driven field gating (replaces the old kind-only gate).
  assert.match(addProfile, /authMethod/);
  assert.match(addProfile, /authMethodChanged|authMethodPopup/);
  // Honest copy for the non-auto-connectable password method.
  assert.match(addProfile, /not auto-connectable/i);
  // Local needs no key material.
  assert.match(addProfile, /no key material|no key or login/i);
  // Editing preserves createdAt.
  assert.match(addProfile, /createdAt/);
  assert.match(addProfile, /editingProfile|TerminalLaneEditTarget/);
  // Secret material is entered securely and saved to Keychain only.
  assert.match(addProfile, /NSSecureTextField/);
  assert.match(addProfile, /savePassword/);
  // The credentialRef is auto-derived — the operator never types a ref, and the
  // Keychain item is found by host/user/port (existing items are reused).
  assert.match(addProfile, /derivedCredentialRef/);
  assert.match(addProfile, /hasPassword/);
  assert.doesNotMatch(addProfile, /credentialRefField/);
  // The profile/daemon payload never carries the secret value.
  assert.doesNotMatch(addProfile, /sshpass|--password|kSecValueData/i);

  assert.match(settings, /Daemon URL/);
  assert.match(settings, /TerminalLaneSettings\.shared/);
  assert.match(settings, /Keychain items/);
});

test("Terminal Lane Profiles screen is an editable table with delete/duplicate", () => {
  const profiles = readFileSync(join(source, "ProfilesViewController.swift"), "utf8");
  assert.match(profiles, /NSTableView/);
  assert.match(profiles, /func .*[Ee]dit|editProfile/);
  assert.match(profiles, /deleteProfile/);
  assert.match(profiles, /duplicateProfile|Duplicate/);
  // Delete asks for confirmation.
  assert.match(profiles, /NSAlert/);
  // Shows auth method + credential presence (no secret).
  assert.match(profiles, /authMethod/);
  assert.doesNotMatch(profiles, /kSecValueData|credentialValue|sshpass/i);
});

test("Terminal Lane installs a standard Edit menu so Cmd-C/V/X/A work in text fields", () => {
  const appDelegate = readFileSync(join(source, "AppDelegate.swift"), "utf8");
  assert.match(appDelegate, /NSMenu/);
  assert.match(appDelegate, /installMainMenu|mainMenu/);
  for (const sel of ["cut:", "copy:", "paste:", "selectAll:"]) {
    assert.match(appDelegate, new RegExp(sel.replace(":", "\\:")), `${sel} wired`);
  }
});
