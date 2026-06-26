import assert from "node:assert/strict";
import test from "node:test";

import { resolveTerminalOpenRequest } from "./open";
import { normalizeTerminalProfile } from "./contracts";

// Canopy-style contract: opening a session takes a profileID ONLY — never a
// password — and the resolver hands back a command + honest connectability, with
// no secret anywhere in the result.

function lookup(profiles: Record<string, unknown>[]) {
  return (id: string) => {
    const p = profiles.find((x) => (x as { id: string }).id === id);
    return p ? normalizeTerminalProfile(p) : null;
  };
}

const PROFILES = [
  { id: "local", displayName: "Local", authMethod: "local", shell: "/bin/zsh" },
  { id: "agent", displayName: "Agent", authMethod: "ssh_key_agent", host: "h.example", user: "u" },
  { id: "pw", displayName: "PW", authMethod: "password_keychain", host: "h.example", user: "u", credentialRef: "hivematrix.terminal.pw" },
  { id: "manual", displayName: "Manual", authMethod: "manual_password", host: "h.example", user: "u" },
];

test("resolveTerminalOpenRequest takes a profileId only and returns no secret", () => {
  const r = resolveTerminalOpenRequest({ profileId: "agent" }, { getProfile: lookup(PROFILES) });
  assert.equal(r.ok, true);
  assert.equal(r.profileId, "agent");
  assert.equal(r.autoConnect, true);
  assert.ok(r.openCommand && r.openCommand.includes("ssh"));
  assert.doesNotMatch(JSON.stringify(r), /password|passphrase|private_key|credentialRef|secret/i);
});

test("password_keychain is reported not auto-connectable, with a clear reason", () => {
  const r = resolveTerminalOpenRequest({ profileId: "pw" }, { getProfile: lookup(PROFILES) });
  assert.equal(r.ok, true);
  assert.equal(r.autoConnect, false);
  assert.match(r.reason ?? "", /not auto-connectable|key auth|connect manually/i);
  // Even for a password profile, no secret crosses the boundary.
  assert.doesNotMatch(JSON.stringify(r), /password=|--password|sshpass/i);
});

test("manual_password opens but is flagged as prompting (not auto)", () => {
  const r = resolveTerminalOpenRequest({ profileId: "manual" }, { getProfile: lookup(PROFILES) });
  assert.equal(r.autoConnect, false);
  assert.match(r.reason ?? "", /prompt/i);
});

test("a password-bearing open request is rejected (profileId only)", () => {
  assert.throws(
    () => resolveTerminalOpenRequest({ profileId: "pw", password: "nope" } as unknown as { profileId: string }, { getProfile: lookup(PROFILES) }),
    /inline secret|profileId/i,
  );
});

test("unknown profile resolves to a not-ok result, not a crash", () => {
  const r = resolveTerminalOpenRequest({ profileId: "ghost" }, { getProfile: lookup(PROFILES) });
  assert.equal(r.ok, false);
});
