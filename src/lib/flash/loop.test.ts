import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import {
  buildFlashPrompt,
  buildFlashSpawnArgs,
  consumeFlashStreamLine,
  createFlashStreamState,
  runFlashAgentLoop,
  READ_ONLY_FLASH_TOOLS,
} from "./loop";
import { StreamParser } from "@/lib/orchestrator/stream-parser";
import { backendConfigured } from "@/lib/models/backends";
import type { FlashEmitter, FlashMessage } from "./types";

function fakeEmitter(): FlashEmitter & {
  tokens: string[];
  toolStarts: Array<{ name: string; args: string }>;
  toolResults: Array<{ name: string; ok: boolean; summary: string }>;
  escalations: string[];
} {
  const tokens: string[] = [];
  const toolStarts: Array<{ name: string; args: string }> = [];
  const toolResults: Array<{ name: string; ok: boolean; summary: string }> = [];
  const escalations: string[] = [];
  return {
    tokens,
    toolStarts,
    toolResults,
    escalations,
    token: (delta) => tokens.push(delta),
    toolStart: (name, args_summary) => toolStarts.push({ name, args: args_summary }),
    toolResult: (name, ok, summary) => toolResults.push({ name, ok, summary }),
    escalated: (taskId) => escalations.push(taskId),
    done: () => {},
  };
}

// ------------------------------------------------------------------
// buildFlashPrompt — pure history serialization
// ------------------------------------------------------------------

test("buildFlashPrompt: system messages become separate append-system-prompt entries", () => {
  const messages: FlashMessage[] = [
    { role: "system", content: "You are Flash." },
    { role: "user", content: "hi" },
  ];
  const { systemPrompts, prompt } = buildFlashPrompt(messages);
  assert.deepEqual(systemPrompts, ["You are Flash."]);
  assert.equal(prompt, "hi");
});

test("buildFlashPrompt: prior turns fold into a transcript ahead of the final user message", () => {
  const messages: FlashMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "first question" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "second question" },
  ];
  const { prompt } = buildFlashPrompt(messages);
  assert.match(prompt, /Prior conversation/);
  assert.match(prompt, /User: first question/);
  assert.match(prompt, /Assistant: first answer/);
  // The final message is the live prompt, not folded into the transcript quote.
  assert.ok(prompt.trim().endsWith("second question"));
});

test("buildFlashPrompt: no user/assistant turns yields an empty prompt", () => {
  const { prompt, systemPrompts } = buildFlashPrompt([{ role: "system", content: "sys only" }]);
  assert.equal(prompt, "");
  assert.deepEqual(systemPrompts, ["sys only"]);
});

test("buildFlashPrompt: blank system messages are dropped", () => {
  const { systemPrompts } = buildFlashPrompt([
    { role: "system", content: "   " },
    { role: "user", content: "hi" },
  ]);
  assert.deepEqual(systemPrompts, []);
});

// ------------------------------------------------------------------
// buildFlashSpawnArgs — pure argv construction
// ------------------------------------------------------------------

test("buildFlashSpawnArgs: wires model, budgets, mcp config, and allowed tools", () => {
  const args = buildFlashSpawnArgs({
    prompt: "hello",
    systemPrompts: ["sys1", "sys2"],
    mcpConfigPath: "/p/flash-mcp-config.json",
    toolNames: ["mcp__flash__brain_search", "mcp__flash__mail_send"],
    maxTurns: 12,
  });

  assert.deepEqual(args.slice(0, 2), ["-p", "hello"]);
  assert.equal(args[args.indexOf("--model") + 1], "haiku");
  assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
  assert.ok(args.includes("--verbose"));
  assert.equal(args[args.indexOf("--max-turns") + 1], "12");
  assert.equal(args[args.indexOf("--mcp-config") + 1], "/p/flash-mcp-config.json");
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__flash__brain_search,mcp__flash__mail_send");
  // Each system prompt gets its own --append-system-prompt flag.
  const sysIdxs = args.reduce<number[]>((acc, a, i) => (a === "--append-system-prompt" ? [...acc, i] : acc), []);
  assert.equal(sysIdxs.length, 2);
  assert.equal(args[sysIdxs[0] + 1], "sys1");
  assert.equal(args[sysIdxs[1] + 1], "sys2");
});

// ------------------------------------------------------------------
// consumeFlashStreamLine — stream-json → FlashEmitter mapping
// ------------------------------------------------------------------

test("consumeFlashStreamLine: text deltas stream through emit.token and accumulate", () => {
  const parser = new StreamParser();
  const state = createFlashStreamState();
  const emit = fakeEmitter();

  const line = JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "Hello " } } });
  const r = consumeFlashStreamLine(line, parser, state, emit);

  assert.equal(r.textDelta, "Hello ");
  assert.deepEqual(emit.tokens, ["Hello "]);
});

