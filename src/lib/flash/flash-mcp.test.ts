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
  selectCuratedSkillEntries,
  sanitizeSkillToolName,
  buildCuratedSkillToolDefs,
  reservedFlashToolNames,
  DEFAULT_CURATED_TOP_N,
  DEFAULT_CURATED_CAP,
  type CuratedSkillToolDef,
} from "./flash-mcp";
import type { LaneToolContext } from "@/lib/orchestrator/lane-tools";
import type { AcquireResult } from "@/lib/skills/acquire";
import type { SkillIndexEntry } from "@/lib/skills/contracts";

function entry(over: Partial<SkillIndexEntry> = {}): SkillIndexEntry {
  return {
    name: over.name ?? "some-skill",
    description: over.description ?? "does a thing",
    tags: over.tags ?? [],
    useCount: over.useCount ?? 0,
    compat: over.compat ?? ["all"],
    hasInput: over.hasInput ?? false,
    params: over.params,
    trusted: over.trusted ?? true,
    kind: over.kind ?? "instruction",
    roles: over.roles ?? [],
    tool: over.tool,
  };
}

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
  assert.ok(params.properties.project);
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

test("resolveEscalationTarget: a hyphenated sibling repo name is NOT treated as core-repo self-improvement", () => {
  const watch = resolveEscalationTarget({
    title: "HiveMatrix-watch UX overhaul",
    description: "Improve voice dictation on the watch app.",
    argProjectPath: undefined,
    repoPath: "/Users/irvcassio/hivematrix",
  });
  assert.equal(watch.isSelfImprove, false, "hivematrix-watch is a different repo, not core self-improvement");
  assert.doesNotMatch(watch.description, /Superpowers pipeline/);

  const ios = resolveEscalationTarget({
    title: "fix a bug",
    description: "there's a crash in hivematrix-ios's onboarding flow",
    argProjectPath: undefined,
    repoPath: "/Users/irvcassio/hivematrix",
  });
  assert.equal(ios.isSelfImprove, false);
});

test("resolveEscalationTarget: neither kind nor HiveMatrix mention — projectPath falls back to arg or homedir, no prefix", () => {
  const withArg = resolveEscalationTarget({
    title: "Clean my inbox",
    description: "Archive old newsletters.",
    argProjectPath: "/some/project",
    repoPath: "/Users/irvcassio/hivematrix",
  });
  assert.equal(withArg.isSelfImprove, false);
  assert.equal(withArg.project, "project"); // basename("/some/project")
  assert.equal(withArg.projectPath, "/some/project");
  assert.equal(withArg.description, "Archive old newsletters.");

  const withoutArg = resolveEscalationTarget({
    title: "Clean my inbox",
    description: "Archive old newsletters.",
    argProjectPath: undefined,
    repoPath: "/Users/irvcassio/hivematrix",
  });
  assert.equal(withoutArg.isSelfImprove, false);
  assert.equal(withoutArg.project, "hivematrix");
  assert.equal(withoutArg.projectPath, homedir());
  assert.equal(withoutArg.description, "Archive old newsletters.");
});

test("resolveEscalationTarget: explicit resolvable project name wins, with the resolved (not hardcoded) name", () => {
  const result = resolveEscalationTarget({
    title: "Fix a UI bug",
    description: "The share sheet is misaligned.",
    argProject: "ops",
    argProjectPath: undefined,
    repoPath: "/Users/irvcassio/hivematrix",
  });
  assert.equal(result.isSelfImprove, false);
  assert.equal(result.project, "ops");
  assert.equal(result.projectPath, homedir());
  assert.equal(result.error, undefined);
});

test("resolveEscalationTarget: unresolvable project name errors instead of guessing homedir()", () => {
  const result = resolveEscalationTarget({
    title: "Fix a UI bug",
    description: "The share sheet is misaligned.",
    argProject: "totally-made-up-project-xyz",
    argProjectPath: undefined,
    repoPath: "/Users/irvcassio/hivematrix",
  });
  assert.match(result.error ?? "", /Cannot find project "totally-made-up-project-xyz"/);
  assert.equal(result.projectPath, "");
  assert.notEqual(result.projectPath, homedir(), "must not silently fall back to homedir()");
});

