/**
 * Flash Lane — agent loop with streaming SSE output.
 *
 * Runs one Flash turn as a single `claude --model haiku` CLI invocation:
 * the Flash lane tools (+ the four Flash-only tools) are exposed to the CLI
 * as a stdio MCP server (flash-mcp.ts), and the CLI's own native tool-calling
 * drives them end to end — this loop is a pure observer/renderer of the
 * resulting `--output-format stream-json` stream, not a tool-call executor.
 * (A one-shot `claude -p` cannot emit externally-executable OpenAI-style
 * tool_calls the way the old local-model loop did; MCP is the CLI's
 * supported extension point, so tool execution moved into the MCP server's
 * process boundary.)
 *
 * Budget: MAX_TOOL_CALLS tool calls (passed as --max-turns) / MAX_WALL_MS
 * wall clock (enforced here by killing the child process).
 *
 * History: two modes, chosen per-turn by whether a CLI session id is on file
 * for this flash session (flash/store.ts's cliSessionId column):
 *   - No stored id (first turn, or after a stale-session fallback): full
 *     history is re-serialized every turn (system messages via
 *     --append-system-prompt, prior turns folded into the -p prompt as a
 *     transcript).
 *   - Stored id present: `--resume <id>` is passed and only the latest user
 *     message goes over stdin — the CLI keeps the conversation server-side,
 *     so re-sending the transcript would just be wasted input tokens.
 * Either way the turn's `session` stream event (the CLI's own session id,
 * which may rotate) is captured and persisted for next time. If a --resume
 * attempt fails in a way that looks like a stale/expired session (nonzero
 * exit + stderr mentioning session/resume), the turn is retried once without
 * --resume using full-history serialization, and the stale id is dropped —
 * a bad id must never break a turn.
 */

import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { resolveClaudeBinary } from "@/lib/orchestrator/subprocess";
import { StreamParser } from "@/lib/orchestrator/stream-parser";
import { backendConfigured } from "@/lib/models/backends";
import type { LaneToolContext } from "@/lib/orchestrator/lane-tools";
import { getConnectivityPolicy } from "@/lib/connectivity/policy";
import { recordRun } from "@/lib/observability/store";
import { prepareFlashMcp } from "./flash-mcp";
import { clearFlashCliSessionId, getFlashCliSessionId, setFlashCliSessionId } from "./store";
import type { FlashEmitter, FlashMessage } from "./types";

const MAX_TOOL_CALLS = 12;
const MAX_WALL_MS = 3 * 60 * 1000;

/**
 * Read-only tool names — the set an observe-only pass (manual-autonomy
 * heartbeat, daily briefs) is allowed to call. HARD enforcement: gating the
 * tool list is the guarantee; prompt guidance alone is not (the prompt embeds
 * operator-editable and inbound-derived text). Enforced both at CLI offer
 * time (--allowedTools, via FlashLoopOptions.allowedTools below) AND at MCP
 * dispatch time (flash-mcp.ts's HIVE_FLASH_ALLOWED gate).
 */
export const READ_ONLY_FLASH_TOOLS: ReadonlySet<string> = new Set([
  "brain_search",
  "workflow_inbox",
  "code_graph",
  // PIM reads — lets the heartbeat / daily brief observe the operator's real
  // day (calendar, open reminders, contacts) without any write capability.
  "contacts_lookup",
  "calendar_today",
  "reminders_list",
]);

export interface FlashLoopOptions {
  /** When set, only tools passing the filter are OFFERED to the model. */
  allowedTools?: (name: string) => boolean;
  /** Test-only: override the `claude` binary path (e.g. a fake stream-json emitter script). */
  __claudeBinary?: string;
  /** Test-only: override child_process.spawn. */
  __spawn?: typeof spawn;
}

// ------------------------------------------------------------------
// Pure helpers — prompt/args construction, stream-line consumption. Kept
// decoupled from the actual spawn so they're unit-testable without a real
// `claude` subprocess.
// ------------------------------------------------------------------

export interface FlashPromptParts {
  systemPrompts: string[];
  prompt: string;
}

