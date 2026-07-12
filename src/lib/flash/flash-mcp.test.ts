import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

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
  deliverLearnSkillReply,
  resolveEscalationTarget,
  selfImproveRepoPath,
  escalationIsVoice,
} from "./flash-mcp";
import type { LaneToolContext } from "@/lib/orchestrator/lane-tools";
import type { AcquireResult } from "@/lib/skills/acquire";

test("flash-only tool names match the exported definitions 1:1", () => {
  assert.deepEqual(
    FLASH_ONLY_TOOL_DEFS.map((t) => t.function.name).sort(),
    [...FLASH_ONLY_TOOL_NAMES].sort(),
  );
});

test("isFlashOnlyTool distinguishes flash-only tools from lane tools", () => {
  assert.equal(isFlashOnlyTool("persona_update"), true);
  assert.equal(isFlashOnlyTool("escalate_to_task"), true);
  assert.equal(isFlashOnlyTool("learn_skill"), true);
  assert.equal(isFlashOnlyTool("brain_search"), false);
  assert.equal(isFlashOnlyTool("mail_send"), false);
});

test("FLASH_ONLY_TOOL_DEFS: learn_skill requires goal and why_needed, accepts an optional suggested_kind enum", () => {
  const def = FLASH_ONLY_TOOL_DEFS.find((t) => t.function.name === "learn_skill");
  assert.ok(def, "learn_skill def must exist");
  const params = def!.function.parameters as {
    properties: Record<string, { type: string; enum?: string[] }>;
    required: string[];
  };
  assert.ok(params.properties.goal);
  assert.ok(params.properties.why_needed);
  assert.deepEqual(params.required.slice().sort(), ["goal", "why_needed"]);
  assert.deepEqual(params.properties.suggested_kind?.enum, ["instruction", "script"]);
});

test("FLASH_ONLY_TOOL_DEFS: escalate_to_task accepts an optional kind enum [\"self-improvement\"]", () => {
  const def = FLASH_ONLY_TOOL_DEFS.find((t) => t.function.name === "escalate_to_task");
  assert.ok(def, "escalate_to_task def must exist");
  const params = def!.function.parameters as {
    properties: Record<string, { type: string; enum?: string[] }>;
    required: string[];
  };
  assert.ok(params.properties.title);
  assert.ok(params.properties.description);
  assert.ok(params.properties.projectPath);
  assert.deepEqual(params.properties.kind?.enum, ["self-improvement"]);
  // kind must stay optional — required list is unchanged from before this task.
  assert.deepEqual(params.required.slice().sort(), ["description", "title"]);
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

test("generated server: learn_skill is routed as a FLASH_ONLY tool (to /flash/tool/), and the on-disk copy is rewritten to match", () => {
  assert.match(FLASH_MCP_SERVER_JS, /FLASH_ONLY\s*=\s*\{[^}]*learn_skill:\s*1[^}]*\}/);

  // SERVER_VERSION must have been bumped so ensureFlashMcpServer() actually
  // rewrites a stale on-disk copy (from before this change) to include
  // learn_skill — prove the round trip end to end.
  const serverPath = ensureFlashMcpServer();
  const onDisk = readFileSync(serverPath, "utf-8");
  assert.equal(onDisk, FLASH_MCP_SERVER_JS + "\n");
  assert.match(onDisk, /learn_skill:\s*1/);
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

// ------------------------------------------------------------------
// learn_skill (P2.4) — async speak-back, mirroring deep_think/heartbeat's
// pattern in voice/command-turn.ts. dispatchFlashOnlyTool has no injectable
// acquire seam (by design — it's the real daemon dispatch point), so the
// "returns immediately, never blocks on acquisition" property is proven two
// ways: (a) the missing-goal path below, which returns before delivery is
// ever kicked off, and (b) deliverLearnSkillReply's own tests, which inject
// acquire/synthesize/broadcast stubs directly rather than routing through
// dispatch — routing a *valid* goal through dispatch here would fire the
// REAL acquireSkill defaults (a live Sonnet mint + Haiku critic pass against
// this machine's actual skill library), which is not something a fast,
// side-effect-free unit test should ever trigger.
// ------------------------------------------------------------------

test("dispatchFlashOnlyTool: learn_skill requires a goal and returns immediately without kicking off delivery", async () => {
  const result = await dispatchFlashOnlyTool("learn_skill", { why_needed: "test" }, { brainRoot: null, sessionId: "s1" });
  assert.equal(result, "Error: goal is required");
});

test("deliverLearnSkillReply: voice channel broadcasts voice:result with the honest reason, ok:true, and synthesizes audio", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  let synthCalled = false;
  await deliverLearnSkillReply({
    sessionId: "s1",
    channel: "voice",
    goal: "count files in Downloads",
    whyNeeded: "user asked",
    acquire: async () =>
      ({ outcome: "registered", skillName: "count_files", reason: "I learned a new skill: x." } as AcquireResult),
    synthesize: async () => { synthCalled = true; return ""; },
    broadcast: (event, data) => events.push({ event, data: data as Record<string, unknown> }),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "voice:result");
  assert.equal(events[0].data.text, "I learned a new skill: x.");
  assert.equal(events[0].data.ok, true);
  assert.equal(events[0].data.sessionId, "s1");
  assert.equal(synthCalled, true);
});

test("deliverLearnSkillReply: chat channel broadcasts flash:notice with the honest reason, ok:true, no synth needed", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  let synthCalled = false;
  await deliverLearnSkillReply({
    sessionId: "s2",
    channel: "console",
    goal: "count files in Downloads",
    whyNeeded: "user asked",
    acquire: async () =>
      ({ outcome: "already-have", skillName: "count_files", reason: "I already have a skill for that." } as AcquireResult),
    synthesize: async () => { synthCalled = true; return ""; },
    broadcast: (event, data) => events.push({ event, data: data as Record<string, unknown> }),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "flash:notice");
  assert.equal(events[0].data.text, "I already have a skill for that.");
  assert.equal(events[0].data.ok, true);
  assert.equal(synthCalled, false);
});

test("deliverLearnSkillReply: a failure outcome still speaks the honest reason, with ok:false", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  await deliverLearnSkillReply({
    sessionId: "s3",
    channel: "console",
    goal: "do something impossible",
    whyNeeded: "user asked",
    acquire: async () => ({ outcome: "draft-failed", reason: "it didn't pass its own tests" } as AcquireResult),
    broadcast: (event, data) => events.push({ event, data: data as Record<string, unknown> }),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "flash:notice");
  assert.equal(events[0].data.text, "it didn't pass its own tests");
  assert.equal(events[0].data.ok, false);
});

test("deliverLearnSkillReply: the hard wall-clock cap fires before a never-resolving acquisition, ok:false, completes quickly", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const start = Date.now();
  await deliverLearnSkillReply({
    sessionId: "s4",
    channel: "console",
    goal: "never finishes",
    whyNeeded: "user asked",
    acquire: () => new Promise<AcquireResult>(() => { /* never resolves */ }),
    wallClockMs: 20,
    broadcast: (event, data) => events.push({ event, data: data as Record<string, unknown> }),
  });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `expected the wall-clock cap to fire quickly, took ${elapsed}ms`);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "flash:notice");
  assert.match(String(events[0].data.text), /couldn't finish learning that in time/);
  assert.equal(events[0].data.ok, false);
});

