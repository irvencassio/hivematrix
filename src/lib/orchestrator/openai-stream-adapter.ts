import type { StreamEvent } from "./stream-parser";

/**
 * Accumulated state for a streaming OpenAI chat completion response.
 * Tool calls arrive incrementally across multiple SSE chunks.
 */
interface StreamState {
  toolCalls: Map<number, { id: string; name: string; arguments: string }>;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * Parse a single SSE data line from an OpenAI-compatible streaming response
 * and emit zero or more Hive StreamEvents.
 */
export function parseOpenAIChunk(
  dataStr: string,
  state: StreamState
): StreamEvent[] {
  if (dataStr === "[DONE]") return [];

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataStr);
  } catch {
    return [];
  }

  const events: StreamEvent[] = [];

  // Extract usage if present (final chunk often includes this)
  const usage = data.usage as Record<string, number> | undefined;
  if (usage) {
    state.usage.promptTokens += usage.prompt_tokens ?? 0;
    state.usage.completionTokens += usage.completion_tokens ?? 0;
    state.usage.totalTokens += usage.total_tokens ?? 0;
  }

  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  if (!choices?.length) return events;

  const choice = choices[0];
  const delta = choice.delta as Record<string, unknown> | undefined;
  const finishReason = choice.finish_reason as string | null;

  if (delta) {
    // Reasoning delta — Qwen 3.6 / LM Studio emit thinking via a separate
    // `reasoning_content` field (not inline <think> tags). Route it to a
    // reasoning event so it never contaminates content or tool arguments.
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
      events.push({ type: "reasoning", content: delta.reasoning_content });
    }

    // Text content delta
    if (typeof delta.content === "string" && delta.content) {
      events.push({ type: "text", content: delta.content });
    }

    // Tool call deltas — accumulate until finish_reason
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        const idx = (tc.index as number) ?? 0;
        const fn = tc.function as Record<string, unknown> | undefined;

        if (!state.toolCalls.has(idx)) {
          state.toolCalls.set(idx, {
            id: (tc.id as string) ?? "",
            name: (fn?.name as string) ?? "",
            arguments: "",
          });
        }

        const entry = state.toolCalls.get(idx)!;
        if (tc.id) entry.id = tc.id as string;
        if (fn?.name) entry.name = fn.name as string;
        if (typeof fn?.arguments === "string") {
          entry.arguments += fn.arguments;
        }
      }
    }
  }

  // When tool_calls finish, emit tool_use events for each accumulated call
  if (finishReason === "tool_calls" || finishReason === "function_call") {
    for (const [, tc] of state.toolCalls) {
      events.push({
        type: "tool_use",
        tool: tc.name,
        input: tc.arguments.slice(0, 500),
      });
    }
    // Don't clear yet — caller needs the full tool_calls for the messages array
  }

  return events;
}

/**
 * Create a fresh stream state for a new response.
 */
export function createStreamState(): StreamState {
  return { toolCalls: new Map(), usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
}

/**
 * Get accumulated usage from stream state.
 */
export function getUsage(state: StreamState): { promptTokens: number; completionTokens: number; totalTokens: number } {
  return { ...state.usage };
}

/**
 * Extract the completed tool calls from stream state (for building the next request).
 */
export function getCompletedToolCalls(
  state: StreamState
): Array<{ id: string; name: string; arguments: string }> {
  return Array.from(state.toolCalls.values()).filter((tc) => tc.name);
}

/**
 * Parse SSE text from a ReadableStream, yielding data lines.
 * Handles partial lines across chunks.
 */
export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (signal?.aborted) return;

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        yield trimmed.slice(6);
      }
    }
  }

  // Flush remaining
  if (buffer.trim().startsWith("data: ")) {
    yield buffer.trim().slice(6);
  }
}