test("resolveEscalationTarget: explicit projectPath with no project name derives a real name, not the hardcoded 'hivematrix'", () => {
  const result = resolveEscalationTarget({
    title: "Fix a UI bug",
    description: "The share sheet is misaligned.",
    argProjectPath: "/Users/irvcassio/ohio-life-ace",
    repoPath: "/Users/irvcassio/hivematrix",
  });
  assert.equal(result.project, "ohio-life-ace");
  assert.equal(result.projectPath, "/Users/irvcassio/ohio-life-ace");
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
  // fallback chain is a discovered "hivematrix" repo, then process.cwd() (see
  // the discovery-fallback test below) — either way this just asserts a
  // non-empty string, since we can't control that file's contents from here.
  const result = selfImproveRepoPath();
  assert.equal(typeof result, "string");
  assert.ok(result.length > 0);
});

test("selfImproveRepoPath: prefers a discovered 'hivematrix' repo over raw cwd when unconfigured", async (t) => {
  // Can't isolate this the way aliases.test.ts / self-improve-prover.test.ts
  // do (swap $HOME, then discoverProjectsFresh()): this file's own top-level
  // static import of flash-mcp.ts already pulled in aliases.ts ->
  // project-discovery.ts before any test body runs, and project-discovery.ts
  // freezes its on-disk cache path (a module-level const built from
  // homedir()) at THAT import time — swapping process.env.HOME inside a test
  // body here would be too late to affect it, and calling
  // discoverProjectsFresh() would overwrite THIS machine's real
  // ~/.hivematrix/discovered-projects.json with fixture data instead of an
  // isolated temp one. So this proves the priority ordering (a discovered
  // repo wins over raw cwd) against the real, unmodified environment instead
  // — same environment-dependent style the test above already accepts for
  // this same function, for the same underlying reason (no HOME-injection
  // seam reaches this function's dependencies from inside this file).
  const { resolveProjectByName } = await import("@/lib/routing/aliases");
  const { discoverProjectsFresh } = await import("@/lib/routing/project-discovery");
  discoverProjectsFresh();
  const discovered = resolveProjectByName("hivematrix");
  if (!discovered) {
    t.skip("no discoverable 'hivematrix' repo under $HOME on this machine");
    return;
  }

  const { tmpdir } = await import("node:os");
  const elsewhere = tmpdir();
  const originalCwd = process.cwd();
  process.chdir(elsewhere);
  try {
    assert.equal(selfImproveRepoPath(), discovered.path, "must prefer the discovered repo over raw cwd");
    assert.notEqual(selfImproveRepoPath(), elsewhere);
  } finally {
    process.chdir(originalCwd);
  }
});

// ------------------------------------------------------------------
// Curated skills-as-tools — selection, name sanitization, tool synthesis,
// and dispatch (skill_<name> -> skill_run via /bee/skill_run). See the file
// header comment above buildCuratedSkillToolDefs for the design rationale.
// ------------------------------------------------------------------

test("DEFAULT_CURATED_TOP_N / DEFAULT_CURATED_CAP are the documented defaults (8 / 12)", () => {
  assert.equal(DEFAULT_CURATED_TOP_N, 8);
  assert.equal(DEFAULT_CURATED_CAP, 12);
});

test("selectCuratedSkillEntries: tool:true-tagged skills are always selected regardless of useCount", () => {
  const tagged = entry({ name: "Tagged Low Use", tool: true, useCount: 0 });
  const untaggedHighUse = entry({ name: "Untagged High Use", useCount: 50 });
  const { selected } = selectCuratedSkillEntries([tagged, untaggedHighUse]);
  assert.ok(selected.some((e) => e.name === "Tagged Low Use"));
  assert.ok(selected.some((e) => e.name === "Untagged High Use"));
});

test("selectCuratedSkillEntries: fills the remaining slots with the top-N non-tagged skills by useCount", () => {
  const entries = [
    entry({ name: "a", useCount: 10 }),
    entry({ name: "b", useCount: 5 }),
    entry({ name: "c", useCount: 1 }),
    entry({ name: "d", useCount: 0 }),
  ];
  const { selected } = selectCuratedSkillEntries(entries, { topN: 2, cap: 12 });
  assert.deepEqual(selected.map((e) => e.name), ["a", "b"]);
});

test("selectCuratedSkillEntries: ties in useCount break alphabetically for determinism", () => {
  const entries = [entry({ name: "zebra", useCount: 3 }), entry({ name: "apple", useCount: 3 })];
  const { selected } = selectCuratedSkillEntries(entries, { topN: 2 });
  assert.deepEqual(selected.map((e) => e.name), ["apple", "zebra"]);
});

test("selectCuratedSkillEntries: a tagged skill is never duplicated even if it would also rank in the top-N by usage", () => {
  const tagged = entry({ name: "both", tool: true, useCount: 999 });
  const { selected } = selectCuratedSkillEntries([tagged], { topN: 8 });
  assert.equal(selected.filter((e) => e.name === "both").length, 1);
});

