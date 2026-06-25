import assert from "node:assert/strict";
import test from "node:test";

import { BrowserLaneKeychain } from "./keychain";

test("keychain adapter saves and reads credentials without exposing diagnostics", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const secrets = new Map<string, string>();
  const keychain = new BrowserLaneKeychain({
    run: async (file, args) => {
      calls.push({ file, args });
      const account = args[args.indexOf("-a") + 1];
      if (args[0] === "add-generic-password") {
        secrets.set(account, args[args.indexOf("-w") + 1]);
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "find-generic-password") {
        return { stdout: secrets.get(account) ?? "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  });

  await keychain.saveCredential({
    siteId: "heygen",
    credentialRef: "hivematrix.browser.heygen.primary",
    username: "user@example.com",
    password: "super-secret",
  });

  const credential = await keychain.readCredential({
    siteId: "heygen",
    credentialRef: "hivematrix.browser.heygen.primary",
  });
  assert.equal(credential.username, "user@example.com");
  assert.equal(credential.password, "super-secret");
  assert.equal(keychain.redactedDiagnostic(calls[0]), "security add-generic-password [redacted]");
});

test("keychain adapter rejects unsupported secret kinds", async () => {
  const keychain = new BrowserLaneKeychain({ run: async () => ({ stdout: "", stderr: "" }) });
  await assert.rejects(
    () => keychain.saveSecret({ account: "heygen:cookie", value: "cookie", kind: "cookie" as never }),
    /Unsupported/,
  );
});