test("deliverLearnSkillReply: a throwing acquire still delivers an honest failure notice, never rejects", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  await deliverLearnSkillReply({
    sessionId: "s5",
    channel: "console",
    goal: "count files in Downloads",
    whyNeeded: "user asked",
    acquire: async () => { throw new Error("mint backend unreachable"); },
    broadcast: (event, data) => events.push({ event, data: data as Record<string, unknown> }),
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].data.ok, false);
  assert.match(String(events[0].data.text), /mint backend unreachable/);
});

// ------------------------------------------------------------------
// escalate_to_task self-improvement kind (P3.2) — resolveEscalationTarget is
// the pure decision helper factored out of handleEscalateToTask so this logic
// is unit-testable without spinning up Task.create's real db. The repo path
// is injected (not read from config inside the helper) to keep it pure;
// selfImproveRepoPath() is the separate (also exported) config reader that
// handleEscalateToTask wires in at the real dispatch site.
// ------------------------------------------------------------------

test("resolveEscalationTarget: kind 'self-improvement' routes to the repo path and prefixes the Superpowers requirement", () => {
  const result = resolveEscalationTarget({
    title: "Add a new lane tool",
    description: "Wire up a new tool for X.",
    kind: "self-improvement",
    argProjectPath: "/some/other/project",
    repoPath: "/Users/irvcassio/hivematrix",
  });
  assert.equal(result.isSelfImprove, true);
  assert.equal(result.projectPath, "/Users/irvcassio/hivematrix");
  assert.match(result.description, /Superpowers pipeline/);
  assert.match(result.description, /AGENTS\.md/);
  assert.match(result.description, /Do NOT release/);
  assert.match(result.description, /Wire up a new tool for X\.$/);
});

test("resolveEscalationTarget: description naming HiveMatrix (no kind) is also treated as self-improvement", () => {
  const result = resolveEscalationTarget({
    title: "Fix a bug",
    description: "There's a bug in HiveMatrix's voice loop-closer.",
    argProjectPath: undefined,
    repoPath: "/Users/irvcassio/hivematrix",
  });
  assert.equal(result.isSelfImprove, true);
  assert.equal(result.projectPath, "/Users/irvcassio/hivematrix");
  assert.match(result.description, /Superpowers pipeline/);
});

