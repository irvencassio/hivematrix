import test from "node:test";
import assert from "node:assert/strict";

import {
  createStreamState,
  parseOpenAIChunk,
  getFinishReason,
  getCompletedToolCalls,
} from "./openai-stream-adapter";

function chunk(data: Record<string, unknown>): string {
  return JSON.stringify(data);
}

test("getFinishReason reflects a length-truncated stop", () => {
  const state = createStreamState();
  parseOpenAIChunk(
    chunk({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: "call_1", function: { name: "write_file", arguments: '{"path":"x","content":"abc' } }],
          },
          finish_reason: null,
        },
      ],
    }),
    state
  );
  parseOpenAIChunk(chunk({ choices: [{ delta: {}, finish_reason: "length" }] }), state);

  assert.equal(getFinishReason(state), "length");
});

test("a length stop with accumulated tool calls still emits tool_use", () => {
  const state = createStreamState();
  parseOpenAIChunk(
    chunk({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: "call_1", function: { name: "write_file", arguments: '{"path":"x","content":"abc' } }],
          },
          finish_reason: null,
        },
      ],
    }),
    state
  );
  const events = parseOpenAIChunk(chunk({ choices: [{ delta: {}, finish_reason: "length" }] }), state);

  const toolUse = events.find((e) => e.type === "tool_use");
  assert.ok(toolUse, "expected a tool_use event on length-truncated tool call");
  assert.equal(getCompletedToolCalls(state).length, 1);
  assert.equal(getCompletedToolCalls(state)[0].arguments, '{"path":"x","content":"abc');
});

test("a length stop with no accumulated tool calls emits no tool_use", () => {
  const state = createStreamState();
  parseOpenAIChunk(chunk({ choices: [{ delta: { content: "some long text response" }, finish_reason: null }] }), state);
  const events = parseOpenAIChunk(chunk({ choices: [{ delta: {}, finish_reason: "length" }] }), state);

  assert.equal(events.find((e) => e.type === "tool_use"), undefined);
  assert.equal(getFinishReason(state), "length");
});

test("getFinishReason is null before any finish_reason arrives", () => {
  const state = createStreamState();
  parseOpenAIChunk(chunk({ choices: [{ delta: { content: "hi" }, finish_reason: null }] }), state);
  assert.equal(getFinishReason(state), null);
});

test("a normal tool_calls finish still emits tool_use as before", () => {
  const state = createStreamState();
  parseOpenAIChunk(
    chunk({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: "call_1", function: { name: "bash", arguments: '{"command":"ls"}' } }],
          },
          finish_reason: null,
        },
      ],
    }),
    state
  );
  const events = parseOpenAIChunk(chunk({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }), state);

  assert.ok(events.find((e) => e.type === "tool_use"));
  assert.equal(getFinishReason(state), "tool_calls");
});
