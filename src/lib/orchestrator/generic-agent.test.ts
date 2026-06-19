import test from "node:test";
import assert from "node:assert/strict";

import type { ModelProvider } from "@/lib/config/providers";
import { renderAttachmentBlock } from "@/lib/tasks/attachments";
import { buildChatCompletionsUrls, buildGenericRequestBody, buildMessages, genericThinkingInstruction } from "./generic-agent";

test("generic/local request body uses provider max tokens and leaves cost uncapped", () => {
  const provider: ModelProvider = {
    name: "ollama",
    endpoint: "http://localhost:11434/v1",
    apiKey: "",
    supportsTools: true,
    maxTokens: 16384,
  };

  const body = buildGenericRequestBody(provider, "qwen-local", [
    { role: "system", content: "System prompt" },
    { role: "user", content: "Do the task" },
  ]);

  assert.equal(body.model, "qwen-local");
  assert.equal(body.max_tokens, 16384);
  assert.equal("maxBudgetUsd" in body, false);
});

test("generic/local max thinking is represented as a portable system instruction", () => {
  assert.match(genericThinkingInstruction("auto"), /maximum supported reasoning/i);
  assert.match(genericThinkingInstruction("max"), /maximum supported reasoning/i);
  assert.equal(genericThinkingInstruction("low"), "");
});

test("generic/local chat completions tries /v1 fallback for stale Ollama base endpoints", () => {
  const provider: ModelProvider = {
    name: "ollama",
    endpoint: "http://localhost:11434",
    apiKey: "",
    supportsTools: true,
    maxTokens: 4096,
  };

  assert.deepEqual(buildChatCompletionsUrls(provider), [
    "http://localhost:11434/chat/completions",
    "http://localhost:11434/v1/chat/completions",
  ]);
});

test("generic/local messages keep formatted attachment paths as user content", async () => {
  const attachmentBlock = renderAttachmentBlock([
    { filename: "shot.png", path: "/Users/me/.hivematrix/uploads/id-shot.png" },
  ]);
  const messages = await buildMessages(`Please inspect this image.\n\n${attachmentBlock}`, "/tmp", "developer", "low");

  assert.equal(messages[1]?.role, "user");
  assert.match(String(messages[1]?.content), /path: \/Users\/me\/\.hivematrix\/uploads\/id-shot\.png/);
  assert.match(String(messages[1]?.content), /Use the absolute path above/);
});