test("resolveEscalationTarget: title naming Hive Matrix (spaced, no kind) is also treated as self-improvement", () => {
  const result = resolveEscalationTarget({
    title: "Improve the Hive Matrix onboarding flow",
    description: "Make onboarding smoother.",
    argProjectPath: undefined,
    repoPath: "/repo/path",
  });
  assert.equal(result.isSelfImprove, true);
  assert.equal(result.projectPath, "/repo/path");
});

test("resolveEscalationTarget: neither kind nor HiveMatrix mention — projectPath falls back to arg or homedir, no prefix", () => {
  const withArg = resolveEscalationTarget({
    title: "Clean my inbox",
    description: "Archive old newsletters.",
    argProjectPath: "/some/project",
    repoPath: "/Users/irvcassio/hivematrix",
  });
  assert.equal(withArg.isSelfImprove, false);
  assert.equal(withArg.projectPath, "/some/project");
  assert.equal(withArg.description, "Archive old newsletters.");

  const withoutArg = resolveEscalationTarget({
    title: "Clean my inbox",
    description: "Archive old newsletters.",
    argProjectPath: undefined,
    repoPath: "/Users/irvcassio/hivematrix",
  });
  assert.equal(withoutArg.isSelfImprove, false);
  assert.equal(withoutArg.projectPath, homedir());
  assert.equal(withoutArg.description, "Archive old newsletters.");
});

// ------------------------------------------------------------------
// escalationIsVoice (unified-session follow-on) — after store.ts's
// getOrCreateSession collapses console+voice into one shared "operator"
// session row, the session row's `channel` column can no longer answer
// "was THIS turn voice?" (see store.ts's storageChannel). escalate_to_task
// now keys voice-origin marking off the REQUEST's channel (threaded through
// loop.ts -> flash-mcp's MCP env -> this pure helper) instead of a
// getSession(sessionId)?.channel lookup.
// ------------------------------------------------------------------

test("escalationIsVoice is true only for the literal 'voice' channel", () => {
  assert.equal(escalationIsVoice("voice"), true);
  assert.equal(escalationIsVoice("console"), false);
  assert.equal(escalationIsVoice("watch"), false);
  assert.equal(escalationIsVoice(""), false);
  assert.equal(escalationIsVoice(undefined), false);
});

// ------------------------------------------------------------------
// prepareFlashMcp channel plumbing — the per-request channel must reach the
// MCP child (HIVE_FLASH_CHANNEL) so dispatchFlashOnlyTool receives it via
// the generated server's postJson body, independent of session storage.
// ------------------------------------------------------------------

test("prepareFlashMcp writes the per-request channel into the MCP config env as HIVE_FLASH_CHANNEL", () => {
  const ctx: LaneToolContext = { projectPath: "/tmp", project: "hivematrix", requestedBy: "flash:s1" };
  const { configPath } = prepareFlashMcp("3747", process.execPath, { brainRoot: null, ctx, sessionId: "s1", channel: "voice" });
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  assert.equal(config.mcpServers[FLASH_MCP_SERVER_NAME].env.HIVE_FLASH_CHANNEL, "voice");
});

test("prepareFlashMcp defaults HIVE_FLASH_CHANNEL to empty string when no channel is given", () => {
  const ctx: LaneToolContext = { projectPath: "/tmp", project: "hivematrix", requestedBy: "flash:s1" };
  const { configPath } = prepareFlashMcp("3747", process.execPath, { brainRoot: null, ctx, sessionId: "s1" });
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  assert.equal(config.mcpServers[FLASH_MCP_SERVER_NAME].env.HIVE_FLASH_CHANNEL, "");
});

test("generated server: the flash-only postJson body forwards CHANNEL alongside sessionId", () => {
  assert.match(FLASH_MCP_SERVER_JS, /HIVE_FLASH_CHANNEL/);
  assert.match(FLASH_MCP_SERVER_JS, /channel:\s*CHANNEL/);
});

test("selfImproveRepoPath: falls back to process.cwd() when selfImprove.repoPath is unset", () => {
  // No config fixture is injected here (config.ts has no test seam) — this
  // exercises the real loadHiveConfig() against whatever ~/.hivematrix/config.json
  // exists on the test machine. Absent a selfImprove.repoPath key there, the
  // fallback is process.cwd(); if a key IS present, this just asserts it's a
  // non-empty string, since we can't control that file's contents from here.
  const result = selfImproveRepoPath();
  assert.equal(typeof result, "string");
  assert.ok(result.length > 0);
});
