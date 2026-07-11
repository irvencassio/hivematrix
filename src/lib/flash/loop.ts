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
 * History: full-history-per-turn serialization (system messages via
 * --append-system-prompt, prior turns folded into the -p prompt as a
 * transcript) — NOT --resume/session-continuity. This is simpler and
 * correct; it costs a little more input-token overhead per turn than
 * --resume would, since --resume was deferred (it needs a sessionId→CLI
 * session-id mapping persisted in flash session state, which the current
 * schema doesn't carry — a follow-up, not required for correctness here).
 */

import { spawn, type ChildProcess } from "child_process";
import { homedir } from "os";
import { resolveClaudeBinary } from "@/lib/orchestrator/subprocess";
import { StreamParser } from "@/lib/orchestrator/stream-parser";
import { backendConfigured } from "@/lib/models/backends";
import type { LaneToolContext } from "@/lib/orchestrator/lane-tools";
import { prepareFlashMcp } from "./flash-mcp";
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
 * final user message (which becomes the actual -p prompt).
 */
export function buildFlashPrompt(messages: FlashMessage[]): FlashPromptParts {
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
  return [
    "-p",
    "--model",
    "haiku",
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(input.maxTurns),
    "--mcp-config",
    input.mcpConfigPath,
    "--allowedTools",
    input.toolNames.join(","),
    ...input.systemPrompts.flatMap((sp) => ["--append-system-prompt", sp]),
  ];
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
): { textDelta?: string; resultText?: string } {
  if (!line.trim()) return {};
  const events = parser.parseLine(line);
  let textDelta: string | undefined;
  let resultText: string | undefined;

  for (const event of events) {
    if (event.type === "text") {
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
    } else if (event.type === "error") {
      const msg = `\n\n[Flash model error: ${event.content}]`;
      textDelta = (textDelta ?? "") + msg;
      emit.token(msg);
    }
    // "init"/"session"/"log"/"question"/"unknown" — not surfaced to Flash.
  }
  return { textDelta, resultText };
}

// ------------------------------------------------------------------
// Main agent loop
// ------------------------------------------------------------------

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

  const { systemPrompts, prompt } = buildFlashPrompt(messages);
  const args = buildFlashSpawnArgs({
    systemPrompts,
    mcpConfigPath: configPath,
    toolNames,
    maxTurns: MAX_TOOL_CALLS,
  });

  const binary = options.__claudeBinary ?? resolveClaudeBinary();
  const spawnImpl = options.__spawn ?? spawn;

  return new Promise<string>((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawnImpl(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      const msg = `\n\n[Flash model error: failed to launch claude — ${err instanceof Error ? err.message : String(err)}]`;
      emit.token(msg);
      resolve(msg);
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
    let settled = false;

    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallTimer);
      resolve(text);
    };

    const wallTimer = setTimeout(() => {
      try { proc.kill("SIGTERM"); } catch { /* already dead */ }
      const elapsedS = Math.round(MAX_WALL_MS / 1000);
      const budgetMsg = `\n\n[Budget reached: ${elapsedS}s wall clock. Use "escalate this to a task" for longer tasks.]`;
      emit.token(budgetMsg);
      finish((fullText || resultText) + budgetMsg);
    }, MAX_WALL_MS);

    const consumeLine = (line: string) => {
      const r = consumeFlashStreamLine(line, parser, streamState, emit);
      if (r.textDelta) fullText += r.textDelta;
      if (r.resultText != null) resultText = r.resultText;
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
      emit.token(msg);
      finish((fullText || resultText) + msg);
    });

    proc.on("close", (code) => {
      if (lineBuffer.trim()) consumeLine(lineBuffer);
      let text = fullText || resultText;
      if (!text && code !== 0) {
        const msg = `\n\n[Flash model error: claude exited with code ${code}${stderrBuf.trim() ? ` — ${stderrBuf.trim().slice(0, 400)}` : ""}]`;
        emit.token(msg);
        text = msg;
      }
      finish(text);
    });
  });
}
