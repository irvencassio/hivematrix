import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  flashBudgetFor,
  buildFlashPrompt,
  buildFlashSpawnArgs,
  consumeFlashStreamLine,
  createFlashStreamState,
  guardFabricatedToolCalls,
  runFlashAgentLoop,
  withImageNote,
  READ_ONLY_FLASH_TOOLS,
} from "./loop";
import { createSession, getFlashCliSessionId, setFlashCliSessionId } from "./store";
import { StreamParser } from "@/lib/orchestrator/stream-parser";
import { backendConfigured } from "@/lib/models/backends";
import type { FlashEmitter, FlashMessage } from "./types";

// runFlashAgentLoop now reads/writes flash_sessions.cliSessionId (--resume
// continuity) — isolate HOME so those tests hit a throwaway DB, never the
// developer's real ~/.hivematrix/hivematrix.db. Lazily resolved (see
// db/index.ts), so setting it here — after the static imports above, but
// before any test body runs — is enough.
const TMP = mkdtempSync(join(tmpdir(), "hm-flash-loop-test-"));
const ORIGINAL_HOME = process.env.HOME;
process.env.HOME = TMP;
test.after(() => {
  if (ORIGINAL_HOME) process.env.HOME = ORIGINAL_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

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

test("buildFlashPrompt: resume=true sends only the latest user message, no transcript block", () => {
  const messages: FlashMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "first question" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "second question" },
  ];
  const { systemPrompts, prompt } = buildFlashPrompt(messages, true);
  // System prompts still go through as usual — resume only affects the transcript.
  assert.deepEqual(systemPrompts, ["sys"]);
  assert.equal(prompt, "second question");
  assert.doesNotMatch(prompt, /Prior conversation/);
  assert.doesNotMatch(prompt, /first question|first answer/);
});

test("buildFlashPrompt: resume=true with no turns yields an empty prompt (same as non-resume)", () => {
  const { prompt } = buildFlashPrompt([{ role: "system", content: "sys only" }], true);
  assert.equal(prompt, "");
});

// ------------------------------------------------------------------
// withImageNote — prompt-level vision instruction
// ------------------------------------------------------------------

test("withImageNote: no imagePaths leaves the prompt untouched", () => {
  assert.equal(withImageNote("hello"), "hello");
  assert.equal(withImageNote("hello", []), "hello");
});

test("withImageNote: prepends a Read instruction naming every path, ahead of the prompt", () => {
  const out = withImageNote("what is this?", ["/tmp/a.jpg", "/tmp/b.jpg"]);
  assert.match(out, /Read each one to see it/);
  assert.match(out, /\/tmp\/a\.jpg/);
  assert.match(out, /\/tmp\/b\.jpg/);
  assert.ok(out.trim().endsWith("what is this?"), "the original prompt still follows the note");
  assert.ok(out.indexOf("/tmp/a.jpg") < out.indexOf("what is this?"), "the note comes first");
});

test("withImageNote: an empty prompt with images yields just the note (no dangling blank prompt)", () => {
  const out = withImageNote("", ["/tmp/a.jpg"]);
  assert.match(out, /\/tmp\/a\.jpg/);
  assert.doesNotMatch(out, /\n\n$/);
});

// ------------------------------------------------------------------
// buildFlashSpawnArgs — pure argv construction
// ------------------------------------------------------------------

