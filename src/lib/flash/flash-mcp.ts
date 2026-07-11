/**
 * Flash MCP server — exposes the Flash lane tools (brain_search, mail_send,
 * hivematrix_browser, PIM, …) plus the four Flash-only tools (persona_update,
 * generate_avatar, deep_think, escalate_to_task) to the `claude` CLI as a
 * stdio MCP server, modeled on `src/lib/orchestrator/outbound-mcp.ts`.
 *
 * Two different tool shapes get bridged here:
 *   - Lane tools already have a generic HTTP dispatch point
 *     (`POST /bee/:tool` → executeLaneTool, server.ts). The embedded server
 *     just proxies to it.
 *   - The four Flash-only tools have real business logic (file writes to the
 *     persona dir, Task creation, deep-think) that must run in the DAEMON
 *     process, not the child MCP stdio process — so this file also owns
 *     their implementations, dispatched by a small auth-gated daemon route
 *     (`POST /flash/tool/:name`, wired in server.ts) that the embedded
 *     server proxies to, same shape as the /bee/:tool proxy.
 *
 * Gating (critical, per the cutover plan): prompt-level tool guidance is not
 * a guarantee. The embedded server enforces an allow-list at CALL time
 * (env HIVE_FLASH_ALLOWED), independent of what `--allowedTools` told the CLI
 * to offer — a model that emits a call for a tool it was never offered still
 * gets refused here, mirroring the old in-process gate at loop.ts's dispatch
 * site (READ_ONLY_FLASH_TOOLS et al.).
 *
 * `tools/list` always returns the FULL reachable catalog (capability-gated by
 * ConnectivityPolicy, not by the allow-list) — that way a read-only pass can
 * still be tested end to end: list shows the write tool exists, and a
 * `tools/call` for it is refused. The allow-list is a separate, narrower gate
 * layered on top.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import { availableLaneTools, type LaneToolContext } from "@/lib/orchestrator/lane-tools";
import type { ChatTool } from "@/lib/orchestrator/tool-bridge";
import { broadcastEvent } from "@/lib/ws/broadcaster";

/** MCP server name → Claude namespaces its tools as `mcp__flash__<tool>`. */
export const FLASH_MCP_SERVER_NAME = "flash";

// ------------------------------------------------------------------
// Flash-only tool definitions + handlers (moved from loop.ts — these need
// real imports/logic, unlike the lane tools which just proxy to /bee/:tool).
// ------------------------------------------------------------------

export const FLASH_ONLY_TOOL_NAMES = ["persona_update", "generate_avatar", "deep_think", "escalate_to_task"] as const;
export type FlashOnlyToolName = (typeof FLASH_ONLY_TOOL_NAMES)[number];

export function isFlashOnlyTool(name: string): name is FlashOnlyToolName {
  return (FLASH_ONLY_TOOL_NAMES as readonly string[]).includes(name);
}

export const FLASH_ONLY_TOOL_DEFS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "persona_update",
      description:
        "Write a persona file (SOUL.md, IDENTITY.md, USER.md, or GOALS.md) in the brain persona directory. " +
        "Use when the operator asks to update identity/persona, or to record a goal they state in GOALS.md. " +
        "Every call emits a visible notice and an audit event.",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", enum: ["SOUL.md", "IDENTITY.md", "USER.md", "GOALS.md"] },
          content: { type: "string", description: "Full new content for the file" },
          reason: { type: "string", description: "Brief reason shown to the operator" },
        },
        required: ["file", "content", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_avatar",
      description:
        "Generate an avatar image and save it as the persona avatar (persona/avatar.png). " +
        "Use during the birth ritual when the agent is choosing its visual identity. " +
        "Accepts an image generation prompt describing the desired image.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Concrete visual description for the image generator (shape, colors, style)" },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deep_think",
      description:
        "Deep reasoning for HARD questions: runs several independent Opus attempts, cross-checks them for " +
        "agreement, and reconciles disagreements with a skeptical revision pass. Slow (up to a few minutes) but " +
        "far more reliable than a single answer. Use for strategy decisions, tricky analysis, math/logic, or " +
        "anything where a wrong answer is costly. NOT for simple lookups, casual chat, or things a tool can " +
        "answer directly.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question, fully self-contained — include all context needed to answer it, since this runs fresh without the conversation history.",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_task",
      description:
        "Escalate a complex multi-step request to a background task (the coding harness plans and executes it). " +
        "Use when the task cannot be completed in a single conversation turn.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the task" },
          description: { type: "string", description: "Full description of what needs to be done" },
          projectPath: { type: "string", description: "Absolute path to the project (optional)" },
        },
        required: ["title", "description"],
      },
    },
  },
];