/**
 * Serialize FlashMessage[] history (system + prior turns + the new user
 * message, as built fresh per-turn by flash/context.ts:buildInitialMessages)
 * into the CLI's shape: system messages become --append-system-prompt args,
 * prior user/assistant turns become a transcript block prepended to the
 * final user message (which becomes the actual -p prompt) — UNLESS `resume`
 * is set, in which case the CLI already has the prior turns server-side
 * (via --resume) and only the latest user message is sent.
 */
export function buildFlashPrompt(messages: FlashMessage[], resume = false): FlashPromptParts {
  const systemPrompts: string[] = [];
  const convo: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content.trim()) systemPrompts.push(m.content);
    } else if (m.role === "user") {
      convo.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      convo.push({ role: "assistant", content: m.content ?? "" });
    }
    // role "tool" — buildInitialMessages never emits these (there is no live
    // tool-call loop to replay); nothing to serialize.
  }
  if (convo.length === 0) return { systemPrompts, prompt: "" };

  const last = convo[convo.length - 1];
  if (resume) return { systemPrompts, prompt: last.content };

  const prior = convo.slice(0, -1);
  const transcript = prior.length
    ? "--- Prior conversation (for context; do not repeat unless asked) ---\n" +
      prior.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n") +
      "\n--- End prior conversation ---\n\n"
    : "";
  return { systemPrompts, prompt: `${transcript}${last.content}` };
}

export interface FlashSpawnArgsInput {
  systemPrompts: string[];
  mcpConfigPath: string;
  toolNames: string[];
  maxTurns: number;
  /** CLI session id to resume, if this flash session has one on file. */
  resumeSessionId?: string | null;
}

/**
 * Build the `claude` CLI argv for one Flash turn. Pure. The prompt is NOT an argv
 * element — it is written to the child's stdin — because a prompt that starts with
 * `--` (our transcript block leads with "--- Prior conversation ---") gets parsed by
 * the CLI as an unknown option and the process exits 1. stdin sidesteps arg parsing
 * entirely and has no start-of-string ambiguity, unlike `-p <value>` or a `--`
 * end-of-options marker (the latter also triggers a 3s stdin-wait). `-p` stays as the
 * print-mode flag; with no positional prompt the CLI reads the query from stdin.
 */
export function buildFlashSpawnArgs(input: FlashSpawnArgsInput): string[] {
  const args = ["-p"];
  if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);
  args.push(
    "--model",
    "haiku",
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(input.maxTurns),
    // Disable ALL of the CLI's built-in tools (WebFetch/WebSearch/Bash/Read/Write/…).
    // Flash chat must act only through its gated HiveMatrix lane tools — e.g. web reads
    // go through Browser Lane (mcp__flash__hivematrix_browser), not the CLI's WebFetch
    // (which needs an interactive permission grant flash can't provide → dead-ends, and
    // bypasses our lane policy/telemetry). Removing the built-in set also keeps the MCP
    // tool count low enough that the tools aren't CLI-deferred behind a ToolSearch.
    "--tools",
    "",
    // Only the flash MCP server, never the operator's other configured MCP servers.
    "--strict-mcp-config",
    "--mcp-config",
    input.mcpConfigPath,
    "--allowedTools",
    input.toolNames.join(","),
    ...input.systemPrompts.flatMap((sp) => ["--append-system-prompt", sp]),
  );
  return args;
}

export interface FlashStreamState {
  /** FIFO queue of tool names from `tool_use` events, consumed in order by
   *  the `tool_result` events that follow — the stream-json parser doesn't
   *  carry the tool name on the result event itself, but Claude Code emits
   *  tool_use/tool_result pairs in matching order. */
  pendingToolNames: string[];
}

export function createFlashStreamState(): FlashStreamState {
  return { pendingToolNames: [] };
}

const ESCALATED_TASK_RE = /^Escalated to task (\S+):/;

/** Token/cost usage captured from the stream-json `result` event — the shape
 *  `recordFlashTelemetry` below needs to write one task_telemetry row per turn. */
export interface FlashUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheCreate5mTokens?: number;
  cacheCreate1hTokens?: number;
  reasoningTokens?: number;
  costUsd: number;
  turns: number;
}

/**
 * Consume one stream-json line, driving FlashEmitter calls, and reporting any
 * text/result text it produced. Side-effecting on `emit` only — otherwise
 * pure/deterministic, so it can be unit tested against canned stream-json
 * lines without a real `claude` subprocess.
 */