test("buildFlashSpawnArgs: wires model, budgets, mcp config, and allowed tools", () => {
  const args = buildFlashSpawnArgs({
    systemPrompts: ["sys1", "sys2"],
    mcpConfigPath: "/p/flash-mcp-config.json",
    toolNames: ["mcp__flash__brain_search", "mcp__flash__mail_send"],
    maxTurns: 12, model: "sonnet",
  });

  // The prompt is NOT in argv — it goes via stdin (a prompt starting with "--" would
  // otherwise be parsed as an unknown CLI option). `-p` stays as the print flag.
  assert.equal(args[0], "-p");
  assert.ok(!args.includes("hello"));
  assert.equal(args[args.indexOf("--model") + 1], "sonnet", "the model comes from the turn's budget, not a hardcoded default");
  assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
  assert.ok(args.includes("--verbose"));
  assert.equal(args[args.indexOf("--max-turns") + 1], "12");
  assert.equal(args[args.indexOf("--mcp-config") + 1], "/p/flash-mcp-config.json");
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__flash__brain_search,mcp__flash__mail_send");
  // Built-in CLI tools disabled (flash acts only through its MCP lane tools; web → Browser Lane).
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.ok(args.includes("--strict-mcp-config"));
  // Each system prompt gets its own --append-system-prompt flag.
  const sysIdxs = args.reduce<number[]>((acc, a, i) => (a === "--append-system-prompt" ? [...acc, i] : acc), []);
  assert.equal(sysIdxs.length, 2);
  assert.equal(args[sysIdxs[0] + 1], "sys1");
  assert.equal(args[sysIdxs[1] + 1], "sys2");
});

test("buildFlashSpawnArgs: with no imagePaths (hasImages unset), args are byte-identical to the pre-vision baseline", () => {
  const input = {
    systemPrompts: ["sys1"],
    mcpConfigPath: "/p/flash-mcp-config.json",
    toolNames: ["mcp__flash__brain_search", "mcp__flash__mail_send"],
    maxTurns: 12, model: "sonnet",
  };
  const withoutHasImages = buildFlashSpawnArgs(input);
  const withHasImagesFalse = buildFlashSpawnArgs({ ...input, hasImages: false });
  // Text-only turns (the overwhelming majority) must be unaffected by this feature.
  assert.deepEqual(withoutHasImages, withHasImagesFalse);
  assert.equal(withoutHasImages[withoutHasImages.indexOf("--tools") + 1], "");
  assert.equal(
    withoutHasImages[withoutHasImages.indexOf("--allowedTools") + 1],
    "mcp__flash__brain_search,mcp__flash__mail_send",
  );
  assert.ok(!withoutHasImages.includes("Read"));
});

test("buildFlashSpawnArgs: hasImages allows ONLY the Read built-in tool, plus Read added to --allowedTools", () => {
  const args = buildFlashSpawnArgs({
    systemPrompts: [],
    mcpConfigPath: "/p/flash-mcp-config.json",
    toolNames: ["mcp__flash__brain_search", "mcp__flash__mail_send"],
    maxTurns: 12, model: "sonnet",
    hasImages: true,
  });
  // --tools enables Read and nothing else from the built-in set (never "default").
  assert.equal(args[args.indexOf("--tools") + 1], "Read");
  // --allowedTools keeps every usual lane tool AND adds bare "Read".
  assert.equal(
    args[args.indexOf("--allowedTools") + 1],
    "mcp__flash__brain_search,mcp__flash__mail_send,Read",
  );
});

test("buildFlashSpawnArgs: hasImages=false behaves exactly like hasImages omitted", () => {
  const a = buildFlashSpawnArgs({
    systemPrompts: [],
    mcpConfigPath: "/p",
    toolNames: ["mcp__flash__brain_search"],
    maxTurns: 12, model: "sonnet",
    hasImages: false,
  });
  const b = buildFlashSpawnArgs({
    systemPrompts: [],
    mcpConfigPath: "/p",
    toolNames: ["mcp__flash__brain_search"],
    maxTurns: 12, model: "sonnet",
  });
  assert.deepEqual(a, b);
});