async function handlePersonaUpdate(args: Record<string, unknown>, brainRoot: string | null): Promise<string> {
  const file = String(args.file ?? "");
  const content = String(args.content ?? "");
  const reason = String(args.reason ?? "");

  if (!["SOUL.md", "IDENTITY.md", "USER.md", "GOALS.md"].includes(file)) {
    return `Error: invalid persona file "${file}" — must be SOUL.md, IDENTITY.md, USER.md, or GOALS.md`;
  }
  if (!brainRoot) return "Error: brain root not configured";

  const dir = join(brainRoot, "persona");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);

  if (existsSync(path)) {
    // Keep a timestamped backup in the same directory
    const backup = join(dir, `${file}.${Date.now()}.bak`);
    writeFileSync(backup, readFileSync(path));
  }

  writeFileSync(path, content, "utf-8");
  broadcastEvent("flash:persona_updated", { file, reason, ts: new Date().toISOString() });

  return `persona_update: ${file} written (${content.length} chars). Reason: ${reason}`;
}

async function handleGenerateAvatar(args: Record<string, unknown>, brainRoot: string | null): Promise<string> {
  const prompt = String(args.prompt ?? "").trim();
  if (!prompt) return "Error: prompt is required";
  if (!brainRoot) return "Error: brain root not configured";

  const dir = join(brainRoot, "persona");
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, "avatar.png");

  const mode = getConnectivityPolicy().mode;
  const { generateViaNanai, generateViaMflux } = await import("@/lib/orchestrator/image-gen");

  let result: { ok: boolean; detail: string };
  if (mode === "cloud-ok") {
    result = await generateViaNanai(prompt, outPath);
    if (!result.ok) result = await generateViaMflux(prompt, outPath);
  } else {
    result = await generateViaMflux(prompt, outPath);
  }

  if (result.ok) {
    broadcastEvent("flash:persona_updated", { file: "avatar.png", reason: "avatar generated", ts: new Date().toISOString() });
    return `Avatar generated at ${outPath}`;
  }
  return `Avatar generation attempted but failed: ${result.detail}. You can describe yourself in text instead — the operator can add an image manually later.`;
}

async function handleDeepThink(args: Record<string, unknown>): Promise<string> {
  const question = String(args.question ?? "").trim();
  if (!question) return "Error: question is required";
  const { deepThink } = await import("@/lib/models/deep-think");
  // deepThink defaults its `complete` backend to opusChatComplete (Phase 2) —
  // deep_think is genuinely a thinking-role call, routed to Opus.
  const r = await deepThink(question, { samples: 3, callTimeoutMs: 60_000, maxWallMs: 150_000 });
  return (
    `${r.answer}\n\n` +
    `[deep-think: ${r.candidates} attempts, ${Math.round(r.agreement * 100)}% agreement, ` +
    `confidence ${r.confidence}${r.reflected ? ", revised after disagreement" : ""}, ${Math.round(r.elapsedMs / 1000)}s]`
  );
}

