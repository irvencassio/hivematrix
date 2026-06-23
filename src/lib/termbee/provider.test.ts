import assert from "node:assert/strict";
import test from "node:test";

import { createTermBeeProvider, type CanopyTerminalClient, type LocalTermBeeClient } from "./provider";

const terminalCapabilities = [
  { name: "terminal.sessions.list", inputKeys: [] },
  { name: "terminal.session.open_local", inputKeys: [] },
  { name: "terminal.session.read", inputKeys: ["sessionID", "lines"] },
  { name: "terminal.session.send", inputKeys: ["sessionID", "text"] },
];

test("provider opens and runs commands through Canopy when available", async () => {
  const calls: Array<{ capability: string; payload: Record<string, string>; explicitApproval?: boolean }> = [];
  let sessions: Array<{ id: string; isConnected: string }> = [];
  let terminalText = "";

  const canopy: CanopyTerminalClient = {
    listCapabilities: async () => terminalCapabilities,
    invoke: async (capability, payload, opts) => {
      calls.push({ capability, payload, explicitApproval: opts?.explicitApproval });
      if (capability === "terminal.sessions.list") return { data: sessions };
      if (capability === "terminal.session.open_local") {
        sessions = [{ id: "canopy-1", isConnected: "true" }];
        return { data: { status: "opened" } };
      }
      if (capability === "terminal.session.send") {
        const start = payload.text.match(/(__TERMBEE_START_[A-Za-z0-9_]+__)/)?.[1] ?? "";
        const done = payload.text.match(/(__TERMBEE_DONE_[A-Za-z0-9_]+__)/)?.[1] ?? "";
        terminalText = `${start}\nhello-from-canopy\n${done}:0\n`;
        return { data: { status: "sent" } };
      }
      if (capability === "terminal.session.read") {
        return { data: { text: terminalText } };
      }
      return { error: { code: "unknown", message: capability } };
    },
  };

  const provider = createTermBeeProvider({ canopy, pollIntervalMs: 1, maxPolls: 2 });
  const id = await provider.createSession({ id: "term-1" });
  const result = await provider.runCommand(id, "echo hello-from-canopy");

  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.output, /hello-from-canopy/);
  assert.deepEqual(calls.map((call) => call.capability), [
    "terminal.sessions.list",
    "terminal.session.open_local",
    "terminal.sessions.list",
    "terminal.session.send",
    "terminal.session.read",
  ]);
  assert.equal(calls.find((call) => call.capability === "terminal.session.send")?.explicitApproval, true);
});

test("provider falls back to the local shell when Canopy is unavailable", async () => {
  const localCalls: string[] = [];
  const canopy: CanopyTerminalClient = {
    listCapabilities: async () => { throw new Error("Canopy is not running"); },
    invoke: async () => ({ error: { code: "unreachable", message: "nope" } }),
  };
  const local: LocalTermBeeClient = {
    createSession: (opts) => {
      localCalls.push(`create:${opts.id ?? ""}`);
      return opts.id ?? "local-generated";
    },
    listSessions: () => [],
    killSession: () => true,
    runCommand: async (id, command) => {
      localCalls.push(`run:${id}:${command}`);
      return { output: "local-output", exitCode: 0, timedOut: false };
    },
  };

  const provider = createTermBeeProvider({ canopy, local });
  const id = await provider.createSession({ id: "fallback-1" });
  const result = await provider.runCommand(id, "pwd");

  assert.equal(id, "fallback-1");
  assert.deepEqual(result, { output: "local-output", exitCode: 0, timedOut: false });
  assert.deepEqual(localCalls, ["create:fallback-1", "run:fallback-1:pwd"]);
});