test("buildFlashSpawnArgs: a resumeSessionId adds --resume <id>; omitting it adds nothing", () => {
  const withResume = buildFlashSpawnArgs({
    systemPrompts: [],
    mcpConfigPath: "/p/flash-mcp-config.json",
    toolNames: ["mcp__flash__brain_search"],
    maxTurns: 12, model: "sonnet",
    resumeSessionId: "cli-session-abc",
  });
  assert.equal(withResume[withResume.indexOf("--resume") + 1], "cli-session-abc");

  const withoutResume = buildFlashSpawnArgs({
    systemPrompts: [],
    mcpConfigPath: "/p/flash-mcp-config.json",
    toolNames: ["mcp__flash__brain_search"],
    maxTurns: 12, model: "sonnet",
    resumeSessionId: null,
  });
  assert.ok(!withoutResume.includes("--resume"));
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

// The tool_use name here MUST carry the mcp__flash__ namespace, because that is
// what the real CLI emits — StreamParser copies content_block.name verbatim.
// This fixture used the bare "escalate_to_task", so it exercised a stream the
// CLI never produces and passed while the production comparison
// (`name === "escalate_to_task"`) could never match. emit.escalated therefore
// never fired for a real escalation, and the test said otherwise.
test("consumeFlashStreamLine: a successful escalate_to_task tool_result triggers emit.escalated", () => {
  const parser = new StreamParser();
  const state = createFlashStreamState();
  const emit = fakeEmitter();

  consumeFlashStreamLine(
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__flash__escalate_to_task", input: {} }] } }),
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
  for (const writeTool of ["mail_send", "message_send", "desktop_action", "persona_update", "escalate_to_task",
    // Goal WRITES stay gated — the heartbeat may read goals but not mutate them
    // at the observe-only (manual/standard) autonomy level.
    "goal_upsert", "goal_checkin"]) {
    assert.equal(READ_ONLY_FLASH_TOOLS.has(writeTool), false, `${writeTool} must not be read-only`);
  }
  assert.ok(READ_ONLY_FLASH_TOOLS.has("brain_search"));
  assert.ok(READ_ONLY_FLASH_TOOLS.has("brain_read"));
  // Goal READS are observe-only safe — this is what makes the heartbeat's
  // goal-progress checklist actionable at the DEFAULT autonomy (regression
  // guard: they were missing, so the goal line was silently denied).
  assert.ok(READ_ONLY_FLASH_TOOLS.has("goals_list"), "heartbeat can read goals at default autonomy");
  assert.ok(READ_ONLY_FLASH_TOOLS.has("daily_review"), "heartbeat can review what's due at default autonomy");
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

// ------------------------------------------------------------------
// runFlashAgentLoop — imagePaths threads through to the spawned CLI args
// ------------------------------------------------------------------

test(
  "runFlashAgentLoop: options.imagePaths makes the spawned claude args allow Read and name the path in the prompt",
  { skip: claudeReady ? false : "claude CLI not configured in this environment" },
  async () => {
    const session = createSession("console", "vision-test");
    const emit = fakeEmitter();
    let sawArgs: string[] = [];
    let sawPrompt = "";
    const spawnImpl = (_bin: unknown, args: string[]) => {
      sawArgs = args;
      const proc = new EventEmitter() as unknown as ChildProcess;
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const stdin = { write: (chunk: string) => { sawPrompt += chunk; }, end: () => {}, on: () => {} };
      Object.assign(proc, { stdout, stderr, stdin, kill: () => true });
      setImmediate(() => {
        stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", result: "I see a cat", session_id: "s1", usage: {} }) + "\n"));
        proc.emit("close", 0, null);
      });
      return proc;
    };

    const text = await runFlashAgentLoop([{ role: "user", content: "what is this?" }], emit, session.id, null, {
      __spawn: spawnImpl as never,
      imagePaths: ["/tmp/vision-test.jpg"],
    });

    assert.equal(text, "I see a cat");
    assert.equal(sawArgs[sawArgs.indexOf("--tools") + 1], "Read");
    assert.match(sawArgs[sawArgs.indexOf("--allowedTools") + 1], /(^|,)Read(,|$)/);
    assert.match(sawPrompt, /\/tmp\/vision-test\.jpg/);
    assert.match(sawPrompt, /Read each one to see it/);
  },
);

test(
  "runFlashAgentLoop: no imagePaths keeps --tools empty (text-only posture unchanged)",
  { skip: claudeReady ? false : "claude CLI not configured in this environment" },
  async () => {
    const session = createSession("console", "no-vision-test");
    const emit = fakeEmitter();
    let sawArgs: string[] = [];
    const spawnImpl = (_bin: unknown, args: string[]) => {
      sawArgs = args;
      const proc = new EventEmitter() as unknown as ChildProcess;
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      Object.assign(proc, { stdout, stderr, kill: () => true });
      setImmediate(() => {
        stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", result: "hi", session_id: "s1", usage: {} }) + "\n"));
        proc.emit("close", 0, null);
      });
      return proc;
    };

    await runFlashAgentLoop([{ role: "user", content: "hi" }], emit, session.id, null, {
      __spawn: spawnImpl as never,
    });

    assert.equal(sawArgs[sawArgs.indexOf("--tools") + 1], "");
  },
);

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

// ------------------------------------------------------------------
// runFlashAgentLoop — --resume continuity + stale-session fallback
// ------------------------------------------------------------------

test(
  "runFlashAgentLoop: no stored cliSessionId → first turn skips --resume and persists the session id it gets back",
  { skip: claudeReady ? false : "claude CLI not configured in this environment" },
  async () => {
    const session = createSession("console", "resume-test-fresh");
    const emit = fakeEmitter();
    let sawResume = false;
    const spawnImpl = (_bin: unknown, args: string[]) => {
      if (args.includes("--resume")) sawResume = true;
      const proc = new EventEmitter() as unknown as ChildProcess;
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      Object.assign(proc, { stdout, stderr, kill: () => true });
      setImmediate(() => {
        stdout.emit("data", Buffer.from(JSON.stringify({ type: "system", subtype: "init", session_id: "cli-session-1", model: "haiku" }) + "\n"));
        stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "hi" } } }) + "\n"));
        stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", result: "hi", session_id: "cli-session-1", usage: {} }) + "\n"));
        proc.emit("close", 0, null);
      });
      return proc;
    };

    const text = await runFlashAgentLoop([{ role: "user", content: "hello" }], emit, session.id, null, {
      __spawn: spawnImpl as never,
    });

    assert.equal(text, "hi");
    assert.equal(sawResume, false, "the very first turn has no stored id to resume");
    assert.equal(getFlashCliSessionId(session.id), "cli-session-1", "the session event from turn 1 is persisted for turn 2");
  },
);