test("consumeFlashStreamLine: tool_use then tool_result pairs by FIFO order", () => {
  const parser = new StreamParser();
  const state = createFlashStreamState();
  const emit = fakeEmitter();

  const assistantLine = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "brain_search", input: { query: "x" } }] },
  });
  consumeFlashStreamLine(assistantLine, parser, state, emit);
  assert.equal(emit.toolStarts.length, 1);
  assert.equal(emit.toolStarts[0].name, "brain_search");

  const userLine = JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", content: "found 3 docs", is_error: false }] },
  });
  consumeFlashStreamLine(userLine, parser, state, emit);

  assert.equal(emit.toolResults.length, 1);
  assert.equal(emit.toolResults[0].name, "brain_search");
  assert.equal(emit.toolResults[0].ok, true);
  assert.equal(emit.toolResults[0].summary, "found 3 docs");
});

test("consumeFlashStreamLine: an errored tool_result is reported as not-ok", () => {
  const parser = new StreamParser();
  const state = createFlashStreamState();
  const emit = fakeEmitter();

  consumeFlashStreamLine(
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mail_send", input: {} }] } }),
    parser,
    state,
    emit,
  );
  consumeFlashStreamLine(
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "boom", is_error: true }] } }),
    parser,
    state,
    emit,
  );

  assert.equal(emit.toolResults[0].ok, false);
});

test("consumeFlashStreamLine: a successful escalate_to_task tool_result triggers emit.escalated", () => {
  const parser = new StreamParser();
  const state = createFlashStreamState();
  const emit = fakeEmitter();

  consumeFlashStreamLine(
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "escalate_to_task", input: {} }] } }),
    parser,
    state,
    emit,
  );
  consumeFlashStreamLine(
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", content: 'Escalated to task abc123: "Do the thing"', is_error: false }] },
    }),
    parser,
    state,
    emit,
  );

  assert.deepEqual(emit.escalations, ["abc123"]);
});

test("consumeFlashStreamLine: result event captures the final text", () => {
  const parser = new StreamParser();
  const state = createFlashStreamState();
  const emit = fakeEmitter();
  const r = consumeFlashStreamLine(
    JSON.stringify({ type: "result", result: "final answer", session_id: "s1", usage: {} }),
    parser,
    state,
    emit,
  );
  assert.equal(r.resultText, "final answer");
});

test("consumeFlashStreamLine: blank lines are no-ops", () => {
  const parser = new StreamParser();
  const state = createFlashStreamState();
  const emit = fakeEmitter();
  assert.deepEqual(consumeFlashStreamLine("   ", parser, state, emit), {});
});

// ------------------------------------------------------------------
// READ_ONLY_FLASH_TOOLS — still the heartbeat's hard gate source
// ------------------------------------------------------------------

test("READ_ONLY_FLASH_TOOLS excludes every write-capable lane tool", () => {
  for (const writeTool of ["mail_send", "message_send", "desktop_action", "persona_update", "escalate_to_task"]) {
    assert.equal(READ_ONLY_FLASH_TOOLS.has(writeTool), false, `${writeTool} must not be read-only`);
  }
  assert.ok(READ_ONLY_FLASH_TOOLS.has("brain_search"));
});

// ------------------------------------------------------------------
// runFlashAgentLoop — end-to-end against a fake `claude` child process
// (child_process.spawn is injected via options.__spawn, same DI shape as
// subprocess.ts's own argv-construction tests, extended here to the process
// boundary since Flash's loop is now a pure stream observer).
// ------------------------------------------------------------------

function fakeSpawn(lines: string[], exitCode = 0): (...args: unknown[]) => ChildProcess {
  return () => {
    const proc = new EventEmitter() as unknown as ChildProcess;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    Object.assign(proc, { stdout, stderr, kill: () => true });
    setImmediate(() => {
      for (const line of lines) stdout.emit("data", Buffer.from(`${line}\n`));
      proc.emit("close", exitCode, null);
    });
    return proc;
  };
}

const claudeReady = backendConfigured("claude");

test(
  "runFlashAgentLoop: streams tokens from a fake claude process and returns the final text",
  { skip: claudeReady ? false : "claude CLI not configured in this environment" },
  async () => {
    const emit = fakeEmitter();
    const lines = [
      JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "Hi there" } } }),
      JSON.stringify({ type: "result", result: "Hi there", session_id: "s1", usage: {} }),
    ];
    const text = await runFlashAgentLoop(
      [{ role: "user", content: "hello" }],
      emit,
      "test-session",
      null,
      { __spawn: fakeSpawn(lines) as never },
    );
    assert.equal(text, "Hi there");
    assert.deepEqual(emit.tokens, ["Hi there"]);
  },
);

test(
  "runFlashAgentLoop: a nonzero exit with no output surfaces stderr as an error token",
  { skip: claudeReady ? false : "claude CLI not configured in this environment" },
  async () => {
    const emit = fakeEmitter();
    const spawnImpl = () => {
      const proc = new EventEmitter() as unknown as ChildProcess;
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      Object.assign(proc, { stdout, stderr, kill: () => true });
      setImmediate(() => {
        stderr.emit("data", Buffer.from("auth expired"));
        proc.emit("close", 1, null);
      });
      return proc;
    };
    const text = await runFlashAgentLoop([{ role: "user", content: "hello" }], emit, "test-session", null, {
      __spawn: spawnImpl as never,
    });
    assert.match(text, /Flash model error/);
    assert.match(text, /auth expired/);
  },
);
