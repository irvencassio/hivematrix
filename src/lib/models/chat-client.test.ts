import test from "node:test";
import assert from "node:assert/strict";
import { haikuChatComplete, opusChatComplete, buildHaikuCliArgs, _setExecFileForTests } from "./chat-client";

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
