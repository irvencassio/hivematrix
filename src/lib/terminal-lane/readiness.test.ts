import assert from "node:assert/strict";
import test from "node:test";

import { runTerminalReadinessProbe } from "./readiness";

test("local readiness uses true and reports ready", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const result = await runTerminalReadinessProbe({
    profile: { id: "local", displayName: "Local", kind: "local", shell: "/bin/zsh" },
    run: async (file, args) => {
      calls.push({ file, args });
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(result.state.status, "ready");
  assert.deepEqual(calls, [{ file: "/usr/bin/true", args: [] }]);
});

test("ssh readiness uses BatchMode and never passes secrets", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const result = await runTerminalReadinessProbe({
    profile: { id: "prod", displayName: "Prod", kind: "ssh", host: "prod.example", user: "deploy", port: 2222 },
    run: async (file, args) => {
      calls.push({ file, args });
      return { exitCode: 255, stdout: "", stderr: "Permission denied (publickey,password)." };
    },
  });

  assert.equal(result.state.status, "needs_auth");
  assert.equal(calls[0].file, "/usr/bin/ssh");
  assert.ok(calls[0].args.includes("BatchMode=yes"));
  assert.ok(calls[0].args.includes("deploy@prod.example"));
  assert.equal(calls[0].args.some((arg) => /password|secret/i.test(arg)), false);
});

test("ssh_key_file readiness probes with the identity file, never a secret", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  await runTerminalReadinessProbe({
    profile: { id: "kf", displayName: "KF", authMethod: "ssh_key_file", host: "h.example", user: "u", keyPath: "/Users/me/.ssh/id_ed25519" },
    run: async (file, args) => { calls.push({ file, args }); return { exitCode: 0, stdout: "", stderr: "" }; },
  });
  assert.equal(calls[0].file, "/usr/bin/ssh");
  assert.ok(calls[0].args.includes("-i"));
  assert.ok(calls[0].args.includes("/Users/me/.ssh/id_ed25519"));
  assert.equal(calls[0].args.some((a) => /password|passphrase|secret/i.test(a)), false);
});

test("password_keychain readiness does NOT spawn raw ssh expecting a password", async () => {
  let spawned = false;
  const result = await runTerminalReadinessProbe({
    profile: { id: "pw", displayName: "PW", authMethod: "password_keychain", host: "h.example", user: "u", credentialRef: "hivematrix.terminal.pw" },
    run: async () => { spawned = true; return { exitCode: 0, stdout: "", stderr: "" }; },
  });
  assert.equal(spawned, false, "must not spawn ssh for a password profile");
  assert.equal(result.state.status, "needs_auth");
  assert.match(result.summary, /not auto-connectable|key auth|connect manually/i);
});

test("manual_password readiness does NOT spawn ssh and explains it prompts", async () => {
  let spawned = false;
  const result = await runTerminalReadinessProbe({
    profile: { id: "m", displayName: "M", authMethod: "manual_password", host: "h.example", user: "u" },
    run: async () => { spawned = true; return { exitCode: 0, stdout: "", stderr: "" }; },
  });
  assert.equal(spawned, false);
  assert.match(result.summary, /prompt/i);
});