export function consumeFlashStreamLine(
  line: string,
  parser: StreamParser,
  state: FlashStreamState,
  emit: FlashEmitter,
): { textDelta?: string; resultText?: string; cliSessionId?: string; model?: string; usage?: FlashUsage } {
  if (!line.trim()) return {};
  const events = parser.parseLine(line);
  let textDelta: string | undefined;
  let resultText: string | undefined;
  let cliSessionId: string | undefined;
  let model: string | undefined;
  let usage: FlashUsage | undefined;

  for (const event of events) {
    if (event.type === "session") {
      // The CLI's own session id (from system:init) — captured every turn so
      // the caller can persist it for --resume continuity next time.
      cliSessionId = event.sessionId;
    } else if (event.type === "init") {
      // The resolved model id (e.g. "claude-haiku-4-5"), also from system:init
      // — not surfaced to the user, but captured for telemetry (see
      // recordFlashTelemetry below), same as orchestrator/subprocess.ts's
      // agent.modelsUsed tracking for coding-task runs.
      model = event.model;
    } else if (event.type === "text") {
      textDelta = (textDelta ?? "") + event.content;
      emit.token(event.content);
    } else if (event.type === "tool_use") {
      state.pendingToolNames.push(event.tool);
      emit.toolStart(event.tool, event.input);
    } else if (event.type === "tool_result") {
      const name = state.pendingToolNames.shift() ?? "tool";
      const ok = !event.content.startsWith("[error]") && !event.content.startsWith("Error:");
      emit.toolResult(name, ok, event.content.slice(0, 400));
      // Preserve the escalation signal across the MCP process boundary: the
      // handler (flash-mcp.ts:handleEscalateToTask) can't call emit directly
      // (it runs in a bridged HTTP request, not this turn's own scope), so it
      // returns a recognizable string and we parse the taskId back out here.
      if (ok && name === "escalate_to_task") {
        const m = event.content.match(ESCALATED_TASK_RE);
        if (m) emit.escalated(m[1]);
      }
    } else if (event.type === "result") {
      resultText = event.result;
      // Token/cost usage for this turn — captured for telemetry, mirroring
      // agent-manager's agent.lastResult tracking for orchestrator runs.
      usage = {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheCreationTokens: event.cacheCreationTokens,
        cacheCreate5mTokens: event.cacheCreate5mTokens,
        cacheCreate1hTokens: event.cacheCreate1hTokens,
        reasoningTokens: event.reasoningTokens,
        costUsd: event.cost,
        turns: event.turns,
      };
    } else if (event.type === "error") {
      const msg = `\n\n[Flash model error: ${event.content}]`;
      textDelta = (textDelta ?? "") + msg;
      emit.token(msg);
    }
    // "log"/"question"/"unknown" — not surfaced to Flash.
  }
  return { textDelta, resultText, cliSessionId, model, usage };
}

// ------------------------------------------------------------------
// Main agent loop
// ------------------------------------------------------------------

interface FlashAttemptResult {
  /** Full text to persist as the assistant turn — streamed content, plus a
   *  terminal error appended if one occurred (or just the error if no content). */
  text: string;
  /** The terminal failure message alone (`\n\n[Flash model error: …]`), or null
   *  on success. When `suppressTerminalError` was set this was NOT emitted, so a
   *  caller that decides to keep the attempt must emit it itself; content tokens
   *  (if any) already streamed live. */
  terminalError: string | null;
  /** The CLI's own session id captured from this attempt's `session` stream event, if any. */
  cliSessionId: string | null;
  /** Process exit code, or null if the attempt never got a real exit (launch failure / wall-timeout kill). */
  exitCode: number | null;
  stderr: string;
  /** Resolved model id from this attempt's `system:init` event, if the process got that far. */
  model: string | null;
  /** Token/cost usage from this attempt's `result` event, if the process got that far. */
  usage: FlashUsage | null;
}