test("selectCuratedSkillEntries: hard-caps the combined set, reporting the overflow as skipped", () => {
  const tagged = [entry({ name: "t1", tool: true }), entry({ name: "t2", tool: true }), entry({ name: "t3", tool: true })];
  const byUsage = [entry({ name: "u1", useCount: 9 }), entry({ name: "u2", useCount: 8 })];
  const { selected, skipped } = selectCuratedSkillEntries([...tagged, ...byUsage], { topN: 8, cap: 4 });
  assert.equal(selected.length, 4);
  assert.equal(skipped.length, 1);
  // Tagged skills win a slot over usage-ranked ones when the cap bites.
  assert.deepEqual(selected.map((e) => e.name), ["t1", "t2", "t3", "u1"]);
  assert.deepEqual(skipped.map((e) => e.name), ["u2"]);
});

test("sanitizeSkillToolName: lowercases, collapses non-alnum runs to one underscore, trims edges", () => {
  assert.equal(sanitizeSkillToolName("Triage Inbox"), "skill_triage_inbox");
  assert.equal(sanitizeSkillToolName("  Weird!!  Name--v2  "), "skill_weird_name_v2");
  assert.equal(sanitizeSkillToolName("already_snake_case"), "skill_already_snake_case");
});

test("sanitizeSkillToolName: an empty/symbols-only name still yields a valid tool name", () => {
  assert.equal(sanitizeSkillToolName("!!!"), "skill_skill");
});

test("buildCuratedSkillToolDefs: params become required string properties; a hasInput slot adds an optional input property", () => {
  const e = entry({ name: "Triage Inbox", description: "sort mail", params: ["sender", "priority"], hasInput: true });
  const { defs, skippedCollisions } = buildCuratedSkillToolDefs([e], new Set());
  assert.equal(skippedCollisions.length, 0);
  assert.equal(defs.length, 1);
  const def = defs[0];
  assert.equal(def.toolName, "skill_triage_inbox");
  assert.equal(def.skillName, "Triage Inbox");
  assert.equal(def.description, "sort mail");
  const schema = def.inputSchema as { properties: Record<string, { type: string }>; required: string[] };
  assert.ok(schema.properties.sender);
  assert.ok(schema.properties.priority);
  assert.ok(schema.properties.input);
  assert.deepEqual(schema.required.slice().sort(), ["priority", "sender"]);
  assert.ok(!schema.required.includes("input"), "input must stay optional");
});

test("buildCuratedSkillToolDefs: no params/no input yields an empty-but-valid schema", () => {
  const e = entry({ name: "Simple Ping" });
  const { defs } = buildCuratedSkillToolDefs([e], new Set());
  const schema = defs[0].inputSchema as { properties: Record<string, unknown>; required: string[] };
  assert.deepEqual(schema.properties, {});
  assert.deepEqual(schema.required, []);
});

test("buildCuratedSkillToolDefs: a sanitized name colliding with a reserved (native) tool name is skipped, not overwritten", () => {
  const e = entry({ name: "Run" }); // sanitizes to "skill_run" — collides with the native lane tool
  const { defs, skippedCollisions } = buildCuratedSkillToolDefs([e], new Set(["skill_run"]));
  assert.equal(defs.length, 0);
  assert.deepEqual(skippedCollisions, ["Run"]);
});

test("buildCuratedSkillToolDefs: two skills that sanitize to the same tool name — the second is skipped as a collision", () => {
  const e1 = entry({ name: "My Skill" });
  const e2 = entry({ name: "my_skill" }); // same sanitized name
  const { defs, skippedCollisions } = buildCuratedSkillToolDefs([e1, e2], new Set());
  assert.equal(defs.length, 1);
  assert.deepEqual(skippedCollisions, ["my_skill"]);
});

test("reservedFlashToolNames: includes native lane tools (brain_search, skill_run) and all four flash-only tools", () => {
  const reserved = reservedFlashToolNames();
  assert.ok(reserved.has("brain_search"));
  assert.ok(reserved.has("skill_run"));
  assert.ok(reserved.has("skill_used"));
  assert.ok(reserved.has("persona_update"));
  assert.ok(reserved.has("escalate_to_task"));
  assert.ok(reserved.has("learn_skill"));
});

