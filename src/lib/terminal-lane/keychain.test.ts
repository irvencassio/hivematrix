import assert from "node:assert/strict";
import test from "node:test";

import { TerminalLaneKeychain, terminalCredentialRef } from "./keychain";

test("Terminal Lane keychain saves SSH passwords as internet-password items keyed by host/user/port", async () => {
  const calls: Array<{ file: string; args: string[]; input?: string }> = [];
  const keychain = new TerminalLaneKeychain({
    run: async (file, args, opts) => {
      calls.push({ file, args, input: opts?.stdin });
      return { stdout: "", stderr: "" };
    },
  });

  await keychain.savePassword({ host: "10.80.114.11", user: "istai", port: 22, value: "super-secret" });

  assert.equal(calls.length, 1);
  // The secret travels over stdin to `security -i`, never through argv.
  assert.deepEqual(calls[0].args, ["-i"]);
  assert.equal(calls[0].args.includes("super-secret"), false);
  assert.match(calls[0].input ?? "", /^add-internet-password /);
  assert.match(calls[0].input ?? "", /-s "10\.80\.114\.11"/);
  assert.match(calls[0].input ?? "", /-a "istai"/);
  assert.match(calls[0].input ?? "", /-P 22/);
  assert.match(calls[0].input ?? "", /-r "ssh "/);
  assert.match(calls[0].input ?? "", /-w "super-secret"/);
  assert.equal(keychain.redactedDiagnostic(calls[0]), "security -i [redacted]");
});

test("Terminal Lane keychain escapes quotes and backslashes in the stored value", async () => {
  let input = "";
  const keychain = new TerminalLaneKeychain({
    run: async (_file, _args, opts) => {
      input = opts?.stdin ?? "";
      return { stdout: "", stderr: "" };
    },
  });
  await keychain.savePassword({ host: "example.com", user: "root", port: 22, value: 'pa"ss\\word' });
  assert.match(input, /-w "pa\\"ss\\\\word"/);
});

test("Terminal Lane keychain rejects passwords containing newlines", async () => {
  const keychain = new TerminalLaneKeychain({ run: async () => ({ stdout: "", stderr: "" }) });
  await assert.rejects(
    () => keychain.savePassword({ host: "example.com", user: "root", port: 22, value: "a\nb" }),
    /newline/i,
  );
});

test("Terminal Lane keychain reads a password back by host/user/port", async () => {
  const keychain = new TerminalLaneKeychain({
    run: async (file, args) => {
      assert.equal(file, "security");
      assert.deepEqual(args, ["find-internet-password", "-s", "10.80.114.11", "-a", "istai", "-P", "2222", "-r", "ssh ", "-w"]);
      return { stdout: "super-secret\n", stderr: "" };
    },
  });
  assert.equal(await keychain.readPassword({ host: "10.80.114.11", user: "istai", port: 2222 }), "super-secret");
});

test("Terminal Lane keychain reports absence instead of throwing when no item exists", async () => {
  const keychain = new TerminalLaneKeychain({
    run: async () => {
      throw new Error("security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.");
    },
  });
  assert.equal(await keychain.hasPassword({ host: "example.com", user: "root", port: 22 }), false);
  assert.equal(await keychain.readPassword({ host: "example.com", user: "root", port: 22 }), null);
});

test("Terminal Lane keychain requires host and user, and defaults the port to 22", async () => {
  const inputs: string[] = [];
  const keychain = new TerminalLaneKeychain({
    run: async (_file, _args, opts) => {
      inputs.push(opts?.stdin ?? "");
      return { stdout: "", stderr: "" };
    },
  });
  await assert.rejects(() => keychain.savePassword({ host: " ", user: "root", value: "x" }), /host/i);
  await assert.rejects(() => keychain.savePassword({ host: "example.com", user: "", value: "x" }), /user/i);
  await keychain.savePassword({ host: "example.com", user: "root", value: "x" });
  assert.match(inputs[0], /-P 22/);
});

test("terminalCredentialRef derives the canonical marker from a profile id", () => {
  assert.equal(terminalCredentialRef("AI Server"), "hivematrix.terminal.ai-server");
  assert.throws(() => terminalCredentialRef("bad/id"), /profile id/i);
});