/**
 * One spawn-through-close cycle of the `claude` CLI. Pure aside from `emit`
 * calls. Content tokens, tool events, and mid-stream stream-json `error`
 * events always stream LIVE through `emit` as they arrive.
 *
 * `suppressTerminalError` (used by the --resume path): when true, the two
 * TERMINAL failure messages — a non-zero exit ("claude exited with code N")
 * and a launch/`proc.on("error")` failure — are NOT emitted; they're only
 * returned in `FlashAttemptResult.text` so the caller can decide whether this
 * was a stale-session failure worth a silent fallback. A stale `--resume`
 * fails at session lookup BEFORE any content streams, so nothing user-visible
 * is withheld. (The wall-timeout budget message still emits — that's not a
 * resume-staleness case and the user should see it.)
 */
function runFlashAttempt(
  binary: string,
  args: string[],
  prompt: string,
  spawnImpl: typeof spawn,
  emit: FlashEmitter,
  suppressTerminalError = false,
): Promise<FlashAttemptResult> {
  return new Promise<FlashAttemptResult>((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawnImpl(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      const msg = `\n\n[Flash model error: failed to launch claude — ${err instanceof Error ? err.message : String(err)}]`;
      if (!suppressTerminalError) emit.token(msg);
      resolve({ text: msg, terminalError: msg, cliSessionId: null, exitCode: null, stderr: "", model: null, usage: null });
      return;
    }

    // Feed the prompt via stdin (never as an argv value — see buildFlashSpawnArgs).
    try {
      proc.stdin?.on("error", () => { /* child may exit before we finish writing */ });
      proc.stdin?.write(prompt);
      proc.stdin?.end();
    } catch { /* child already gone; stdout/exit handlers below settle the turn */ }

    const parser = new StreamParser();
    const streamState = createFlashStreamState();
    let lineBuffer = "";
    let stderrBuf = "";
    let fullText = "";
    let resultText = "";
    let cliSessionId: string | null = null;
    let model: string | null = null;
    let usage: FlashUsage | null = null;
    let settled = false;

    const finish = (text: string, exitCode: number | null, terminalError: string | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallTimer);
      resolve({ text, terminalError, cliSessionId, exitCode, stderr: stderrBuf, model, usage });
    };

    const wallTimer = setTimeout(() => {
      try { proc.kill("SIGTERM"); } catch { /* already dead */ }
      const elapsedS = Math.round(MAX_WALL_MS / 1000);
      const budgetMsg = `\n\n[Budget reached: ${elapsedS}s wall clock. Use "escalate this to a task" for longer tasks.]`;
      // Not a resume-staleness case — always show it, even under suppression.
      emit.token(budgetMsg);
      finish((fullText || resultText) + budgetMsg, null);
    }, MAX_WALL_MS);

    const consumeLine = (line: string) => {
      const r = consumeFlashStreamLine(line, parser, streamState, emit);
      if (r.textDelta) fullText += r.textDelta;
      if (r.resultText != null) resultText = r.resultText;
      if (r.cliSessionId) cliSessionId = r.cliSessionId;
      if (r.model) model = r.model;
      if (r.usage) usage = r.usage;
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.on("error", (err) => {
      const msg = `\n\n[Flash model error: ${err.message}]`;
      // Terminal error: stream it live unless we're deciding whether to fall
      // back. Any content that already streamed is kept and the error appended.
      if (!suppressTerminalError) emit.token(msg);
      const base = fullText || resultText;
      finish(base ? base + msg : msg, null, msg);
    });

    proc.on("close", (code) => {
      if (lineBuffer.trim()) consumeLine(lineBuffer);
      const base = fullText || resultText;
      if (!base && code !== 0) {
        const msg = `\n\n[Flash model error: claude exited with code ${code}${stderrBuf.trim() ? ` — ${stderrBuf.trim().slice(0, 400)}` : ""}]`;
        if (!suppressTerminalError) emit.token(msg);
        finish(msg, code, msg);
        return;
      }
      // Content present (a non-zero exit after real output is treated as the
      // answer, matching prior behavior) or a clean success — no terminal error.
      finish(base, code);
    });
  });
}

// A --resume attempt that fails this way looks like a stale/expired CLI
// session (daemon restart, session pruned by the CLI, etc.) rather than a
// real turn failure — worth a silent retry rather than surfacing raw CLI
// plumbing to the user. A stale --resume fails at session lookup BEFORE any
// content streams, so live streaming loses nothing by suppressing only the
// terminal error until we've classified it.
const STALE_RESUME_RE = /\bsession\b|\bresume\b/i;

