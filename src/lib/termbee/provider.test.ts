import assert from "node:assert/strict";
import test from "node:test";

import { createTermBeeProvider, type LocalTermBeeClient } from "./provider";
import type { TerminalLaneAppClient } from "./app-client";

test("provider delegates session lifecycle to the local shell engine", async () => {
  const localCalls: string[] = [];
  const local: LocalTermBeeClient = {
    createSession: (opts) => {
      localCalls.push(`create:${opts.id ?? ""}:${opts.profileId ?? ""}`);
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
  assert.deepEqual(localCalls, ["create:term-1:", "list", "run:term-1:pwd", "kill:term-1"]);
});

test("provider passes Terminal Lane host binding to the local shell engine", async () => {
  let seen: unknown;
  const provider = createTermBeeProvider({
    local: {
      createSession: (opts) => {
        seen = opts;
        return "bound";
      },
      listSessions: () => [],
      killSession: () => true,
      runCommand: async () => ({ output: "", exitCode: 0, timedOut: false }),
    },
  });

  await provider.createSession({ id: "s1", profileId: "prod", openCommand: "ssh deploy@example.com" });
  assert.deepEqual(seen, { id: "s1", profileId: "prod", openCommand: "ssh deploy@example.com" });
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

test("provider prefers the visible Terminal Lane app when it is reachable", async () => {
  const localCalls: string[] = [];
  const appCalls: string[] = [];
  const local: LocalTermBeeClient = {
    createSession: (o) => { localCalls.push(`create:${o.id}`); return o.id ?? "x"; },
    listSessions: () => { localCalls.push("list"); return []; },
    killSession: (id) => { localCalls.push(`kill:${id}`); return true; },
    runCommand: async (id, c) => { localCalls.push(`run:${id}:${c}`); return { output: "local", exitCode: 0, timedOut: false }; },
  };
  const app: TerminalLaneAppClient = {
    createSession: async (o) => { appCalls.push(`create:${o.id}`); return o.id ?? "app"; },
    listSessions: async () => { appCalls.push("list"); return [{ id: "a1", cwd: "/tmp", alive: true, createdAt: "2026-07-03T00:00:00.000Z" }]; },
    killSession: async (id) => { appCalls.push(`kill:${id}`); return true; },
    runCommand: async (id, c) => { appCalls.push(`run:${id}:${c}`); return { output: "app-output", exitCode: 0, timedOut: false }; },
  };

  const provider = createTermBeeProvider({ local, app });
  const result = await provider.runCommand("s1", "pwd");

  assert.deepEqual(result, { output: "app-output", exitCode: 0, timedOut: false });
  assert.deepEqual(appCalls, ["run:s1:pwd"]);
  assert.deepEqual(localCalls, [], "local engine must not be touched while the app answers");
});

test("provider falls back to the local engine when the app is unreachable", async () => {
  const localCalls: string[] = [];
  const local: LocalTermBeeClient = {
    createSession: (o) => o.id ?? "x",
    listSessions: () => [],
    killSession: () => true,
    runCommand: async (id, c) => { localCalls.push(`run:${id}:${c}`); return { output: "local-output", exitCode: 0, timedOut: false }; },
  };
  const app: TerminalLaneAppClient = {
    createSession: async () => { throw new Error("ECONNREFUSED"); },
    listSessions: async () => { throw new Error("ECONNREFUSED"); },
    killSession: async () => { throw new Error("ECONNREFUSED"); },
    runCommand: async () => { throw new Error("ECONNREFUSED"); },
  };

  const provider = createTermBeeProvider({ local, app });
  const result = await provider.runCommand("s1", "pwd");

  assert.deepEqual(result, { output: "local-output", exitCode: 0, timedOut: false });
  assert.deepEqual(localCalls, ["run:s1:pwd"], "unreachable app must degrade to the local engine");
});
