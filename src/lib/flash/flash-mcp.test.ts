import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  FLASH_MCP_SERVER_NAME,
  FLASH_MCP_SERVER_JS,
  FLASH_ONLY_TOOL_NAMES,
  FLASH_ONLY_TOOL_DEFS,
  isFlashOnlyTool,
  dispatchFlashOnlyTool,
  buildFlashMcpToolCatalog,
  ensureFlashMcpServer,
  prepareFlashMcp,
} from "./flash-mcp";
import type { LaneToolContext } from "@/lib/orchestrator/lane-tools";

test("flash-only tool names match the exported definitions 1:1", () => {
  assert.deepEqual(
    FLASH_ONLY_TOOL_DEFS.map((t) => t.function.name).sort(),
    [...FLASH_ONLY_TOOL_NAMES].sort(),
  );
});

test("isFlashOnlyTool distinguishes flash-only tools from lane tools", () => {
  assert.equal(isFlashOnlyTool("persona_update"), true);
  assert.equal(isFlashOnlyTool("escalate_to_task"), true);
  assert.equal(isFlashOnlyTool("brain_search"), false);
  assert.equal(isFlashOnlyTool("mail_send"), false);
});

test("dispatchFlashOnlyTool refuses an unknown tool name", async () => {
  const result = await dispatchFlashOnlyTool("not_a_real_tool", {}, { brainRoot: null, sessionId: "s1" });
  assert.match(result, /^Error: Unknown flash-only tool/);
});

test("dispatchFlashOnlyTool: persona_update rejects a bad brainRoot / bad file name", async () => {
  const badFile = await dispatchFlashOnlyTool("persona_update", { file: "NOTES.md", content: "x", reason: "r" }, { brainRoot: "/tmp", sessionId: "s1" });
  assert.match(badFile, /invalid persona file/);

  const noBrainRoot = await dispatchFlashOnlyTool("persona_update", { file: "SOUL.md", content: "x", reason: "r" }, { brainRoot: null, sessionId: "s1" });
  assert.match(noBrainRoot, /brain root not configured/);
});

test("buildFlashMcpToolCatalog reuses the OpenAI function-shape parameters verbatim as inputSchema", () => {
  const catalog = buildFlashMcpToolCatalog(FLASH_ONLY_TOOL_DEFS);
  const personaUpdate = catalog.find((t) => t.name === "persona_update");
  assert.ok(personaUpdate);
  assert.equal(personaUpdate!.description, FLASH_ONLY_TOOL_DEFS[0].function.description);
  assert.deepEqual(personaUpdate!.inputSchema, FLASH_ONLY_TOOL_DEFS[0].function.parameters);
});

test("embedded server is valid JavaScript (no syntax error in the generated source)", () => {
  assert.doesNotThrow(() => new Function(FLASH_MCP_SERVER_JS));
});