// ---------------------------------------------------------------------------
// Fabricated-tool-call guard. A weak model under the "never dead-end" doctrine
// can write tool-call MARKUP into its reply text and invent the "result" (live
// regression 2026-07-12: fake `glob` calls plus a made-up file count, spoken
// aloud). Real tool use never appears in reply text — it arrives as separate
// tool_use stream events — so any call-syntax markup in the final text is
// fabrication by construction. Deterministic gate, same philosophy as the
// dispatch-time tool allow-list: prompt guidance is not a guarantee.
// Signatures are markup-shaped on purpose — naming a tool in prose is fine.
const FABRICATED_TOOL_MARKUP_RE = /<\/?function_calls>|<\/?invoke\b|"tool_name"\s*:|<\/?antml:/i;

const FABRICATED_REPLY =
  "I caught myself making up a tool call in that answer instead of using a real one, so I've thrown it away — " +
  "don't trust anything I just claimed. I don't actually have a tool for that yet. Ask me again and I'll " +
  "learn a proper skill for it instead.";

/** Pure: replace a reply containing fabricated tool-call markup with an honest one. */
export function guardFabricatedToolCalls(text: string): { text: string; fabricated: boolean } {
  if (!FABRICATED_TOOL_MARKUP_RE.test(text)) return { text, fabricated: false };
  return { text: FABRICATED_REPLY, fabricated: true };
}

/** Apply the guard to a finished attempt's text, logging when it fires. */
function guardedText(raw: string, sessionId: string): string {
  const { text, fabricated } = guardFabricatedToolCalls(raw);
  if (fabricated) console.warn(`[flash:guard] fabricated tool-call markup in reply (session ${sessionId}) — replaced with honest refusal`);
  return text;
}

/**
 * Record one task_telemetry row for a completed Flash turn — the Flash-lane
 * counterpart to agent-manager's captureRunTelemetry (orchestrator coding
 * tasks). Without this, Flash chat/voice/skill usage (Haiku) is invisible to
 * the observability dashboard even though it's the majority of day-to-day
 * traffic.
 *
 * `role: "flash"` distinguishes these rows from orchestrator task runs in the
 * same table. Called exactly once per completed Flash turn (see the three
 * call sites in runFlashAgentLoop): NOT for a stale `--resume` attempt that
 * gets silently retried (nothing user-visible happened on that attempt), and
 * NOT for an `escalate_to_task` follow-on task — that task records its own
 * row via captureRunTelemetry when it completes, so recording the flash turn
 * itself here doesn't double-count it.
 *
 * Best-effort by construction: every step is inside the try/catch, and the
 * call sites below don't await this (recordRun is a synchronous better-sqlite3
 * write) — a telemetry failure must never break or delay the chat reply.
 */
function recordFlashTelemetry(args: {
  sessionId: string;
  model: string | null;
  usage: FlashUsage | null;
  failed: boolean;
  startedAtMs: number;
}): void {
  try {
    let connectivity: string | null = null;
    try {
      connectivity = getConnectivityPolicy().mode;
    } catch {
      /* connectivity optional */
    }
    recordRun({
      // Unique per turn (not per session) so each Flash turn is its own row —
      // sharing a taskId across a whole conversation would collapse many
      // turns into what routeScorecard treats as a single "task".
      taskId: `flash:${args.sessionId}:${randomUUID()}`,
      runIndex: 0,
      model: args.model,
      role: "flash",
      connectivity,
      status: args.failed ? "failed" : "done",
      inputTokens: args.usage?.inputTokens ?? null,
      outputTokens: args.usage?.outputTokens ?? null,
      cacheReadTokens: args.usage?.cacheReadTokens ?? null,
      cacheCreationTokens: args.usage?.cacheCreationTokens ?? null,
      cacheCreate5mTokens: args.usage?.cacheCreate5mTokens ?? null,
      cacheCreate1hTokens: args.usage?.cacheCreate1hTokens ?? null,
      reasoningTokens: args.usage?.reasoningTokens ?? null,
      costUsd: args.usage?.costUsd ?? null,
      turns: args.usage?.turns ?? null,
      startedAtMs: args.startedAtMs,
      completedAtMs: Date.now(),
      project: "hivematrix",
    });
  } catch {
    /* observability is non-critical — never break the chat reply */
  }
}