test(
  "runFlashAgentLoop: a stored cliSessionId streams a resume turn LIVE (tokens are not buffered to the end)",
  { skip: claudeReady ? false : "claude CLI not configured in this environment" },
  async () => {
    const session = createSession("console", "resume-test-live");
    setFlashCliSessionId(session.id, "cli-session-live");

    const emit = fakeEmitter();
    let resumed = false;
    const spawnImpl = (_bin: unknown, args: string[]) => {
      resumed = args.includes("--resume");
      const proc = new EventEmitter() as unknown as ChildProcess;
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      Object.assign(proc, { stdout, stderr, kill: () => true });
      setImmediate(() => {
        stdout.emit("data", Buffer.from(JSON.stringify({ type: "system", subtype: "init", session_id: "cli-session-live", model: "haiku" }) + "\n"));
        // Two separate deltas — a buffered approach would only surface them at
        // the end; live streaming forwards each through the real emit as it lands.
        stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "streamed " } } }) + "\n"));
        stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "live" } } }) + "\n"));
        stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", result: "streamed live", session_id: "cli-session-live", usage: {} }) + "\n"));
        proc.emit("close", 0, null);
      });
      return proc;
    };

    const text = await runFlashAgentLoop([{ role: "user", content: "next" }], emit, session.id, null, {
      __spawn: spawnImpl as never,
    });

    assert.equal(resumed, true, "a stored id resumes rather than re-serializing");
    assert.equal(text, "streamed live");
    // The content reached the REAL emit as individual token deltas (not one
    // replayed blob), proving streaming isn't regressed by the resume path.
    assert.deepEqual(emit.tokens, ["streamed ", "live"]);
  },
);

