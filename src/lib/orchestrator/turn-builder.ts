import { randomUUID } from "crypto";
import type { StreamEvent } from "./stream-parser";
import type {
  Turn,
  TurnKind,
  TurnContent,
  WorkflowPhase,
  TextContent,
} from "./turn-types";
import { CURRENT_SIGNAL_VERSION } from "./heuristics";
import {
  ASSISTANT_TEXT_MAX_CHARS,
  TOOL_CONTENT_MAX_CHARS,
  ERROR_MAX_CHARS,
  QUIET_CLOSE_MS,
  LABEL_MAX_CHARS,
  ERROR_LABEL_MAX,
  TOOL_ARG_LABEL_MAX,
} from "./heuristics";

type OnTurn = (turn: Turn) => void;

function genId(): string {
  // Sortable-ish id: timestamp hex + 6 random chars. Not a true ulid but
  // monotonic within a process is enough for turn ordering.
  return Date.now().toString(36) + randomUUID().replace(/-/g, "").slice(0, 8);
}

function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

function truncateText(text: string, cap: number): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  return { text: text.slice(0, cap), truncated: true };
}

function stripMarkdown(line: string): string {
  return line
    .replace(/^#+\s+/, "")
    .replace(/^[*_-]\s+/, "")
    .replace(/[*_`]/g, "")
    .trim();
}

function firstNonEmptyLine(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const stripped = stripMarkdown(raw);
    if (stripped) return stripped;
  }
  return "";
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function parseJsonSafe(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function labelForAssistantText(text: string): string {
  const head = firstNonEmptyLine(text);
  return `assistant: ${clip(head, LABEL_MAX_CHARS)}`;
}

function labelForToolCall(tool: string, input: unknown): string {
  let argSummary = "";
  if (typeof input === "string") argSummary = input;
  else if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    // Pick first "interesting" field
    const primary =
      obj.command ??
      obj.file_path ??
      obj.path ??
      obj.pattern ??
      obj.url ??
      obj.description ??
      obj.query ??
      obj.prompt;
    if (primary !== undefined) argSummary = String(primary);
    else argSummary = JSON.stringify(obj);
  }
  return `tool: ${tool} ${clip(argSummary, TOOL_ARG_LABEL_MAX)}`.trim();
}

function labelForToolResult(forTool: string, text: string, isError: boolean): string {
  const lines = text ? text.split(/\r?\n/).length : 0;
  const prefix = isError ? "[error] " : "";
  return `${prefix}result: ${forTool} (${lines} lines / ${text.length} chars)`;
}

function parseAskUserQuestion(input: unknown): { prompt: string; options?: string[] } {
  const parsed = typeof input === "string" ? parseJsonSafe(input) : input;
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    // AskUserQuestion has shape { questions: [{ question, header, multiSelect, options: [{label, description}] }] }
    const questions = p.questions as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(questions) && questions.length > 0) {
      const q = questions[0];
      const prompt = (q.question as string) ?? (q.header as string) ?? "";
      const options = Array.isArray(q.options)
        ? (q.options as Array<Record<string, unknown>>)
            .map((o) => (typeof o.label === "string" ? o.label : String(o)))
            .filter(Boolean)
        : undefined;
      return { prompt, options };
    }
    if (typeof p.question === "string") return { prompt: p.question };
  }
  return { prompt: typeof input === "string" ? input : JSON.stringify(input ?? "") };
}

/**
 * Per-agent stateful turn assembler. One instance lives alongside each
 * spawned agent in agent-manager and consumes normalized `StreamEvent`s.
 *
 * Close rules (whichever fires first):
 *   - Transition text → tool_use/tool_result closes the open assistant_message
 *   - A tool_use event emits a self-contained tool_call turn
 *   - A tool_result event emits a tool_result turn and links it to the most
 *     recent unresolved tool_call via resultTurnId
 *   - Quiet-interval timer (QUIET_CLOSE_MS) closes a stale open assistant
 *     message if deltas dry up
 *   - flush() closes any open turn (call on process exit)
 */
export class TurnBuilder {
  private taskId: string;
  private workflow?: WorkflowPhase;
  private onTurn: OnTurn;
  private sequence = 0;
  private openAssistant: Turn | null = null;
  private assistantBuffer = "";
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingToolCalls: string[] = []; // ids of tool_calls awaiting a matching result

  constructor(taskId: string, onTurn: OnTurn, workflow?: WorkflowPhase) {
    this.taskId = taskId;
    this.workflow = workflow;
    this.onTurn = onTurn;
  }

  setWorkflow(phase: WorkflowPhase | undefined) {
    this.workflow = phase;
  }

  private nextSeq(): number {
    return this.sequence++;
  }

  private newTurn(kind: TurnKind, content: TurnContent, label: string): Turn {
    return {
      id: genId(),
      taskId: this.taskId,
      sequence: this.nextSeq(),
      role:
        kind === "assistant_message" || kind === "assistant_thinking"
          ? "assistant"
          : kind === "tool_call"
          ? "assistant"
          : kind === "tool_result"
          ? "tool"
          : kind === "ask_user_question"
          ? "assistant"
          : "system",
      kind,
      label,
      phase: this.workflow,
      startedAt: new Date().toISOString(),
      content,
      signals: [],
      signalsVersion: CURRENT_SIGNAL_VERSION,
    };
  }

  private clearQuietTimer() {
    if (this.quietTimer) {
      clearTimeout(this.quietTimer);
      this.quietTimer = null;
    }
  }

  private scheduleQuietClose() {
    this.clearQuietTimer();
    this.quietTimer = setTimeout(() => {
      this.closeAssistantMessage();
    }, QUIET_CLOSE_MS);
  }

  private closeAssistantMessage() {
    this.clearQuietTimer();
    if (!this.openAssistant) return;
    const raw = this.assistantBuffer;
    const { text, truncated } = truncateText(raw, ASSISTANT_TEXT_MAX_CHARS);
    const content: TextContent = {
      type: "text",
      text,
      wordCount: countWords(text),
      truncated,
    };
    const turn = this.openAssistant;
    turn.content = content;
    turn.label = labelForAssistantText(text);
    turn.endedAt = new Date().toISOString();
    this.openAssistant = null;
    this.assistantBuffer = "";
    this.onTurn(turn);
  }

  emitSystem(event: string, text?: string) {
    this.closeAssistantMessage();
    const body = text ?? event;
    const turn = this.newTurn(
      "system",
      { type: "error", text: body }, // reuse error shape for plain text systems? No — need dedicated
      `system: ${clip(event, LABEL_MAX_CHARS)}`
    );
    // Replace content with a synthetic "text" block on a system turn is messy;
    // instead use error content but not flagged — simpler: re-emit as text turn.
    turn.content = {
      type: "error",
      text: body,
    };
    this.onTurn(turn);
  }

  emitWorkflowStart() {
    if (!this.workflow) return;
    this.closeAssistantMessage();
    const turn = this.newTurn(
      "workflow_step_start",
      {
        type: "workflow_marker",
        step: this.workflow.stepName ?? this.workflow.workflow,
        stepIndex: this.workflow.stepIndex,
        event: "start",
      },
      `▶ step ${this.workflow.stepIndex}: ${this.workflow.stepName ?? this.workflow.workflow}`
    );
    turn.endedAt = turn.startedAt;
    this.onTurn(turn);
  }

  emitWorkflowEnd() {
    if (!this.workflow) return;
    this.closeAssistantMessage();
    const turn = this.newTurn(
      "workflow_step_end",
      {
        type: "workflow_marker",
        step: this.workflow.stepName ?? this.workflow.workflow,
        stepIndex: this.workflow.stepIndex,
        event: "end",
      },
      `■ step ${this.workflow.stepIndex}: ${this.workflow.stepName ?? this.workflow.workflow}`
    );
    turn.endedAt = turn.startedAt;
    this.onTurn(turn);
  }

  /** Main entry point. Ingest a normalized StreamEvent. */
  ingest(event: StreamEvent) {
    switch (event.type) {
      case "text": {
        // Open (or keep open) an assistant_message turn and accumulate.
        if (!this.openAssistant) {
          this.openAssistant = this.newTurn(
            "assistant_message",
            { type: "text", text: "", wordCount: 0, truncated: false },
            "assistant: …"
          );
        }
        this.assistantBuffer += event.content ?? "";
        this.scheduleQuietClose();
        return;
      }

      case "question": {
        this.closeAssistantMessage();
        const q = this.newTurn(
          "ask_user_question",
          { type: "question", prompt: event.prompt, options: event.options },
          `question: ${clip(event.prompt, LABEL_MAX_CHARS)}`
        );
        q.endedAt = q.startedAt;
        this.onTurn(q);
        return;
      }

      case "tool_use": {
        // Close any open assistant message before a tool call.
        this.closeAssistantMessage();
        const inputParsed = parseJsonSafe(event.input) ?? event.input;
        const tool = event.tool ?? "unknown";

        if (tool === "AskUserQuestion") {
          const { prompt, options } = parseAskUserQuestion(inputParsed);
          const q = this.newTurn(
            "ask_user_question",
            { type: "question", prompt, options },
            `question: ${clip(prompt, LABEL_MAX_CHARS)}`
          );
          q.endedAt = q.startedAt;
          this.onTurn(q);
          return;
        }

        const callTurn = this.newTurn(
          "tool_call",
          { type: "tool", tool, input: inputParsed },
          labelForToolCall(tool, inputParsed)
        );
        callTurn.endedAt = callTurn.startedAt;
        this.pendingToolCalls.push(callTurn.id);
        this.onTurn(callTurn);
        return;
      }

      case "tool_result": {
        this.closeAssistantMessage();
        const raw = event.content ?? "";
        const isError = raw.startsWith("[error]");
        const { text, truncated } = truncateText(raw, TOOL_CONTENT_MAX_CHARS);
        const forToolTurnId = this.pendingToolCalls.shift();

        // Name of the tool this result is for isn't carried on the event; use
        // "tool" as a generic placeholder. UI pairs them by forToolTurnId.
        const resultTurn = this.newTurn(
          "tool_result",
          { type: "tool_result", forToolTurnId, text, isError, truncated },
          labelForToolResult("tool", text, isError)
        );
        resultTurn.endedAt = resultTurn.startedAt;
        this.onTurn(resultTurn);
        return;
      }

      case "init": {
        this.closeAssistantMessage();
        const turn = this.newTurn(
          "system",
          { type: "error", text: `init: model=${event.model}` },
          `system: spawn (model=${event.model})`
        );
        turn.endedAt = turn.startedAt;
        this.onTurn(turn);
        return;
      }

      case "result": {
        this.closeAssistantMessage();
        const turn = this.newTurn(
          "result",
          {
            type: "result",
            summaryText: event.result ?? "",
            cost: event.cost ?? 0,
            turns: event.turns ?? 0,
            inputTokens: event.inputTokens ?? 0,
            outputTokens: event.outputTokens ?? 0,
            sessionId: event.sessionId ?? "",
          },
          `result: cost=$${(event.cost ?? 0).toFixed(2)}, turns=${event.turns ?? 0}`
        );
        turn.endedAt = turn.startedAt;
        this.onTurn(turn);
        return;
      }

      case "error": {
        this.closeAssistantMessage();
        const text = (event.content ?? "").slice(0, ERROR_MAX_CHARS);
        const turn = this.newTurn(
          "error",
          { type: "error", text },
          `error: ${clip(text, ERROR_LABEL_MAX)}`
        );
        turn.endedAt = turn.startedAt;
        this.onTurn(turn);
        return;
      }

      case "unknown":
      default:
        return;
    }
  }

  /** Flush any open turn. Call on process exit. */
  flush() {
    this.closeAssistantMessage();
    this.clearQuietTimer();
  }
}
