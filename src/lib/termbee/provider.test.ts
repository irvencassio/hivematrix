import assert from "node:assert/strict";
import test from "node:test";

import { createTermBeeProvider, type LocalTermBeeClient } from "./provider";

test("provider delegates session lifecycle to the local shell engine", async () => {
  const localCalls: string[] = [];
  const local: LocalTermBeeClient = {
    createSession: (opts) => {
      localCalls.push(`create:${opts.id ?? ""}`);
      return opts.id ?? "local-generated";
    },
    listSessions: () => {
      localCalls.push("list");
      return [{ id: "s1", cwd: "/tmp", alive: true, createdAt: "2026-06-25T00:00:00.000Z" }];
    },
    killSession: (id) => {
      localCalls.push(`kill:${id}`);
      return true;
    },
    runCommand: async (id, command) => {
      localCalls.push(`run:${id}:${command}`);
      return { output: "local-output", exitCode: 0, timedOut: false };
    },
  };

  const provider = createTermBeeProvider({ local });
  const id = await provider.createSession({ id: "term-1" });
  const sessions = await provider.listSessions();
  const result = await provider.runCommand(id, "pwd");
  const killed = await provider.killSession(id);

  assert.equal(id, "term-1");
  assert.deepEqual(sessions, [{ id: "s1", cwd: "/tmp", alive: true, createdAt: "2026-06-25T00:00:00.000Z" }]);
  assert.deepEqual(result, { output: "local-output", exitCode: 0, timedOut: false });
  assert.equal(killed, true);
  assert.deepEqual(localCalls, ["create:term-1", "list", "run:term-1:pwd", "kill:term-1"]);
});

test("provider has no Canopy / external-bridge dependency", async () => {
  // The provider must be self-contained: no `canopy` option, no agent-bridge calls.
  const provider = createTermBeeProvider({});
  assert.equal(typeof provider.runCommand, "function");

  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./provider.ts", import.meta.url), "utf-8"),
  );
  assert.doesNotMatch(source, /canopy/i, "provider.ts must not reference Canopy");
});