test(
  "runFlashAgentLoop: a stale --resume session falls back to full-history serialization (live), without leaking the raw CLI error, and clears + replaces the stale id",
  { skip: claudeReady ? false : "claude CLI not configured in this environment" },
  async () => {
    const session = createSession("console", "resume-test-stale");
    setFlashCliSessionId(session.id, "stale-cli-session-id");

    const emit = fakeEmitter();
    let resumeCount = 0;
    let nonResumeCount = 0;

    const spawnImpl = (_bin: unknown, args: string[]) => {
      const usesResume = args.includes("--resume");
      const proc = new EventEmitter() as unknown as ChildProcess;
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      Object.assign(proc, { stdout, stderr, kill: () => true });
      if (usesResume) {
        resumeCount += 1;
        assert.equal(args[args.indexOf("--resume") + 1], "stale-cli-session-id");
        // Stale session fails at lookup BEFORE any content streams.
        setImmediate(() => {
          stderr.emit("data", Buffer.from("Error: No conversation found with session ID: stale-cli-session-id"));
          proc.emit("close", 1, null);
        });
      } else {
        nonResumeCount += 1;
        setImmediate(() => {
          stdout.emit("data", Buffer.from(JSON.stringify({ type: "system", subtype: "init", session_id: "fresh-cli-session-id", model: "haiku" }) + "\n"));
          stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "back on track" } } }) + "\n"));
          stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", result: "back on track", session_id: "fresh-cli-session-id", usage: {} }) + "\n"));
          proc.emit("close", 0, null);
        });
      }
      return proc;
    };

    const text = await runFlashAgentLoop([{ role: "user", content: "second message" }], emit, session.id, null, {
      __spawn: spawnImpl as never,
    });

    assert.equal(resumeCount, 1, "exactly one --resume attempt");
    assert.equal(nonResumeCount, 1, "exactly one non-resume retry — no double-run");
    assert.equal(text, "back on track");
    // (a) the fallback's content reached the real emit LIVE (not buffered).
    assert.deepEqual(emit.tokens, ["back on track"]);
    // (b) the raw stale-session CLI error never reached the user.
    assert.ok(
      !emit.tokens.some((t) => t.includes("No conversation found")),
      "the stale-resume error must not leak to the user",
    );
    assert.equal(
      getFlashCliSessionId(session.id),
      "fresh-cli-session-id",
      "the fresh id from the fallback attempt replaces the stale one",
    );
  },
);

test(
  "runFlashAgentLoop: a resume turn that errors NON-stale surfaces the error once and does NOT retry",
  { skip: claudeReady ? false : "claude CLI not configured in this environment" },
  async () => {
    const session = createSession("console", "resume-test-realfail");
    setFlashCliSessionId(session.id, "cli-session-ok");

    const emit = fakeEmitter();
    let attempts = 0;
    const spawnImpl = (_bin: unknown, _args: string[]) => {
      attempts += 1;
      const proc = new EventEmitter() as unknown as ChildProcess;
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      Object.assign(proc, { stdout, stderr, kill: () => true });
      setImmediate(() => {
        // A real failure with no session/resume wording — must NOT be treated as stale.
        stderr.emit("data", Buffer.from("network error: ECONNRESET"));
        proc.emit("close", 1, null);
      });
      return proc;
    };

    const text = await runFlashAgentLoop([{ role: "user", content: "hi again" }], emit, session.id, null, {
      __spawn: spawnImpl as never,
    });

    assert.equal(attempts, 1, "a non-stale error must not trigger a fallback retry");
    // The suppressed terminal error is surfaced exactly once, now that we've
    // classified it as non-stale.
    assert.match(text, /ECONNRESET/);
    assert.equal(emit.tokens.filter((t) => t.includes("ECONNRESET")).length, 1, "the error is surfaced exactly once");
    // A non-stale failure leaves the stored id intact (nothing said it was bad).
    assert.equal(getFlashCliSessionId(session.id), "cli-session-ok");
  },
);