async function handleEscalateToTask(args: Record<string, unknown>, sessionId: string): Promise<string> {
  const { Task, generateId } = await import("@/lib/db");
  const { getSession } = await import("./store");
  const { markVoiceOrigin } = await import("@/lib/voice/loop-closer");

  const title = String(args.title ?? "Task");
  const description = String(args.description ?? "");
  const projectPath = String(args.projectPath ?? homedir());

  // A task escalated from a voice-channel flash session gets the same
  // voice-origin marker the /voice/session route uses, so the loop-closer
  // (src/lib/voice/loop-closer.ts) texts the outcome back once this task
  // reaches a terminal state.
  const isVoice = sessionId ? getSession(sessionId)?.channel === "voice" : false;

  // Broad multi-step work dispatches as a SINGLE task that self-plans via
  // Superpowers: workflow:"work" triggers the "/workflows:work" skill prefix so
  // the frontier coding harness plans and executes its own subtasks.
  const task = await Task.create({
    _id: generateId(),
    title,
    description,
    project: "hivematrix",
    projectPath,
    executor: "agent",
    model: "mixed",
    workflow: "work",
    source: `flash:${sessionId}`,
    ...(isVoice ? { output: markVoiceOrigin() } : {}),
  });

  // Deliberately NOT calling an emitter here — this handler runs in a bridged
  // daemon HTTP request, not the Flash turn's own request scope. The loop
  // (loop.ts's consumeFlashStreamLine) parses this exact "Escalated to task
  // <id>:" string out of the tool_result event and calls emit.escalated(id),
  // preserving the client-facing escalation signal across the MCP boundary.
  return `Escalated to task ${task._id}: "${title}"`;
}

/** Dispatch a Flash-only tool call — called by the `/flash/tool/:name` daemon route. */
export async function dispatchFlashOnlyTool(
  name: string,
  args: Record<string, unknown>,
  opts: { brainRoot: string | null; sessionId: string },
): Promise<string> {
  switch (name) {
    case "persona_update":
      return handlePersonaUpdate(args, opts.brainRoot);
    case "generate_avatar":
      return handleGenerateAvatar(args, opts.brainRoot);
    case "deep_think":
      return handleDeepThink(args);
    case "escalate_to_task":
      return handleEscalateToTask(args, opts.sessionId);
    default:
      return `Error: Unknown flash-only tool "${name}"`;
  }
}

// ------------------------------------------------------------------
// MCP tool catalog (JSON Schema reuse — the OpenAI function shape's
// `parameters` object is already valid MCP `inputSchema`).
// ------------------------------------------------------------------

export interface FlashMcpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function buildFlashMcpToolCatalog(tools: ChatTool[]): FlashMcpToolDef[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters,
  }));
}

// Bump when FLASH_MCP_SERVER_JS changes so the on-disk copy is rewritten.
const SERVER_VERSION = "1";

