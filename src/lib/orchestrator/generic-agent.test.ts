import test from "node:test";
import assert from "node:assert/strict";

import type { ModelProvider } from "@/lib/config/providers";
import { renderAttachmentBlock } from "@/lib/tasks/attachments";
import {
  buildChatCompletionsUrls,
  buildGenericRequestBody,
  buildMessages,
  buildSmokeGateFinalResult,
  extractTextToolCalls,
  genericThinkingInstruction,
  modelToolResultContent,
  shouldRunCompletionSmokeGate,
} from "./generic-agent";

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
  // Local backends never receive provider-specific reasoning fields.
  assert.equal("reasoning_effort" in body, false);
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
  assert.ok(String(messages[1]?.content).includes(attachmentBlock));
  assert.match(String(messages[1]?.content), /path: \/Users\/me\/\.hivematrix\/uploads\/id-shot\.png/);
  assert.match(String(messages[1]?.content), /Use the absolute path above/);
});

test("generic/local developer prompt steers simple Python games away from brittle pygame loops", async () => {
  const messages = await buildMessages("Create a snake game in python", "/tmp", "developer", "low");
  const system = String(messages[0]?.content ?? "");

  assert.match(system, /Preserve correctness before speed/i);
  assert.match(system, /Python 3\.14/i);
  assert.match(system, /pygame/i);
  assert.match(system, /tkinter/i);
  assert.match(system, /do not create a venv/i);
  assert.match(system, /pivot/i);
  assert.match(system, /final verification command/i);
});

test("generic/local completion smoke gate still runs after loop-guarded text-only turns", () => {
  assert.equal(shouldRunCompletionSmokeGate(["snake_game.py"], true), true);
  assert.equal(shouldRunCompletionSmokeGate(["snake_game.py"], false), true);
  assert.equal(shouldRunCompletionSmokeGate([], true), false);
});

test("generic/local exhausted smoke failures return nonzero with the crash report", () => {
  const result = buildSmokeGateFinalResult("done", 2, "Traceback: boom", 2);

  assert.equal(result.code, 1);
  assert.match(result.result, /Code still fails to run after 2 fix attempts/);
  assert.match(result.result, /Traceback: boom/);
});

test("generic/local caps tool results before appending them to model messages", () => {
  const result = modelToolResultContent("x".repeat(20_000), 1_000);

  assert.ok(result.length < 1_300);
  assert.match(result, /truncated/i);
  assert.match(result, /ask for a narrower read/i);
});

test("generic/local extracts Qwen textual tool calls", () => {
  const parsed = extractTextToolCalls(`I'll inspect files now.

..TOOL{
  "name": "Bash",
  "args": {
    "command": "find . -maxdepth 2 -type f | head"
  }
}
`);

  assert.equal(parsed.content, "I'll inspect files now.");
  assert.deepEqual(parsed.toolCalls, [
    {
      name: "bash",
      arguments: JSON.stringify({ command: "find . -maxdepth 2 -type f | head" }),
    },
  ]);
});

test("generic/local extracts multiple textual tool calls and canonical names", () => {
  const parsed = extractTextToolCalls(`..TOOL{"name":"Read","args":{"path":"src/a.ts"}}
then edit
..TOOL{"name":"edit_file","args":{"path":"src/a.ts","old_string":"a","new_string":"b"}}`);

  assert.equal(parsed.content, "then edit");
  assert.deepEqual(parsed.toolCalls, [
    { name: "read_file", arguments: JSON.stringify({ path: "src/a.ts" }) },
    { name: "edit_file", arguments: JSON.stringify({ path: "src/a.ts", old_string: "a", new_string: "b" }) },
  ]);
});

test("generic/local extracts Qwen bracket find calls", () => {
  const parsed = extractTextToolCalls("Search next.\n\n[find] path: `~`, regex: `feedback|backlog`");

  assert.equal(parsed.content, "Search next.");
  assert.deepEqual(parsed.toolCalls, [
    { name: "search", arguments: JSON.stringify({ path: ".", pattern: "feedback|backlog" }) },
  ]);
});

test("generic/local extracts Qwen brain_search shorthand as repo search", () => {
  const parsed = extractTextToolCalls("Let me find it.\n\n[brain_search?q=path expansion brainpower link copy]");

  assert.equal(parsed.content, "Let me find it.");
  assert.deepEqual(parsed.toolCalls, [
    { name: "search", arguments: JSON.stringify({ path: ".", pattern: "path|expansion|brainpower|link|copy" }) },
  ]);
});

test("generic/local extracts Qwen brain_search label shorthand as repo search", () => {
  const parsed = extractTextToolCalls("Let me find it.\n\n[brain_search] q:Brainpower copy link path brain shortcut vscode");

  assert.equal(parsed.content, "Let me find it.");
  assert.deepEqual(parsed.toolCalls, [
    { name: "search", arguments: JSON.stringify({ path: ".", pattern: "Brainpower|copy|link|path|brain|shortcut|vscode" }) },
  ]);
});

test("generic/local extracts Qwen inline bash calls", () => {
  const parsed = extractTextToolCalls("Explore.\n[~{type:'bash', cmd:'ls src/lib && echo done', out:'true'}]");

  assert.equal(parsed.content, "Explore.");
  assert.deepEqual(parsed.toolCalls, [
    { name: "bash", arguments: JSON.stringify({ command: "ls src/lib && echo done" }) },
  ]);
});

test("generic/local extracts fenced shell blocks as bash calls", () => {
  const parsed = extractTextToolCalls(`I will create the file now.

\`\`\`bash
cat > src/lib/packs/example.ts <<'EOF'
export const ok = true;
EOF

npm test -- src/lib/packs/example.test.ts
\`\`\`

Then I will summarize.`);

  assert.equal(parsed.content, "I will create the file now.\n\nThen I will summarize.");
  assert.deepEqual(parsed.toolCalls, [
    {
      name: "bash",
      arguments: JSON.stringify({
        command: "cat > src/lib/packs/example.ts <<'EOF'\nexport const ok = true;\nEOF\n\nnpm test -- src/lib/packs/example.test.ts",
      }),
    },
  ]);
});

test("generic/local extracts fenced read file pseudo-command as read_file", () => {
  const parsed = extractTextToolCalls(`I'll inspect first.

\`\`\`bash
read file ~/hivematrix/src/daemon/server.ts
\`\`\`
`);

  assert.equal(parsed.content, "I'll inspect first.");
  assert.deepEqual(parsed.toolCalls, [
    { name: "read_file", arguments: JSON.stringify({ path: "~/hivematrix/src/daemon/server.ts" }) },
  ]);
});

test("generic/local extracts fenced python read_file calls", () => {
  const parsed = extractTextToolCalls(`Let me check.

\`\`\`python
read_file(path="/home/user/hivematrix/src/lib/packs/index.ts")
\`\`\`
`);

  assert.equal(parsed.content, "Let me check.");
  assert.deepEqual(parsed.toolCalls, [
    { name: "read_file", arguments: JSON.stringify({ path: "src/lib/packs/index.ts" }) },
  ]);
});