test("embedded server speaks the JSON-RPC methods Claude's MCP client needs, and proxies both routes", () => {
  for (const method of ["initialize", "tools/list", "tools/call", "notifications/initialized"]) {
    assert.match(FLASH_MCP_SERVER_JS, new RegExp(method.replace("/", "\\/")));
  }
  assert.match(FLASH_MCP_SERVER_JS, /\/bee\//);
  assert.match(FLASH_MCP_SERVER_JS, /\/flash\/tool\//);
  assert.match(FLASH_MCP_SERVER_JS, /auth-token/);
  assert.match(FLASH_MCP_SERVER_JS, /Bearer/);
});

test("embedded server hard-gates tools/call against the allow-list, independent of tools/list", () => {
  assert.match(FLASH_MCP_SERVER_JS, /HIVE_FLASH_ALLOWED/);
  assert.match(FLASH_MCP_SERVER_JS, /is not permitted in this pass/);
  assert.match(FLASH_MCP_SERVER_JS, /isAllowed/);
});

test("prepareFlashMcp: gating filter narrows --allowedTools to the read-only set", () => {
  const ctx: LaneToolContext = { projectPath: "/tmp", project: "hivematrix", requestedBy: "flash:s1" };
  const { toolNames } = prepareFlashMcp("3747", process.execPath, {
    allowedTools: (name) => name === "brain_search",
    brainRoot: null,
    ctx,
    sessionId: "s1",
  });
  assert.deepEqual(toolNames, ["mcp__flash__brain_search"]);
});

test("prepareFlashMcp: no filter offers the full lane + flash-only catalog", () => {
  const ctx: LaneToolContext = { projectPath: "/tmp", project: "hivematrix", requestedBy: "flash:s1" };
  const { toolNames } = prepareFlashMcp("3747", process.execPath, { brainRoot: null, ctx, sessionId: "s1" });
  assert.ok(toolNames.includes("mcp__flash__brain_search"));
  assert.ok(toolNames.includes("mcp__flash__persona_update"));
  assert.ok(toolNames.includes("mcp__flash__escalate_to_task"));
});

// ------------------------------------------------------------------
// Standalone smoke test — materialize the real generated server file and
// drive it over stdio exactly as the `claude` CLI would (no live model
// involved). This is the check called out in the cutover plan's Phase 3
// verify step: initialize + tools/list, then a read tool under a read-only
// allow-list (expect allowed) and a write tool under the same allow-list
// (expect refused).
// ------------------------------------------------------------------

interface JsonRpcMsg {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: unknown;
}

function runServerConversation(serverPath: string, env: Record<string, string>, requests: object[]): Promise<JsonRpcMsg[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [serverPath], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const responses: JsonRpcMsg[] = [];
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`flash-server smoke test timed out; got ${responses.length}/${requests.length} responses`));
    }, 10_000);

    proc.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        responses.push(JSON.parse(line) as JsonRpcMsg);
        if (responses.length === requests.length) {
          clearTimeout(timeout);
          proc.kill();
          resolve(responses);
        }
      }
    });
    proc.stderr.on("data", () => { /* ignore */ });
    proc.on("error", (err) => { clearTimeout(timeout); reject(err); });

    for (const req of requests) proc.stdin.write(`${JSON.stringify(req)}\n`);
  });
}

test("flash MCP server smoke test: initialize, tools/list, then read-tool allowed / write-tool refused", async () => {
  const ctx: LaneToolContext = { projectPath: "/tmp", project: "hivematrix", requestedBy: "flash:smoke" };
  // Read-only pass: the same predicate the heartbeat's manual autonomy uses.
  const { configPath } = prepareFlashMcp("3747", process.execPath, {
    allowedTools: (name) => name === "brain_search", // one read tool, nothing else
    brainRoot: null,
    ctx,
    sessionId: "smoke-session",
  });
  const serverPath = ensureFlashMcpServer();
  assert.ok(serverPath.endsWith("flash-server.cjs"));

  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const env: Record<string, string> = config.mcpServers[FLASH_MCP_SERVER_NAME].env;

  const responses = await runServerConversation(serverPath, env, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "brain_search", arguments: { query: "test" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "mail_send", arguments: { to: "x@example.com", subject: "s", body: "b" } } },
  ]);

  // 1. initialize
  const init = responses.find((r) => r.id === 1)!;
  assert.equal((init.result as { serverInfo: { name: string } }).serverInfo.name, "flash");

  // 2. tools/list — the FULL catalog, not narrowed by the allow-list (see
  // flash-mcp.ts header: this is what makes the allow-list gate independently
  // testable — the write tool is listed, but calling it is still refused below).
  const list = responses.find((r) => r.id === 2)!;
  const toolNames = (list.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  assert.ok(toolNames.includes("brain_search"), "read tool must be listed");
  assert.ok(toolNames.includes("mail_send"), "write tool must be listed (list is not allow-list-filtered)");

  // 3. tools/call for the allowed read tool — the daemon isn't running in this
  // test, so the underlying /bee/brain_search POST fails at the network layer,
  // but that failure is a "daemon unreachable" JSON payload, NOT a permission
  // refusal — proving the gate let the call through to the dispatch attempt.
  const readCall = responses.find((r) => r.id === 3)!;
  const readText = (readCall.result as { content: Array<{ text: string }>; isError?: boolean }).content[0].text;
  assert.equal((readCall.result as { isError?: boolean }).isError, undefined);
  assert.doesNotMatch(readText, /is not permitted in this pass/);

  // 4. tools/call for a tool NOT in the allow-list — hard-refused at dispatch,
  // never reaching the network at all.
  const writeCall = responses.find((r) => r.id === 4)!;
  const writeResult = writeCall.result as { content: Array<{ text: string }>; isError?: boolean };
  assert.equal(writeResult.isError, true);
  assert.match(writeResult.content[0].text, /is not permitted in this pass/);
});