// The stdio MCP server (CommonJS, run by the bundled node). Deliberately avoids
// template literals / ${} so it nests cleanly in this TS array-join string
// (same convention as outbound-mcp.ts). Speaks newline-delimited JSON-RPC 2.0
// and proxies tool calls to the daemon's /bee/:tool (lane tools) or
// /flash/tool/:name (Flash-only tools) endpoints with the daemon auth token.
export const FLASH_MCP_SERVER_JS = [
  "// HiveMatrix flash MCP server (stdio) — generated by flash-mcp.ts. Do not edit.",
  '"use strict";',
  'var fs = require("fs"), os = require("os"), path = require("path"), http = require("http");',
  'var PORT = process.env.HIVE_DAEMON_PORT || "3747";',
  'var TOOLS_FILE = process.env.HIVE_FLASH_TOOLS_FILE || "";',
  'var ALLOWED = (process.env.HIVE_FLASH_ALLOWED || "").split(",").filter(Boolean);',
  'var BRAIN_ROOT = process.env.HIVE_FLASH_BRAIN_ROOT || "";',
  'var PROJECT_PATH = process.env.HIVE_FLASH_PROJECT_PATH || "";',
  'var PROJECT = process.env.HIVE_FLASH_PROJECT || "hivematrix";',
  'var SESSION_ID = process.env.HIVE_FLASH_SESSION_ID || "";',
  'var FLASH_ONLY = { persona_update: 1, generate_avatar: 1, deep_think: 1, escalate_to_task: 1 };',
  "function token() {",
  '  try { return fs.readFileSync(path.join(os.homedir(), ".hivematrix", "auth-token"), "utf8").trim(); }',
  '  catch (e) { return ""; }',
  "}",
  "function loadTools() {",
  '  try { return JSON.parse(fs.readFileSync(TOOLS_FILE, "utf8")); }',
  "  catch (e) { return []; }",
  "}",
  // HARD dispatch-time gate: a name not present in ALLOWED is refused, no
  // matter what tools/list advertised or what --allowedTools offered the
  // model. An intentionally empty ALLOWED denies everything (fail closed).
  "function isAllowed(name) { return ALLOWED.indexOf(name) !== -1; }",
  "function postJson(route, bodyObj) {",
  "  return new Promise(function (resolve) {",
  "    var body = JSON.stringify(bodyObj);",
  "    var req = http.request(",
  '      { host: "127.0.0.1", port: PORT, path: route, method: "POST",',
  '        headers: { "Content-Type": "application/json",',
  '                   "Content-Length": Buffer.byteLength(body),',
  '                   "Authorization": "Bearer " + token() } },',
  '      function (res) { var d = ""; res.on("data", function (c) { d += c; }); res.on("end", function () { resolve(d || "{}"); }); }',
  "    );",
  '    req.on("error", function (e) { resolve(JSON.stringify({ ok: false, result: "daemon unreachable: " + (e && e.message) })); });',
  "    req.write(body); req.end();",
  "  });",
  "}",
  "function extractResult(raw) {",
  "  try {",
  "    var parsed = JSON.parse(raw);",
  '    if (typeof parsed.result === "string") return parsed.result;',
  "    return raw;",
  "  } catch (e) { return raw; }",
  "}",
  "function callTool(name, a) {",
  "  if (!isAllowed(name)) {",
  '    return Promise.resolve("Error: tool " + name + " is not permitted in this pass");',
  "  }",
  "  if (FLASH_ONLY[name]) {",
  '    return postJson("/flash/tool/" + name, { args: a, brainRoot: BRAIN_ROOT, sessionId: SESSION_ID }).then(extractResult);',
  "  }",
  '  return postJson("/bee/" + name, { args: a, projectPath: PROJECT_PATH, project: PROJECT }).then(extractResult);',
  "}",
  "function send(msg) { process.stdout.write(JSON.stringify(msg) + String.fromCharCode(10)); }",
  "function handle(line) {",
  "  var msg; try { msg = JSON.parse(line); } catch (e) { return; }",
  "  var id = msg.id, method = msg.method;",
  '  if (method === "initialize") {',
  '    send({ jsonrpc: "2.0", id: id, result: { protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "flash", version: "1.0.0" } } });',
  "    return;",
  "  }",
  '  if (method === "notifications/initialized" || method === "initialized") return;',
  '  if (method === "ping") { send({ jsonrpc: "2.0", id: id, result: {} }); return; }',
  '  if (method === "tools/list") { send({ jsonrpc: "2.0", id: id, result: { tools: loadTools() } }); return; }',
  '  if (method === "tools/call") {',
  "    var p = msg.params || {};",
  "    if (!isAllowed(p.name)) {",
  '      send({ jsonrpc: "2.0", id: id, result: { content: [{ type: "text", text: "Error: tool " + p.name + " is not permitted in this pass" }], isError: true } });',
  "      return;",
  "    }",
  "    Promise.resolve(callTool(p.name, p.arguments || {})).then(function (out) {",
  '      send({ jsonrpc: "2.0", id: id, result: { content: [{ type: "text", text: String(out) }] } });',
  '    }).catch(function (e) { send({ jsonrpc: "2.0", id: id, result: { content: [{ type: "text", text: "Error: " + String(e && e.message || e) }], isError: true } }); });',
  "    return;",
  "  }",
  '  if (id !== undefined && id !== null) send({ jsonrpc: "2.0", id: id, error: { code: -32601, message: "method not found: " + method } });',
  "}",
  'var buf = "";',
  'process.stdin.setEncoding("utf8");',
  'process.stdin.on("data", function (chunk) {',
  "  buf += chunk; var idx;",
  '  while ((idx = buf.indexOf(String.fromCharCode(10))) >= 0) {',
  "    var line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);",
  "    if (line) handle(line);",
  "  }",
  "});",
  'process.stdin.on("end", function () { process.exit(0); });',
].join("\n");