export async function runFlashAgentLoop(
  messages: FlashMessage[],
  emit: FlashEmitter,
  sessionId: string,
  brainRoot: string | null,
  options: FlashLoopOptions = {},
): Promise<string> {
  if (!backendConfigured("claude")) {
    const msg = "Claude not configured — set it up in Settings → Models.";
    emit.token(msg);
    return msg;
  }

  const ctx: LaneToolContext = {
    projectPath: brainRoot ?? homedir(),
    project: "hivematrix",
    requestedBy: `flash:${sessionId}`,
  };

  const { configPath, toolNames } = prepareFlashMcp(
    process.env.HIVEMATRIX_PORT ?? "3747",
    process.execPath,
    { allowedTools: options.allowedTools, brainRoot, ctx, sessionId },
  );

  const binary = options.__claudeBinary ?? resolveClaudeBinary();
  const spawnImpl = options.__spawn ?? spawn;
  const startedAtMs = Date.now();

  const buildTurn = (resumeId: string | null) => {
    const { systemPrompts, prompt } = buildFlashPrompt(messages, !!resumeId);
    const args = buildFlashSpawnArgs({
      systemPrompts,
      mcpConfigPath: configPath,
      toolNames,
      maxTurns: MAX_TOOL_CALLS,
      resumeSessionId: resumeId,
    });
    return { args, prompt };
  };

  const storedCliSessionId = getFlashCliSessionId(sessionId);

  if (!storedCliSessionId) {
    // First turn (or a prior stale-session fallback already cleared the id):
    // full-history serialization, streamed straight through.
    const { args, prompt } = buildTurn(null);
    const result = await runFlashAttempt(binary, args, prompt, spawnImpl, emit);
    if (result.cliSessionId) setFlashCliSessionId(sessionId, result.cliSessionId);
    recordFlashTelemetry({ sessionId, model: result.model, usage: result.usage, failed: !!result.terminalError, startedAtMs });
    return guardedText(result.text, sessionId);
  }

  // --resume attempt: stream content/tool/error events LIVE through the real
  // emit, but suppress only the TERMINAL failure message. A stale session
  // fails at lookup before any content streams, so the user sees nothing
  // withheld; if it turns out non-stale, we surface the withheld error below.
  const { args, prompt } = buildTurn(storedCliSessionId);
  const resumeResult = await runFlashAttempt(binary, args, prompt, spawnImpl, emit, true);

  const looksStale =
    resumeResult.exitCode !== null &&
    resumeResult.exitCode !== 0 &&
    STALE_RESUME_RE.test(`${resumeResult.stderr} ${resumeResult.text}`);

  if (looksStale) {
    // Stale/expired session — drop it and retry the SAME turn once, for real
    // this time: no --resume, full-history serialization, live streaming, and
    // terminal errors surfaced normally. (Stale produced no content, so there
    // is nothing already on screen to conflict with the retry.)
    clearFlashCliSessionId(sessionId);
    const fallback = buildTurn(null);
    const fallbackResult = await runFlashAttempt(binary, fallback.args, fallback.prompt, spawnImpl, emit);
    if (fallbackResult.cliSessionId) setFlashCliSessionId(sessionId, fallbackResult.cliSessionId);
    recordFlashTelemetry({ sessionId, model: fallbackResult.model, usage: fallbackResult.usage, failed: !!fallbackResult.terminalError, startedAtMs });
    return guardedText(fallbackResult.text, sessionId);
  }

  // Not stale. If the attempt still errored (a real, non-session failure), the
  // terminal message was suppressed above — surface it now (any content that
  // streamed live is already on screen; we only append the error, no re-run).
  if (resumeResult.terminalError) emit.token(resumeResult.terminalError);
  if (resumeResult.cliSessionId) setFlashCliSessionId(sessionId, resumeResult.cliSessionId);
  // Note: the stale-but-discarded `resumeResult` attempt above (the one that
  // triggered the `looksStale` retry) is intentionally NOT recorded here —
  // only the real, user-visible attempt gets a telemetry row.
  recordFlashTelemetry({ sessionId, model: resumeResult.model, usage: resumeResult.usage, failed: !!resumeResult.terminalError, startedAtMs });
  return guardedText(resumeResult.text, sessionId);
}
