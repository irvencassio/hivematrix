import test from "node:test";
import assert from "node:assert/strict";
import { localChatComplete, haikuChatComplete, opusChatComplete, buildHaikuCliArgs, _setExecFileForTests } from "./chat-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("localChatComplete posts to the endpoint and returns the assistant content", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    return jsonResponse(200, { choices: [{ message: { role: "assistant", content: "hello from qwen" } }] });
  }) as unknown as typeof fetch;

  const out = await localChatComplete(
    [{ role: "user", content: "hi" }],
    { endpoint: "http://localhost:8080", model: "Qwen-Test", fetchImpl },
  );
  assert.equal(out, "hello from qwen");
  assert.match(calls[0], /\/chat\/completions$/);
});

test("localChatComplete falls through to /v1/chat/completions on a 404", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/v1/")) return jsonResponse(200, { choices: [{ message: { content: "second try" } }] });
    return jsonResponse(404, { error: "not found" });
  }) as unknown as typeof fetch;

  const out = await localChatComplete([{ role: "user", content: "hi" }], { endpoint: "http://localhost:8080", model: "m", fetchImpl });
  assert.equal(out, "second try");
  assert.equal(calls.length, 2);
  assert.match(calls[1], /\/v1\/chat\/completions$/);
});

test("localChatComplete keeps the payload OpenAI-compatible when reasoningEffort is 'off'", async () => {
  let sentBody: Record<string, unknown> = {};
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body ?? "{}"));
    return jsonResponse(200, { choices: [{ message: { content: "ok" } }] });
  }) as unknown as typeof fetch;

  await localChatComplete(
    [{ role: "user", content: "hi" }],
    { endpoint: "http://localhost:8080/v1", model: "m", reasoningEffort: "off", fetchImpl },
  );
  assert.equal("thinking" in sentBody, false);
  assert.equal("think" in sentBody, false);
  assert.equal("reasoning_effort" in sentBody, false);
});

test("localChatComplete keeps the payload OpenAI-compatible for a normal thinking tier", async () => {
  let sentBody: Record<string, unknown> = {};
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body ?? "{}"));
    return jsonResponse(200, { choices: [{ message: { content: "ok" } }] });
  }) as unknown as typeof fetch;

  await localChatComplete(
    [{ role: "user", content: "hi" }],
    { endpoint: "http://localhost:8080/v1", model: "m", reasoningEffort: "low", fetchImpl },
  );
  assert.equal("reasoning_effort" in sentBody, false);
  assert.equal("thinking" in sentBody, false);
});

test("localChatComplete throws on a non-2xx that has no fallback", async () => {
  const fetchImpl = (async () => jsonResponse(500, { error: "boom" })) as unknown as typeof fetch;
  await assert.rejects(
    () => localChatComplete([{ role: "user", content: "x" }], { endpoint: "http://localhost:8080/v1", model: "m", fetchImpl }),
    /50|failed|local/i,
  );
});

// ---------------------------------------------------------------------------
// haikuChatComplete — subscription-OAuth Claude CLI backend
// ---------------------------------------------------------------------------

test.afterEach(() => { _setExecFileForTests(null); });

test("buildHaikuCliArgs defaults to the haiku model and joins non-system turns into the prompt", () => {
  const { args, model } = buildHaikuCliArgs([
    { role: "user", content: "hi there" },
    { role: "assistant", content: "hello" },
  ]);
  assert.equal(model, "haiku");
  assert.deepEqual(args, ["-p", "user: hi there\n\nassistant: hello", "--model", "haiku", "--max-turns", "1", "--output-format", "text"]);
});

test("buildHaikuCliArgs separates system messages into --append-system-prompt", () => {
  const { args } = buildHaikuCliArgs([
    { role: "system", content: "You are terse." },
    { role: "user", content: "hi" },
  ]);
  assert.deepEqual(args, [
    "-p", "user: hi",
    "--model", "haiku",
    "--max-turns", "1",
    "--output-format", "text",
    "--append-system-prompt", "You are terse.",
  ]);
});

