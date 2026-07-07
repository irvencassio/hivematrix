import assert from "node:assert/strict";
import test from "node:test";

import { buildTerminalOpenCommand, normalizeTerminalProfile, normalizeTerminalReadinessState, terminalAuthCapability } from "./contracts";

test("normalizeTerminalProfile rejects inline secret-looking fields", () => {
  assert.throws(
    () => normalizeTerminalProfile({
      id: "prod",
      displayName: "Prod",
      kind: "ssh",
      host: "example.com",
      user: "deploy",
      password: "nope",
    }),
    /inline secret field/,
  );
});

test("normalizeTerminalProfile stores ssh metadata and credentialRef only", () => {
  const profile = normalizeTerminalProfile({
    id: "Prod SSH",
    displayName: "Prod SSH",
    kind: "ssh",
    host: "Example.COM",
    user: "deploy",
    port: 2222,
    credentialRef: "hivematrix.terminal.prod.primary",
    cwd: "/srv/app",
  });

  assert.equal(profile.id, "prod-ssh");
  assert.equal(profile.host, "example.com");
  assert.equal(profile.user, "deploy");
  assert.equal(profile.port, 2222);
  assert.equal(profile.credentialRef, "hivematrix.terminal.prod.primary");
  assert.equal(profile.openCommand, "ssh -p 2222 deploy@example.com");
  assert.equal("password" in profile, false);
  assert.equal("privateKey" in profile, false);
});

test("buildTerminalOpenCommand uses a local shell or persistent ssh command", () => {
  assert.equal(buildTerminalOpenCommand({ kind: "local", shell: "/bin/zsh" }), "/bin/zsh");
  assert.equal(buildTerminalOpenCommand({ kind: "ssh", host: "server.local", user: "irv", port: 22 }), "ssh irv@server.local");
});

test("readiness statuses map to dashboard colors", () => {
  assert.deepEqual(normalizeTerminalReadinessState("ready"), { status: "ready", color: "green", label: "Ready" });
  assert.equal(normalizeTerminalReadinessState("needs_auth").color, "orange");
  assert.equal(normalizeTerminalReadinessState("unknown").color, "gray");
});

test("authMethod is inferred from legacy kind + credentialRef", () => {
  // local kind → local
  assert.equal(normalizeTerminalProfile({ id: "l", displayName: "L", kind: "local" }).authMethod, "local");
  // ssh + credentialRef → legacy password_keychain (now honestly flagged)
  assert.equal(normalizeTerminalProfile({ id: "p", displayName: "P", kind: "ssh", host: "h.example", user: "u", credentialRef: "hivematrix.terminal.p" }).authMethod, "password_keychain");
  // ssh + no credential → ssh_key_agent
  assert.equal(normalizeTerminalProfile({ id: "k", displayName: "K", kind: "ssh", host: "h.example", user: "u" }).authMethod, "ssh_key_agent");
});

test("authMethod field rules are enforced", () => {
  // ssh_key_agent / manual_password must NOT carry a credentialRef.
  assert.throws(() => normalizeTerminalProfile({ id: "a", displayName: "A", authMethod: "ssh_key_agent", host: "h.x", user: "u", credentialRef: "hivematrix.terminal.a" }), /credentialRef/i);
  assert.throws(() => normalizeTerminalProfile({ id: "m", displayName: "M", authMethod: "manual_password", host: "h.x", user: "u", credentialRef: "hivematrix.terminal.m" }), /credentialRef/i);
  // password_keychain requires a credentialRef.
  assert.throws(() => normalizeTerminalProfile({ id: "pw", displayName: "PW", authMethod: "password_keychain", host: "h.x", user: "u" }), /credentialRef/i);
  // ssh_key_file requires a keyPath.
  assert.throws(() => normalizeTerminalProfile({ id: "kf", displayName: "KF", authMethod: "ssh_key_file", host: "h.x", user: "u" }), /keyPath/i);
  // local must not carry ssh fields/credential.
  const local = normalizeTerminalProfile({ id: "loc", displayName: "Loc", authMethod: "local", shell: "/bin/zsh" });
  assert.equal(local.host, null);
  assert.equal(local.credentialRef, null);
  assert.equal(local.keyPath, null);
});

test("ssh_key_file open command includes the identity file, never a secret", () => {
  const p = normalizeTerminalProfile({ id: "kf", displayName: "KF", authMethod: "ssh_key_file", host: "h.example", user: "u", port: 22, keyPath: "/Users/me/.ssh/id_ed25519" });
  assert.equal(p.keyPath, "/Users/me/.ssh/id_ed25519");
  assert.match(p.openCommand, /ssh -i \/Users\/me\/\.ssh\/id_ed25519 u@h\.example/);
  assert.doesNotMatch(JSON.stringify(p), /password|passphrase|private_key/i);
});

test("terminalAuthCapability reports honest auto-connectability", () => {
  const cap = (input: Record<string, unknown>) => terminalAuthCapability(normalizeTerminalProfile(input));
  assert.equal(cap({ id: "l", displayName: "L", authMethod: "local" }).autoConnect, true);
  assert.equal(cap({ id: "a", displayName: "A", authMethod: "ssh_key_agent", host: "h.x", user: "u" }).autoConnect, true);
  assert.equal(cap({ id: "f", displayName: "F", authMethod: "ssh_key_file", host: "h.x", user: "u", keyPath: "/k" }).autoConnect, true);
  // password_keychain now auto-connects via the app's native SSH runtime,
  // authenticating with the Keychain password (Canopy-style).
  const pw = cap({ id: "p", displayName: "P", authMethod: "password_keychain", host: "h.x", user: "u", credentialRef: "hivematrix.terminal.p" });
  assert.equal(pw.autoConnect, true);
  assert.equal(pw.needsKeychain, true);
  assert.equal(pw.reason, null);
  // manual_password connects but prompts (not auto).
  assert.equal(cap({ id: "m", displayName: "M", authMethod: "manual_password", host: "h.x", user: "u" }).autoConnect, false);
});
