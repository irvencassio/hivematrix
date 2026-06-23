import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseCanopyTerminal,
  invokeCanopyCapability,
  loadCanopyBridgeConfigFromState,
  type CanopyCapability,
} from "./client";

test("loadCanopyBridgeConfigFromState parses persisted bridge state", () => {
  assert.deepEqual(
    loadCanopyBridgeConfigFromState({ port: "8421", token: "secret-token" }),
    { port: 8421, token: "secret-token" },
  );
  assert.deepEqual(loadCanopyBridgeConfigFromState({}), { port: 8421, token: "" });
  assert.deepEqual(loadCanopyBridgeConfigFromState({ port: "not-a-number" }), { port: 8421, token: "" });
});

test("canUseCanopyTerminal requires the terminal bridge capabilities", () => {
  const required: CanopyCapability[] = [
    { name: "terminal.sessions.list", inputKeys: [] },
    { name: "terminal.session.open_local", inputKeys: [] },
    { name: "terminal.session.read", inputKeys: ["sessionID", "lines"] },
    { name: "terminal.session.send", inputKeys: ["sessionID", "text"] },
  ];

  assert.equal(canUseCanopyTerminal(required), true);
  assert.equal(canUseCanopyTerminal(required.filter((c) => c.name !== "terminal.session.send")), false);
});

test("invokeCanopyCapability sends bearer auth and payload to the Canopy bridge", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ data: { status: "sent" } }), { status: 200 });
  };

  const result = await invokeCanopyCapability(
    "terminal.session.send",
    { sessionID: "abc", text: "echo hi\n" },
    { config: { port: 9000, token: "canopy-token" }, fetchImpl },
  );

  assert.deepEqual(result, { data: { status: "sent" } });
  assert.equal(calls[0].url, "http://127.0.0.1:9000/invoke");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer canopy-token");
  assert.equal(
    calls[0].init.body,
    JSON.stringify({
      capability: "terminal.session.send",
      payload: { sessionID: "abc", text: "echo hi\n" },
      explicitApproval: false,
    }),
  );
});
