export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "log"; content: string }
  | { type: "session"; sessionId: string }
  | { type: "question"; prompt: string; options?: string[] }
  | { type: "tool_use"; tool: string; input: string }
  | { type: "tool_result"; content: string }
  | { type: "init"; model: string }
  | { type: "result"; sessionId: string; cost: number; result: string; turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; cacheCreate5mTokens?: number; cacheCreate1hTokens?: number; contextWindow: number; reasoningTokens?: number }
  | { type: "error"; content: string }
  | { type: "unknown"; raw: string };

const TOOL_RESULT_MAX_CHARS = 2000;

function flattenToolResultContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") return b.text;
        if (b.type === "image") return "[image]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/**
 * Per-process stream parser — each spawned agent gets its own instance
 * so concurrent agents don't corrupt each other's tool-accumulation state.
 */
export class StreamParser {
  private currentToolName = "";
  private currentToolInput = "";

  parseLine(line: string): StreamEvent[] {
    if (!line.trim()) return [];

    try {
      const data = JSON.parse(line);

      // Final result message
      if (data.type === "result") {
        const usage = data.usage as Record<string, number> | undefined;
        const cacheRead = usage?.cache_read_input_tokens ?? 0;
        const cacheCreate = usage?.cache_creation_input_tokens ?? 0;
        // The 5m/1h split prices differently (1.25x vs 2.0x base input) — the
        // flat cacheCreate total above can't tell you which tier wrote it.
        // Absent (older CLI, or a provider that doesn't report it) → undefined,
        // never a fake 0.
        const cacheCreationDetail = (data.usage as Record<string, unknown> | undefined)?.cache_creation as Record<string, number> | undefined;
        const cacheCreate5m = cacheCreationDetail?.ephemeral_5m_input_tokens;
        const cacheCreate1h = cacheCreationDetail?.ephemeral_1h_input_tokens;
        if (cacheCreate5m != null && cacheCreate1h != null && cacheCreate5m + cacheCreate1h !== cacheCreate) {
          // Anthropic's documented invariant broke — surface it, but don't let
          // a reporting mismatch break task completion over a telemetry detail.
          console.warn(
            `[observability] cache_creation split mismatch: ${cacheCreate5m}+${cacheCreate1h} !== ${cacheCreate} (session ${data.session_id ?? "?"})`,
          );
        }
        const baseInput = usage?.input_tokens ?? 0;
        const inputTok = baseInput + cacheCreate + cacheRead;
        const outputTok = usage?.output_tokens ?? 0;
        let contextWindow = 0;
        let reasoningTokens = usage?.reasoning_output_tokens ?? usage?.reasoning_tokens ?? 0;
        const modelUsage = data.modelUsage as Record<string, Record<string, number>> | undefined;
        if (modelUsage) {
          const first = Object.values(modelUsage)[0];
          if (first?.contextWindow) contextWindow = first.contextWindow;
          if (!reasoningTokens && first?.reasoningTokens) reasoningTokens = first.reasoningTokens;
        }
        return [{
          type: "result",
          sessionId: data.session_id ?? "",
          cost: data.total_cost_usd ?? data.cost_usd ?? 0,
          result: typeof data.result === "string"
            ? data.result
            : Array.isArray(data.result)
              ? (data.result as Array<Record<string, unknown>>)
                  .filter((b) => b.type === "text" && typeof b.text === "string")
                  .map((b) => b.text as string)
                  .join("\n") || JSON.stringify(data.result)
              : JSON.stringify(data.result),
          turns: data.num_turns ?? data.turns ?? 0,
          inputTokens: inputTok || data.total_input_tokens || 0,
          outputTokens: outputTok || data.total_output_tokens || 0,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreate,
          cacheCreate5mTokens: cacheCreate5m,
          cacheCreate1hTokens: cacheCreate1h,
          contextWindow,
          reasoningTokens: reasoningTokens || undefined,
        }];
      }

      // Stream events (from --verbose)
      if (data.type === "stream_event") {
        const event = data.event;

        if (event?.delta?.type === "text_delta") {
          return [{ type: "text", content: event.delta.text }];
        }

        if (
          event?.type === "content_block_start" &&
          event?.content_block?.type === "tool_use"
        ) {
          this.currentToolName = event.content_block.name ?? "unknown";
          this.currentToolInput = "";
          return [];
        }

        if (event?.delta?.type === "input_json_delta" && this.currentToolName) {
          this.currentToolInput += event.delta.partial_json ?? "";
          return [];
        }

        if (event?.type === "content_block_stop" && this.currentToolName) {
          const tool = this.currentToolName;
          const input = this.currentToolInput;
          this.currentToolName = "";
          this.currentToolInput = "";
          return [{ type: "tool_use", tool, input: input.slice(0, 500) }];
        }

        if (event?.type === "content_block_start" && event?.content_block?.type === "tool_result") {
          const flat = flattenToolResultContent(event.content_block.content);
          return [{
            type: "tool_result",
            content: flat.slice(0, TOOL_RESULT_MAX_CHARS),
          }];
        }
      }

      // Full assistant message — may contain multiple text/tool_use blocks
      if (data.type === "assistant" && data.message?.content) {
        const out: StreamEvent[] = [];
        const parts: string[] = [];
        for (const block of data.message.content) {
          if (block.type === "text" && block.text) {
            parts.push(block.text);
          } else if (block.type === "tool_use") {
            if (parts.length > 0) {
              out.push({ type: "text", content: parts.join("\n") });
              parts.length = 0;
            }
            out.push({
              type: "tool_use",
              tool: block.name ?? "unknown",
              input: (typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? "")).slice(0, 500),
            });
          }
        }
        if (parts.length > 0) {
          out.push({ type: "text", content: parts.join("\n") });
        }
        return out;
      }

      // User message — this is where Claude CLI delivers tool_result blocks
      // (stdout/stderr from Bash, file contents from Read, etc.). Without
      // this handler, the OUTPUT section only shows tool invocations with
      // no visible results.
      if (data.type === "user" && data.message?.content) {
        const out: StreamEvent[] = [];
        const content = data.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === "tool_result") {
              const flat = flattenToolResultContent(block.content);
              if (flat) {
                const prefix = block.is_error ? "[error] " : "";
                out.push({
                  type: "tool_result",
                  content: (prefix + flat).slice(0, TOOL_RESULT_MAX_CHARS),
                });
              }
            }
          }
        } else if (typeof content === "string" && content.trim()) {
          out.push({ type: "tool_result", content: content.slice(0, TOOL_RESULT_MAX_CHARS) });
        }
        return out;
      }

      // System init — carries the session_id at the START of the run. Emit it as
      // a `session` event so steering works mid-run (otherwise sessionId is only
      // captured from the final `result` event, i.e. never in time to steer).
      if (data.type === "system" && data.subtype === "init") {
        const out: StreamEvent[] = [];
        if (typeof data.session_id === "string" && data.session_id) {
          out.push({ type: "session", sessionId: data.session_id });
        }
        out.push({ type: "init", model: data.model ?? "unknown" });
        return out;
      }

      // Error events
      if (data.type === "error") {
        return [{
          type: "error",
          content: data.error?.message ?? JSON.stringify(data.error ?? data),
        }];
      }

      return [];
    } catch {
      return [];
    }
  }
}

/** @deprecated Use `new StreamParser().parseLine()` instead — kept for non-concurrent callers */
export function parseStreamLine(line: string): StreamEvent | null {
  const events = _legacyParser.parseLine(line);
  return events[0] ?? null;
}
const _legacyParser = new StreamParser();