test("prepareFlashMcp: curated skill tools are added to the offered catalog, namespaced like any other tool", () => {
  const ctx: LaneToolContext = { projectPath: "/tmp", project: "hivematrix", requestedBy: "flash:s1" };
  const curatedSkillTools: CuratedSkillToolDef[] = [
    { toolName: "skill_count_files", skillName: "Count Files", description: "count files", inputSchema: { type: "object", properties: {}, required: [] } },
  ];
  const { toolNames } = prepareFlashMcp("3747", process.execPath, {
    brainRoot: null, ctx, sessionId: "s1", curatedSkillTools,
  });
  assert.ok(toolNames.includes("mcp__flash__skill_count_files"));
  assert.ok(toolNames.includes("mcp__flash__skill_run"), "the generic fallback stays available alongside curated tools");
});

test("prepareFlashMcp: an allowedTools filter can exclude curated skill tools just like any other tool name", () => {
  const ctx: LaneToolContext = { projectPath: "/tmp", project: "hivematrix", requestedBy: "flash:s1" };
  const curatedSkillTools: CuratedSkillToolDef[] = [
    { toolName: "skill_count_files", skillName: "Count Files", description: "count files", inputSchema: { type: "object", properties: {}, required: [] } },
  ];
  const { toolNames } = prepareFlashMcp("3747", process.execPath, {
    allowedTools: (name) => name === "brain_search",
    brainRoot: null, ctx, sessionId: "s1", curatedSkillTools,
  });
  assert.deepEqual(toolNames, ["mcp__flash__brain_search"]);
});

test("prepareFlashMcp: writes a toolName -> skillName map file the generated server reads for dispatch translation", () => {
  const ctx: LaneToolContext = { projectPath: "/tmp", project: "hivematrix", requestedBy: "flash:s1" };
  const curatedSkillTools: CuratedSkillToolDef[] = [
    { toolName: "skill_count_files", skillName: "Count Files", description: "count files", inputSchema: { type: "object", properties: {}, required: [] } },
  ];
  const { configPath } = prepareFlashMcp("3747", process.execPath, { brainRoot: null, ctx, sessionId: "s1", curatedSkillTools });
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const mapFile = config.mcpServers[FLASH_MCP_SERVER_NAME].env.HIVE_FLASH_SKILL_TOOL_MAP_FILE;
  const map = JSON.parse(readFileSync(mapFile, "utf-8"));
  assert.deepEqual(map, { skill_count_files: "Count Files" });
});

test("prepareFlashMcp: with no curated skill tools, the skill-tool map file is written empty (never throws)", () => {
  const ctx: LaneToolContext = { projectPath: "/tmp", project: "hivematrix", requestedBy: "flash:s1" };
  const { configPath } = prepareFlashMcp("3747", process.execPath, { brainRoot: null, ctx, sessionId: "s1" });
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const mapFile = config.mcpServers[FLASH_MCP_SERVER_NAME].env.HIVE_FLASH_SKILL_TOOL_MAP_FILE;
  const map = JSON.parse(readFileSync(mapFile, "utf-8"));
  assert.deepEqual(map, {});
});

test("generated server: skill_<name> tool calls are translated to /bee/skill_run via SKILL_TOOL_MAP, not called by their raw name", () => {
  assert.match(FLASH_MCP_SERVER_JS, /SKILL_TOOL_MAP/);
  assert.match(FLASH_MCP_SERVER_JS, /callSkillTool/);
  assert.match(FLASH_MCP_SERVER_JS, /\/bee\/skill_run/);
});

test("flash MCP server smoke test: a curated skill_<name> tool call is gated exactly like a native tool, and dispatches through /bee/skill_run", async () => {
  const ctx: LaneToolContext = { projectPath: "/tmp", project: "hivematrix", requestedBy: "flash:smoke2" };
  const curatedSkillTools: CuratedSkillToolDef[] = [
    { toolName: "skill_count_files", skillName: "Count Files", description: "count files in a dir", inputSchema: { type: "object", properties: { dir: { type: "string" } }, required: ["dir"] } },
  ];
  const { configPath } = prepareFlashMcp("3747", process.execPath, {
    allowedTools: (name) => name === "skill_count_files", // ONLY the curated tool, not the raw skill_run
    brainRoot: null,
    ctx,
    sessionId: "smoke-session-2",
    curatedSkillTools,
  });
  const serverPath = ensureFlashMcpServer();
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const env: Record<string, string> = config.mcpServers[FLASH_MCP_SERVER_NAME].env;

  const responses = await runServerConversation(serverPath, env, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "skill_count_files", arguments: { dir: "/tmp" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "skill_run", arguments: { name: "Count Files" } } },
  ]);

  // tools/list carries the synthesized curated tool.
  const list = responses.find((r) => r.id === 2)!;
  const toolNames = (list.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  assert.ok(toolNames.includes("skill_count_files"));

  // The curated tool is allowed (gate lets it through to dispatch attempt —
  // the daemon isn't running in this test, so it fails at the network layer,
  // not at the permission gate).
  const curatedCall = responses.find((r) => r.id === 3)!;
  const curatedResult = curatedCall.result as { content: Array<{ text: string }>; isError?: boolean };
  assert.equal(curatedResult.isError, undefined);
  assert.doesNotMatch(curatedResult.content[0].text, /is not permitted in this pass/);

  // skill_run itself was NOT in the allow-list this pass — proving the
  // curated tool is a genuinely separate, independently-gated name, not an
  // alias that silently also unlocks the raw fallback.
  const rawCall = responses.find((r) => r.id === 4)!;
  const rawResult = rawCall.result as { content: Array<{ text: string }>; isError?: boolean };
  assert.equal(rawResult.isError, true);
  assert.match(rawResult.content[0].text, /is not permitted in this pass/);
});

