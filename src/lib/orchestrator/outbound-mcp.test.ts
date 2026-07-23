import test from "node:test";
import assert from "node:assert/strict";
import {
  OUTBOUND_MCP_TOOL_NAMES,
  OUTBOUND_MCP_SERVER_NAME,
  OUTBOUND_MCP_SERVER_JS,
  buildOutboundMcpConfig,
  outboundMcpToolNames,
  taskLaneToolCatalog,
} from "./outbound-mcp";

test("tool names are namespaced under the hivematrix MCP server", () => {
  assert.equal(OUTBOUND_MCP_SERVER_NAME, "hivematrix");
  assert.deepEqual(OUTBOUND_MCP_TOOL_NAMES, [
    "mcp__hivematrix__send_imessage",
    "mcp__hivematrix__send_email",
    "mcp__hivematrix__draft_email",
  ]);
});

// The list now also carries the lane tools (desktop_action, hivematrix_browser, …),
// which are connectivity-gated and therefore vary by machine//moment. These tests
// are about the OUTBOUND gating, so assert on the outbound names specifically
// rather than pinning a whole list that legitimately changes.
const outboundOnly = (names: string[]) =>
  names.filter((n) => /__(send_imessage|send_email|draft_email)$/.test(n));

test("tool names omit Mail Lane tools when Mail Lane is disabled", () => {
  assert.deepEqual(outboundOnly(outboundMcpToolNames({ mailLaneEnabled: false })), [
    "mcp__hivematrix__send_imessage",
  ]);
});

test("tool names omit Message Lane tools when Message Lane is disabled", () => {
  assert.deepEqual(outboundOnly(outboundMcpToolNames({ messageLaneEnabled: false })), [
    "mcp__hivematrix__send_email",
    "mcp__hivematrix__draft_email",
  ]);
});

test("tool names omit all outbound tools when both lanes are disabled", () => {
  assert.deepEqual(outboundOnly(outboundMcpToolNames({ mailLaneEnabled: false, messageLaneEnabled: false })), []);
});

test("task agents are offered the LANE tools too (desktop_action), not just the 3 outbound ones", () => {
  // Regression 2026-07-22: a task agent's whole toolset was send_imessage/
  // send_email/draft_email, while Flash got the full lane catalog. So Browser
  // Lane's desktop fallback — whose prompt says "Drive the browser yourself with
  // the desktop_action tool" — dispatched work to a process where that tool did
  // not exist. The agent reported "no desktop_action tools exist in this
  // environment", did nothing, and the task still finished as if it had.
  const catalog = taskLaneToolCatalog();
  const names = catalog.map((t) => t.name);
  assert.ok(names.includes("desktop_action"), `desktop_action must be offered to task agents; got: ${names.join(", ")}`);
  // Shape must be MCP-ready, or the CLI silently drops the tool.
  for (const t of catalog) {
    assert.equal(typeof t.name, "string");
    assert.equal(typeof t.description, "string");
    assert.ok(t.inputSchema && typeof t.inputSchema === "object", `${t.name} needs an inputSchema`);
  }
  // And they reach --allowedTools under the server namespace, so the CLI doesn't
  // prompt for something the daemon already gates.
  assert.ok(outboundMcpToolNames().includes("mcp__hivematrix__desktop_action"));
});

test("the generated server routes lane tools to /bee/:tool, not the form-encoded outbound endpoints", () => {
  // Lane tools take a JSON body; posting them form-encoded would silently lose
  // the nested args object.
  assert.match(OUTBOUND_MCP_SERVER_JS, /postJson\("\/bee\/" \+ name/, "lane calls proxy to /bee/:tool");
  assert.match(OUTBOUND_MCP_SERVER_JS, /args: a, projectPath: PROJECT_PATH, project: PROJECT/, "carries task context");
  assert.match(OUTBOUND_MCP_SERVER_JS, /HIVE_TASK_LANE_TOOLS_FILE/, "reads the catalog written at spawn time");
});

test("buildOutboundMcpConfig wires the node command, server arg, and daemon port", () => {
  const cfg = buildOutboundMcpConfig("/path/to/node", "/p/outbound-server.cjs", "3999", { mailLaneEnabled: false, messageLaneEnabled: false });
  const s = cfg.mcpServers.hivematrix;
  assert.equal(s.command, "/path/to/node");
  assert.deepEqual(s.args, ["/p/outbound-server.cjs"]);
  assert.equal(s.env.HIVE_DAEMON_PORT, "3999");
  assert.equal(s.env.HIVE_MAIL_LANE_ENABLED, "0");
  assert.equal(s.env.HIVE_MESSAGE_LANE_ENABLED, "0");
});

test("embedded server proxies the three trust-gated daemon routes", () => {
  // The server owns no logic — it must POST to the SAME endpoints the curl path
  // uses, so the allowlist/trust gate stays the single server-side source of truth.
  assert.match(OUTBOUND_MCP_SERVER_JS, /\/messagebee\/send/);
  assert.match(OUTBOUND_MCP_SERVER_JS, /\/mailbee\/send/);
  assert.match(OUTBOUND_MCP_SERVER_JS, /\/mailbee\/draft/);
});

test("embedded server describes outbound tools with lane names", () => {
  assert.match(OUTBOUND_MCP_SERVER_JS, /Message Lane/);
  assert.match(OUTBOUND_MCP_SERVER_JS, /Mail Lane/);
  assert.doesNotMatch(OUTBOUND_MCP_SERVER_JS, /MessageBee/);
  assert.doesNotMatch(OUTBOUND_MCP_SERVER_JS, /MailBee/);
});

test("embedded server speaks the JSON-RPC methods Claude's MCP client needs", () => {
  for (const method of ["initialize", "tools/list", "tools/call", "notifications/initialized"]) {
    assert.match(OUTBOUND_MCP_SERVER_JS, new RegExp(method.replace("/", "\\/")));
  }
  // Sends the daemon auth token so the gated endpoints accept the proxied call.
  assert.match(OUTBOUND_MCP_SERVER_JS, /auth-token/);
  assert.match(OUTBOUND_MCP_SERVER_JS, /Bearer/);
});

test("embedded server can hide and refuse Mail Lane tools when disabled", () => {
  assert.match(OUTBOUND_MCP_SERVER_JS, /HIVE_MAIL_LANE_ENABLED/);
  assert.match(OUTBOUND_MCP_SERVER_JS, /Mail Lane is disabled/);
  assert.match(OUTBOUND_MCP_SERVER_JS, /toolsForCurrentState/);
});

test("embedded server can hide and refuse Message Lane tools when disabled", () => {
  assert.match(OUTBOUND_MCP_SERVER_JS, /HIVE_MESSAGE_LANE_ENABLED/);
  assert.match(OUTBOUND_MCP_SERVER_JS, /Message Lane is disabled/);
  assert.match(OUTBOUND_MCP_SERVER_JS, /toolsForCurrentState/);
});

test("embedded server is valid JavaScript (no syntax error in the generated source)", () => {
  // new Function compiles the source in a non-module scope (the server is CJS),
  // catching brace/quote/escape regressions in the hand-embedded string without
  // executing it (it only runs its stdin loop when actually launched).
  assert.doesNotThrow(() => new Function(OUTBOUND_MCP_SERVER_JS));
});
