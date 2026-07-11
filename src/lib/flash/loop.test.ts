import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildFlashPrompt,
  buildFlashSpawnArgs,
  consumeFlashStreamLine,
  createFlashStreamState,
  runFlashAgentLoop,
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
// buildFlashSpawnArgs — pure argv construction
// ------------------------------------------------------------------

test("buildFlashSpawnArgs: wires model, budgets, mcp config, and allowed tools", () => {
  const args = buildFlashSpawnArgs({
    systemPrompts: ["sys1", "sys2"],
    mcpConfigPath: "/p/flash-mcp-config.json",
    toolNames: ["mcp__flash__brain_search", "mcp__flash__mail_send"],
    maxTurns: 12,
  });

  // The prompt is NOT in argv — it goes via stdin (a prompt starting with "--" would
  // otherwise be parsed as an unknown CLI option). `-p` stays as the print flag.
  assert.equal(args[0], "-p");
  assert.ok(!args.includes("hello"));
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

test("buildFlashSpawnArgs: a resumeSessionId adds --resume <id>; omitting it adds nothing", () => {
  const withResume = buildFlashSpawnArgs({
    systemPrompts: [],
    mcpConfigPath: "/p/flash-mcp-config.json",
    toolNames: ["mcp__flash__brain_search"],
    maxTurns: 12,
    resumeSessionId: "cli-session-abc",
  });
  assert.equal(withResume[withResume.indexOf("--resume") + 1], "cli-session-abc");

  const withoutResume = buildFlashSpawnArgs({
    systemPrompts: [],
    mcpConfigPath: "/p/flash-mcp-config.json",
    toolNames: ["mcp__flash__brain_search"],
    maxTurns: 12,
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