// ------------------------------------------------------------------
// loadCuratedSkillTools — end to end against a real (temp) skill library.
// HOME is swapped only for the duration of this one test and restored in a
// finally, since every other test in this file relies on the real homedir()
// (prepareFlashMcp/ensureFlashMcpServer write under ~/.hivematrix/mcp).
// ------------------------------------------------------------------

test("loadCuratedSkillTools: tags a skill as curated via frontmatter tool:true, promotes by usage, and leaves the long tail for skill_run", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync: writeFileSyncNode, rmSync } = await import("node:fs");
  const { join: joinPath } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const TMP = mkdtempSync(joinPath(tmpdir(), "hm-flash-mcp-curated-"));
  const HOME = joinPath(TMP, "home");
  const BRAIN = joinPath(TMP, "brain");
  mkdirSync(joinPath(HOME, ".hivematrix"), { recursive: true });
  writeFileSyncNode(joinPath(HOME, ".hivematrix", "config.json"), JSON.stringify({ memory: { brainRootDir: BRAIN } }));
  const origHome = process.env.HOME;
  process.env.HOME = HOME;

  try {
    const { upsertSkill } = await import("@/lib/skills/store");
    await upsertSkill({ name: "Opted In Skill", description: "explicitly curated", body: "do {{thing}}", source: "test", tool: true });
    await upsertSkill({ name: "Long Tail Skill", description: "never used, not tagged", body: "do the rare thing", source: "test" });

    const { loadCuratedSkillTools } = await import("./flash-mcp");
    const defs = await loadCuratedSkillTools();

    const curatedNames = defs.map((d) => d.skillName);
    assert.ok(curatedNames.includes("Opted In Skill"), "tool:true skill must be curated");
    assert.ok(!curatedNames.includes("Long Tail Skill") || curatedNames.length >= 2, "long-tail skill may ride along under the small-library top-N, but is never REQUIRED to be curated");

    const opted = defs.find((d) => d.skillName === "Opted In Skill")!;
    assert.equal(opted.toolName, "skill_opted_in_skill");
    const schema = opted.inputSchema as { required: string[] };
    assert.ok(schema.required.includes("thing"));
  } finally {
    process.env.HOME = origHome;
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("escalate_to_task's description parameter forbids inventing scope", () => {
  // Regression (2026-07-16): Flash escalated a Browser Lane request into a task
  // whose spec invented test targets ("banking portal", "Gmail"), re-proposed
  // Keychain storage that had ALREADY shipped that day, and specified silent
  // credential auto-refresh — contradicting the standing human-click-only rule.
  // The worker then asked the operator about a bank integration that does not
  // exist. The tool's guidance was simply "Full description of what needs to be
  // done", which did nothing to prevent any of that.
  const def = FLASH_ONLY_TOOL_DEFS.find((d) => d.function.name === "escalate_to_task");
  assert.ok(def, "escalate_to_task must be defined");
  const desc = String(
    (def!.function.parameters as { properties?: Record<string, { description?: string }> })
      .properties?.description?.description ?? "",
  );
  assert.match(desc, /OPERATOR'S OWN TERMS/i, "must anchor the spec to what was actually asked");
  assert.match(desc, /Do NOT invent scope/i);
  assert.match(desc, /test targets/i, "made-up test targets are the specific failure seen");
  assert.match(desc, /already ship/i, "must not re-propose shipped capabilities");
  assert.match(desc, /standing operator rule/i, "must not contradict a standing rule");
});
