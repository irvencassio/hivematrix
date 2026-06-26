import assert from "node:assert/strict";
import test from "node:test";

import { buildTerminalOpenCommand, normalizeTerminalProfile, normalizeTerminalReadinessState } from "./contracts";

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
