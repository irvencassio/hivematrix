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