// ---------------------------------------------------------------------------
// guardFabricatedToolCalls — deterministic honesty gate (2026-07-12). A weak
// model under the "never dead-end" doctrine can fabricate tool-call syntax in
// its reply TEXT (live regression: fake `glob` calls + an invented file count
// spoken aloud). The guard replaces such replies with an honest refusal.

test("guardFabricatedToolCalls: clean replies pass through untouched", () => {
  const clean = "You have three meetings today. The first is at 9:30.";
  const r = guardFabricatedToolCalls(clean);
  assert.equal(r.fabricated, false);
  assert.equal(r.text, clean);
});

test("guardFabricatedToolCalls: <function_calls> markup is replaced with an honest reply", () => {
  const fake = 'Checking now.\n<function_calls>\n[{"tool_name": "glob", "arguments": {"pattern": "/Users/x/Downloads/*"}}]\n</function_calls>\nYou have 34 files.';
  const r = guardFabricatedToolCalls(fake);
  assert.equal(r.fabricated, true);
  assert.doesNotMatch(r.text, /34 files/);
  assert.doesNotMatch(r.text, /function_calls/);
  assert.match(r.text, /learn/i);
});

test("guardFabricatedToolCalls: bare tool_name JSON markup is also caught", () => {
  const fake = 'Let me check: [{"tool_name": "list_files", "arguments": {}}] — you have 12 items.';
  const r = guardFabricatedToolCalls(fake);
  assert.equal(r.fabricated, true);
  assert.doesNotMatch(r.text, /12 items/);
});

test("guardFabricatedToolCalls: mentioning a tool by name in prose is NOT fabrication", () => {
  const clean = "I used the calendar_today tool and found nothing on the calendar today.";
  const r = guardFabricatedToolCalls(clean);
  assert.equal(r.fabricated, false);
  assert.equal(r.text, clean);
});

// ------------------------------------------------------------------
// flashBudgetFor — per-surface model + budget
// ------------------------------------------------------------------

test("flashBudgetFor: spoken surfaces stay on the fast model with a tight clock", () => {
  for (const ch of ["voice", "watch", "glasses"]) {
    const b = flashBudgetFor(ch);
    assert.equal(b.model, "haiku", `${ch} must stay on the low-latency model`);
    assert.ok(b.maxWallMs <= 90_000, `${ch} must not make the operator wait minutes for a spoken reply`);
  }
});

test("flashBudgetFor: text surfaces get a model and a budget that can finish real work", () => {
  for (const ch of ["console", "imessage", undefined]) {
    const b = flashBudgetFor(ch);
    assert.equal(b.model, "sonnet", "typed chat is not latency-bound the way speech is");
    assert.ok(b.maxWallMs >= 10 * 60_000, "must outlast a research-and-write turn");
    assert.ok(b.maxToolCalls >= 30, "12 tool calls could not finish a multi-step request");
  }
});

test("flashBudgetFor: every surface keeps SOME wall clock — it is the only thing that kills a wedged child", () => {
  for (const ch of ["voice", "console", undefined, "unknown-surface"]) {
    const b = flashBudgetFor(ch);
    assert.ok(b.maxWallMs > 0 && Number.isFinite(b.maxWallMs), `${ch} must have a finite wall clock`);
    assert.ok(b.maxToolCalls > 0 && Number.isFinite(b.maxToolCalls), `${ch} must have a finite tool budget`);
  }
});

test("flashBudgetFor: the phone's TYPED chat gets the text budget, not the spoken one", () => {
  // Regression 2026-07-19: the iOS Chat tab declared channel "voice" for typed
  // turns, so the surface where the longest requests are actually made ran on
  // haiku with a 90s clock. Typed and spoken on the same device want opposite
  // things and must not share a channel name.
  const typed = flashBudgetFor("mobile");
  const spoken = flashBudgetFor("voice");
  assert.equal(typed.model, "sonnet");
  assert.ok(typed.maxWallMs > spoken.maxWallMs, "typed phone chat must outlast a spoken turn");
  assert.ok(typed.maxToolCalls > spoken.maxToolCalls);
});