test("buildHaikuCliArgs passes through a valid explicit model (opus/sonnet), ignoring an invalid one", () => {
  assert.equal(buildHaikuCliArgs([{ role: "user", content: "x" }], { model: "opus" }).model, "opus");
  assert.equal(buildHaikuCliArgs([{ role: "user", content: "x" }], { model: "sonnet" }).model, "sonnet");
  assert.equal(buildHaikuCliArgs([{ role: "user", content: "x" }], { model: "qwen3.6-35b-4bit" }).model, "haiku");
});

test("haikuChatComplete invokes execFile with an argv array (never a shell string) and returns trimmed stdout", async () => {
  const calls: Array<{ file: string; args: string[]; options: unknown }> = [];
  _setExecFileForTests((async (file: string, args: string[], options: unknown) => {
    calls.push({ file, args, options });
    return { stdout: "  hello from haiku  \n", stderr: "" };
  }) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  const out = await haikuChatComplete([{ role: "user", content: "say hi" }]);
  assert.equal(out, "hello from haiku");
  assert.equal(calls.length, 1);
  assert.ok(Array.isArray(calls[0].args), "args must be an argv array, not an interpolated shell string");
  assert.ok(calls[0].args.includes("--model"));
  assert.ok(calls[0].args.includes("haiku"));
  assert.ok(calls[0].args.includes("user: say hi"), "prompt is passed as its own argv element, not shell-interpolated");
});

test("haikuChatComplete rejects when execFile rejects (non-zero exit)", async () => {
  _setExecFileForTests((async () => {
    throw new Error("Command failed with exit code 1");
  }) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  await assert.rejects(
    () => haikuChatComplete([{ role: "user", content: "x" }]),
    /claude CLI completion failed/,
  );
});

test("haikuChatComplete rejects on empty stdout", async () => {
  _setExecFileForTests((async () => ({ stdout: "   \n", stderr: "" })) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  await assert.rejects(
    () => haikuChatComplete([{ role: "user", content: "x" }]),
    /no output/,
  );
});

test("haikuChatComplete ignores maxTokens/temperature (accepted for interface compatibility, no CLI flag)", async () => {
  let capturedArgs: string[] = [];
  _setExecFileForTests((async (_file: string, args: string[]) => {
    capturedArgs = args;
    return { stdout: "ok", stderr: "" };
  }) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  await haikuChatComplete([{ role: "user", content: "x" }], { maxTokens: 999, temperature: 0.9 });
  assert.ok(!capturedArgs.some((a) => /max.?token|temperature/i.test(a)));
});

test("haikuChatComplete respects a custom timeoutMs, defaulting to 60s", async () => {
  const timeouts: Array<number | undefined> = [];
  _setExecFileForTests((async (_file: string, _args: string[], options: { timeout?: number }) => {
    timeouts.push(options.timeout);
    return { stdout: "ok", stderr: "" };
  }) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  await haikuChatComplete([{ role: "user", content: "x" }]);
  await haikuChatComplete([{ role: "user", content: "x" }], { timeoutMs: 5000 });
  assert.equal(timeouts[0], 60_000);
  assert.equal(timeouts[1], 5000);
});

test("opusChatComplete defaults the model to opus but lets an explicit opts.model win", async () => {
  const models: string[] = [];
  _setExecFileForTests((async (_file: string, args: string[]) => {
    const idx = args.indexOf("--model");
    models.push(args[idx + 1]);
    return { stdout: "ok", stderr: "" };
  }) as unknown as Parameters<typeof _setExecFileForTests>[0]);

  await opusChatComplete([{ role: "user", content: "x" }]);
  await opusChatComplete([{ role: "user", content: "x" }], { model: "sonnet" });
  assert.deepEqual(models, ["opus", "sonnet"]);
});
