import assert from "node:assert/strict";
import test from "node:test";

import { TerminalLaneKeychain } from "./keychain";

test("Terminal Lane keychain stores secrets through stdin and redacts diagnostics", async () => {
  const calls: Array<{ file: string; args: string[]; input?: string }> = [];
  const secrets = new Map<string, string>();
  const keychain = new TerminalLaneKeychain({
    run: async (file, args, opts) => {
      calls.push({ file, args, input: opts?.stdin });
      const account = args[args.indexOf("-a") + 1];
      if (args[0] === "add-generic-password") {
        secrets.set(account, opts?.stdin ?? "");
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "find-generic-password") {
        return { stdout: secrets.get(account) ?? "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  });

  await keychain.saveSecret({
    profileId: "prod",
    credentialRef: "hivematrix.terminal.prod.primary",
    kind: "ssh_key_passphrase",
    value: "super-secret",
  });

  assert.equal(await keychain.readSecret({ profileId: "prod", credentialRef: "hivematrix.terminal.prod.primary", kind: "ssh_key_passphrase" }), "super-secret");
  assert.equal(calls.some((call) => call.args.includes("super-secret")), false);
  assert.equal(keychain.redactedDiagnostic(calls[0]), "security add-generic-password [redacted]");
});

test("Terminal Lane keychain rejects non-terminal refs", async () => {
  const keychain = new TerminalLaneKeychain({ run: async () => ({ stdout: "", stderr: "" }) });
  await assert.rejects(
    () => keychain.saveSecret({ profileId: "prod", credentialRef: "hivematrix.browser.prod", kind: "password", value: "x" }),
    /hivematrix\.terminal/,
  );
});
