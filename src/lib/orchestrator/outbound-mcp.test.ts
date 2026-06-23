import test from "node:test";
import assert from "node:assert/strict";
import {
  OUTBOUND_MCP_TOOL_NAMES,
  OUTBOUND_MCP_SERVER_NAME,
  OUTBOUND_MCP_SERVER_JS,
  buildOutboundMcpConfig,
} from "./outbound-mcp";

test("tool names are namespaced under the hivematrix MCP server", () => {
  assert.equal(OUTBOUND_MCP_SERVER_NAME, "hivematrix");
  assert.deepEqual(OUTBOUND_MCP_TOOL_NAMES, [
    "mcp__hivematrix__send_imessage",
    "mcp__hivematrix__send_email",
    "mcp__hivematrix__draft_email",
  ]);
});

test("buildOutboundMcpConfig wires the node command, server arg, and daemon port", () => {
  const cfg = buildOutboundMcpConfig("/path/to/node", "/p/outbound-server.cjs", "3999");
  const s = cfg.mcpServers.hivematrix;
  assert.equal(s.command, "/path/to/node");
  assert.deepEqual(s.args, ["/p/outbound-server.cjs"]);
  assert.equal(s.env.HIVE_DAEMON_PORT, "3999");
});

test("embedded server proxies the three trust-gated daemon routes", () => {
  // The server owns no logic — it must POST to the SAME endpoints the curl path
  // uses, so the allowlist/trust gate stays the single server-side source of truth.
  assert.match(OUTBOUND_MCP_SERVER_JS, /\/messagebee\/send/);
  assert.match(OUTBOUND_MCP_SERVER_JS, /\/mailbee\/send/);
  assert.match(OUTBOUND_MCP_SERVER_JS, /\/mailbee\/draft/);
});

test("embedded server speaks the JSON-RPC methods Claude's MCP client needs", () => {
  for (const method of ["initialize", "tools/list", "tools/call", "notifications/initialized"]) {
    assert.match(OUTBOUND_MCP_SERVER_JS, new RegExp(method.replace("/", "\\/")));
  }
  // Sends the daemon auth token so the gated endpoints accept the proxied call.
  assert.match(OUTBOUND_MCP_SERVER_JS, /auth-token/);
  assert.match(OUTBOUND_MCP_SERVER_JS, /Bearer/);
});

test("embedded server is valid JavaScript (no syntax error in the generated source)", () => {
  // new Function compiles the source in a non-module scope (the server is CJS),
  // catching brace/quote/escape regressions in the hand-embedded string without
  // executing it (it only runs its stdin loop when actually launched).
  assert.doesNotThrow(() => new Function(OUTBOUND_MCP_SERVER_JS));
});