/** Directory holding the generated server + config + tools catalog. */
function mcpDir(): string {
  return join(homedir(), ".hivematrix", "mcp");
}

/** Write the server to disk if missing/stale; return its absolute path. Idempotent. */
export function ensureFlashMcpServer(): string {
  const dir = mcpDir();
  mkdirSync(dir, { recursive: true });
  const serverPath = join(dir, "flash-server.cjs");
  const stampPath = join(dir, ".flash-version");
  let current = "";
  try { current = readFileSync(stampPath, "utf8").trim(); } catch { /* first run */ }
  if (current !== SERVER_VERSION) {
    writeFileSync(serverPath, FLASH_MCP_SERVER_JS + "\n", { mode: 0o600 });
    writeFileSync(stampPath, SERVER_VERSION, { mode: 0o600 });
  }
  return serverPath;
}

export interface FlashMcpOptions {
  /** When set, only tools passing the filter are OFFERED and PERMITTED for this pass. */
  allowedTools?: (name: string) => boolean;
  brainRoot: string | null;
  ctx: LaneToolContext;
  sessionId: string;
}

/**
 * Materialize the server + the tools catalog + the mcp-config file, returning
 * the config path (for `--mcp-config`) and the ALLOWED tool names, namespaced
 * for `--allowedTools`. `nodePath` defaults to the running node so it's valid
 * in dev and in the packaged bundle.
 */
export function prepareFlashMcp(
  port: string,
  nodePath: string,
  opts: FlashMcpOptions,
): { configPath: string; toolNames: string[] } {
  const policy = getConnectivityPolicy();
  const allTools: ChatTool[] = [...availableLaneTools(policy), ...FLASH_ONLY_TOOL_DEFS];
  const allowedNames = opts.allowedTools
    ? allTools.filter((t) => opts.allowedTools!(t.function.name)).map((t) => t.function.name)
    : allTools.map((t) => t.function.name);

  const dir = mcpDir();
  mkdirSync(dir, { recursive: true });

  // tools/list always reflects the FULL capability-gated catalog (not the
  // allow-list) — see file header for why: it makes the allow-list gate
  // independently verifiable (list shows a tool, call still refuses it).
  const toolsFilePath = join(dir, "flash-tools.json");
  writeFileSync(toolsFilePath, JSON.stringify(buildFlashMcpToolCatalog(allTools), null, 2), { mode: 0o600 });

  const serverPath = ensureFlashMcpServer();
  const configPath = join(dir, "flash-mcp-config.json");
  const config = {
    mcpServers: {
      [FLASH_MCP_SERVER_NAME]: {
        command: nodePath,
        args: [serverPath],
        env: {
          HIVE_DAEMON_PORT: port,
          HIVE_FLASH_TOOLS_FILE: toolsFilePath,
          HIVE_FLASH_ALLOWED: allowedNames.join(","),
          HIVE_FLASH_BRAIN_ROOT: opts.brainRoot ?? "",
          HIVE_FLASH_PROJECT_PATH: opts.ctx.projectPath,
          HIVE_FLASH_PROJECT: opts.ctx.project,
          HIVE_FLASH_SESSION_ID: opts.sessionId,
        },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

  return { configPath, toolNames: allowedNames.map((n) => `mcp__${FLASH_MCP_SERVER_NAME}__${n}`) };
}
