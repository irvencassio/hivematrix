# Truncated tool-call arguments — HiveMatrix local agent loop

Date: 2026-07-09
Status: Standalone implementation handoff spec
Repo: `/Users/irvcassio/hivematrix`
Scope: `src/lib/orchestrator/*`, `src/lib/config/qwen-profile.ts`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this spec task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Write the failing test first for every task that has one.

---

## The observed failure

A local Qwen task (`qwen3.6-27b-4bit`) tried to write an HTML file and produced this transcript:

```
write_file: {"path": "/Users/irvcassio/car-animation.html", "content": "<!DOCTYPE html>\n<html
lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\"
content=\"width=device-width, initial-scale=1
Error: Invalid JSON arguments: {"path": "/Users/irvcassio/car-animation.html", "content": "
<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\"
content=\"width=device-width, initial-scale=1
The content is too long for a single argument. Let me write it in sections using bash.
```

The model's `write_file` arguments were cut off mid-string. The truncated text reached `JSON.parse`, threw, and the agent was handed back a useless error. It then guessed at the cause and fell back to writing the file in pieces with `bash` heredocs — the least safe path available to it.

## Root cause — read this carefully

There are **two distinct paths** by which truncated arguments can reach `JSON.parse`, and this repo has bugs on both. Which one fired in the transcript above depends on whether the local server reports `finish_reason: "length"` or `finish_reason: "tool_calls"` when it stops mid-tool-call — **we have not confirmed which, and you do not need to.** Task 1 adds the logging that settles it; Tasks 2–6 make the system correct under either. Do not skip tasks on the theory that only one path is real.

Underneath both sits the reason the model ran out of room in the first place:

### D1 — `max_tokens` is set to the context window (the originating bug)

`src/lib/orchestrator/qwen-code.ts:33` and `:41` build the provider with:

```ts
maxTokens: modelCfg.contextLimit    // 262144 for primary, 65536 for secondary
```

and `src/lib/orchestrator/generic-agent.ts:474` sends it as:

```ts
max_tokens: provider.maxTokens,
```

In the OpenAI chat-completions API `max_tokens` is the cap on **tokens generated**, not the size of the context window. `contextLimit` is the window. Setting `max_tokens` equal to the whole window asks the server to leave zero room for the prompt. Servers respond to this incoherently — some 400, some silently clamp to `contextLimit - promptTokens`, some clamp to an internal default. Whatever the clamp is, it is not a number anyone in this codebase chose, and the model hits it mid-argument.

This is made worse by thinking mode. Qwen 3.6 emits reasoning through `reasoning_content` (see `openai-stream-adapter.ts:50`), and those tokens are drawn from the **same generation budget** as the tool-call arguments. A long think block followed by a large `write_file` is precisely the shape that runs out of budget partway through a JSON string.

Note that `src/lib/config/providers.ts` already uses `maxTokens` correctly — its `PROVIDER_DEFAULTS` values are `4096`, which are sane *output* caps. Only the Qwen path corrupts the field's meaning. **The fix is to stop assigning `contextLimit` to it**, not to rename the field.

### D2 — `finish_reason: "length"` is never handled

`src/lib/orchestrator/openai-stream-adapter.ts:85`:

```ts
if (finishReason === "tool_calls" || finishReason === "function_call") {
```

`"length"` — the value every OpenAI-compatible server returns when it stops at `max_tokens` — is not handled anywhere in the file, and `finish_reason` is never persisted onto `StreamState`. So a truncated turn is indistinguishable from a complete one downstream. Consequences:

- If the server reports `"length"`: no `tool_use` event is emitted, so `hasToolCalls` stays `false` in `generic-agent.ts:645`, and the partially-accumulated call is **silently dropped**. The agent believes the model produced a final answer.
- If the server reports `"tool_calls"` anyway: the truncated argument string flows straight into `executeTool` → `JSON.parse` → the error in the transcript.

### D3 — truncated native calls execute when a text tool call is also present

`src/lib/orchestrator/generic-agent.ts:685-688`:

```ts
const toolCalls = getCompletedToolCalls(state);
const effectiveToolCalls = toolCalls.length > 0 ? toolCalls : textTools.toolCalls;

if ((toolCalls.length > 0 && hasToolCalls) || textTools.toolCalls.length > 0) {
```

`effectiveToolCalls` prefers `toolCalls` whenever it is non-empty — but the branch can be entered on the strength of `textTools.toolCalls` alone, with `hasToolCalls === false`. When that happens:

1. Line 690's `if (toolCalls.length > 0 && hasToolCalls)` is **false**, so the assistant message is pushed as **plain text with no `tool_calls` field** (line 701).
2. `effectiveToolCalls` is nonetheless the **native, truncated** array.
3. Those get executed (line 735) — this is a second route to `Error: Invalid JSON arguments`.
4. Line 748's `if ("id" in tc)` is **true** for native calls, so `role: "tool"` messages are pushed carrying `tool_call_id`s that refer to an assistant message which has no `tool_calls`.

Step 4 leaves a malformed conversation. Strict servers reject the next request outright; lenient ones get quietly confused. This bug is independent of truncation — it just needs one native call plus one text-form call in the same turn — but truncation is how it surfaces.

### D4 — the error message teaches the model nothing

`src/lib/orchestrator/tool-bridge.ts:213`:

```ts
return `Error: Invalid JSON arguments: ${argsJson.slice(0, 200)}`;
```

It echoes the broken JSON back. Nothing says *truncated*, nothing says *why*, nothing says *what to do instead*. The transcript shows the model reverse-engineering "the content is too long for a single argument" from the shape of its own mangled input, and then choosing `bash`. A tool result is the only channel we have to steer a model mid-turn; this one wastes it.

### D5 — there is no chunked-write affordance

`executeWriteFile` (`tool-bridge.ts:378`) always calls `writeFileSync` — full overwrite, every time. A file too large for one argument therefore **cannot** be written across turns with `write_file`. `bash` heredocs are the only option left, which is exactly the fallback the transcript shows. Telling the model "write it in chunks" (D4) is empty advice until `write_file` can append.

---

## Non-goals

- No change to `extractTextToolCalls` / the `..TOOL` text-form protocol.
- No JSON "repair" heuristics. Do not try to close dangling strings or braces and execute the guess — a half-written file is worse than a clean retry.
- No change to `MAX_TURNS`, the loop-guard thresholds, or the smoke gate.
- No new config file. `maxOutputTokens` lands in the existing `~/.hivematrix/config.json` under `qwen.primary` / `qwen.secondary`.

## Ground truth

- Tests are `node:test` + `node:assert/strict`, colocated as `*.test.ts`. Run with `npm test`. Also run `npm run typecheck` and `npm run lint`.
- `StreamState` in `openai-stream-adapter.ts` is a non-exported interface; it is constructed only by `createStreamState()` and read only through the exported `getUsage` / `getCompletedToolCalls` accessors. Follow that pattern — add an accessor, do not export the interface.
- `qwen-code.test.ts:45`, `:53`, and `:60` currently assert `provider.maxTokens` equals `65536` / `32768` / `65536` — i.e. they assert the bug. **You are expected to change these assertions.** They are not a contract to preserve.
- `generic-agent.test.ts:32` asserts `body.max_tokens === 16384` from a provider literal with `maxTokens: 16384`. That test is correct as written and must keep passing untouched.

---

## Tasks

### Task 1 — persist `finish_reason` on the stream state

- [ ] Write a failing test in `src/lib/orchestrator/openai-stream-adapter.test.ts` (create the file if absent): feed `parseOpenAIChunk` a chunk with `choices[0].finish_reason === "length"`, assert `getFinishReason(state) === "length"`.
- [ ] Add `finishReason: string | null` to the `StreamState` interface; initialise to `null` in `createStreamState()`.
- [ ] In `parseOpenAIChunk`, after reading `finishReason`, store it: `if (finishReason) state.finishReason = finishReason;`
- [ ] Export `getFinishReason(state: StreamState): string | null`.
- [ ] Still emit `tool_use` events on `"length"` **when `state.toolCalls.size > 0`**, so that `hasToolCalls` becomes `true` and the native branch in `generic-agent.ts` is taken. Change the guard to:

```ts
const isToolFinish = finishReason === "tool_calls" || finishReason === "function_call";
const isTruncatedMidTool = finishReason === "length" && state.toolCalls.size > 0;
if (isToolFinish || isTruncatedMidTool) {
```

  This is deliberate: we want the truncated call to reach `generic-agent`, which will pair it with a tool result rather than execute it (Task 3). Taking the native branch is what keeps `assistant.tool_calls` and `role:"tool"` messages balanced.

- [ ] Test that `"length"` with **zero** accumulated tool calls emits no `tool_use` (a plain text response that ran long must not be mistaken for a tool call).

### Task 2 — stop sending the context window as `max_tokens`

- [ ] Add `maxOutputTokens: number` to `QwenModelConfig` in `src/lib/config/qwen-profile.ts`.
- [ ] Add `const DEFAULT_MAX_OUTPUT_TOKENS = 16384;` — chosen to leave headroom for a `reasoning_content` block plus a substantial file body. Do not raise it above the context limit.
- [ ] In `parseModelConfig`, parse it defensively, matching the existing `contextLimit` style, and clamp so it can never exceed the window:

```ts
const contextLimit = typeof r.contextLimit === "number" && r.contextLimit > 0
  ? r.contextLimit
  : DEFAULT_CONTEXT_LIMIT;
const requestedOut = typeof r.maxOutputTokens === "number" && r.maxOutputTokens > 0
  ? r.maxOutputTokens
  : DEFAULT_MAX_OUTPUT_TOKENS;
return { ..., contextLimit, maxOutputTokens: Math.min(requestedOut, contextLimit) };
```

- [ ] Add `maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS` to `DEFAULT_PRIMARY`.
- [ ] In `src/lib/orchestrator/qwen-code.ts`, both at line 33 and line 41, replace `maxTokens: modelCfg.contextLimit` with `maxTokens: modelCfg.maxOutputTokens`.
- [ ] Update `qwen-code.test.ts` — add `maxOutputTokens` to the two fixtures in `sampleProfile` and change the three assertions to expect the output cap, not the context limit.
- [ ] Add a `qwen-profile.test.ts` case asserting `maxOutputTokens` is clamped to `contextLimit` when config asks for more.
- [ ] Leave `src/lib/config/providers.ts` alone. Its `maxTokens: 4096` defaults are already output caps.

### Task 3 — never execute a truncated tool call

- [ ] In `generic-agent.ts`, after `const state = createStreamState()` completes streaming, read `const finishReason = getFinishReason(state);` and `const truncated = finishReason === "length";`
- [ ] When `truncated && toolCalls.length > 0`: push the assistant message with its `tool_calls` **exactly as today** (so the conversation stays well-formed), then, **instead of calling `executeTool`**, push one `role: "tool"` result per call with this content:

```
Error: your tool call was cut off before it finished — the arguments are incomplete and were NOT executed. No file was written and nothing changed on disk.

You ran out of output tokens for this turn (max_tokens=<N>). Reasoning tokens count against the same budget.

Recovery: split the work across turns. Call write_file with mode="overwrite" for the first chunk, then call write_file with mode="append" for each following chunk. Keep each chunk under ~2000 tokens. Do NOT use bash heredocs to write files.
```

  Substitute the real `provider.maxTokens` for `<N>`.

- [ ] `continue` to the next turn afterwards. Do not run the loop guard, the read cache, or the smoke gate for a truncated turn.
- [ ] Do **not** count truncated calls toward `toolCallCounts`. A model retrying a chunked write must not trip the loop guard.
- [ ] Emit an `onEvent(taskId, { type: "error", content: ... })` naming the truncation and the token cap, so this is visible in the transcript instead of appearing as a mysterious `Invalid JSON arguments`.
- [ ] Test: drive `runAgentLoop`'s tool-dispatch path (or extract a pure helper and test that) with a `"length"` finish reason and assert `executeTool` is never invoked and a `role:"tool"` message is present for every `tool_calls[].id`.

### Task 4 — fix the native/text tool-call desync (D3)

- [ ] In `generic-agent.ts`, replace lines 685-688 with a single source of truth:

```ts
const toolCalls = getCompletedToolCalls(state);
const useNativeToolCalls = hasToolCalls && toolCalls.length > 0;
const effectiveToolCalls = useNativeToolCalls ? toolCalls : textTools.toolCalls;

if (effectiveToolCalls.length > 0) {
```

- [ ] Use `useNativeToolCalls` — not `toolCalls.length > 0 && hasToolCalls` recomputed — as the condition on line 690 that decides whether the assistant message carries `tool_calls`.
- [ ] This guarantees the invariant: **`role:"tool"` messages are pushed if and only if the preceding assistant message carried `tool_calls`.** State that invariant in a comment above the block.
- [ ] Test: a turn where `hasToolCalls === false`, `toolCalls` is non-empty (accumulated but never finished), and `textTools.toolCalls` has one entry. Assert the text-form call is the one executed and that no orphan `tool_call_id` is pushed.

### Task 5 — give `write_file` an append mode (D5)

- [ ] In `tool-bridge.ts`, add to the `write_file` tool definition a `mode` property: `{ type: "string", enum: ["overwrite", "append"], description: "overwrite (default) replaces the file; append adds to the end. Write large files as one overwrite chunk followed by append chunks." }`. Keep `required: ["path", "content"]`.
- [ ] Extend the tool's `description` to state the chunking strategy explicitly, so the model learns it before it fails rather than after.
- [ ] In `executeWriteFile`, import `appendFileSync` and branch on `args.mode === "append"`. Preserve the existing `mkdirSync` recursive-parent behaviour for both modes, and `context?.touchedFiles?.add(filePath)` for both.
- [ ] Return a distinguishable result: `` `File appended: ${rel} (+${content.length} bytes)` `` vs. the existing `File written:` string.
- [ ] Reject `mode: "append"` on a nonexistent file? **No** — appending to a missing file should create it, matching shell `>>`. Add a test asserting that.
- [ ] Tests: overwrite-then-append produces the concatenation; append to a missing file creates it; an unrecognised `mode` value falls back to overwrite rather than erroring.

### Task 6 — make the parse error diagnostic (D4)

- [ ] In `executeTool` (`tool-bridge.ts:210-214`), keep `JSON.parse` in a `try`, but on failure classify before returning. Truncation has a specific signature — an unterminated string or unbalanced braces at end-of-input:

```ts
} catch {
  const looksTruncated = argsJson.length > 0 && !argsJson.trimEnd().endsWith("}");
  if (looksTruncated) {
    return `Error: tool arguments were cut off mid-JSON and were NOT executed (received ${argsJson.length} chars). Nothing changed on disk. If you are writing a large file, split it: write_file with mode="overwrite" for the first chunk, then mode="append" for each subsequent chunk.`;
  }
  return `Error: Invalid JSON arguments (${argsJson.length} chars): ${argsJson.slice(0, 200)}`;
}
```

- [ ] This is defense-in-depth. After Task 3 the truncated path should not reach `executeTool` at all — but `executeTool` is exported and called from elsewhere, so it must fail informatively on its own.
- [ ] Include the argument length in **both** messages. Its absence is why the original transcript gave no clue that the 200-char echo was a `slice`, not the whole payload.
- [ ] Tests: a truncated `write_file` payload returns the truncation message and does **not** create a file; genuinely malformed-but-complete JSON (e.g. `{"path": }`) returns the invalid-arguments message.

---

## Verification

- [ ] `npm test` — all green, including the three amended `qwen-code.test.ts` assertions.
- [ ] `npm run typecheck` and `npm run lint` clean.
- [ ] Confirm the originating bug is gone: log the outgoing request body for a Qwen task and assert `max_tokens` is `16384` (or the configured value), **not** `65536` / `262144`.
- [ ] End-to-end, with the local Qwen server running: dispatch the task from the transcript — *"write a car animation as a single HTML file"* — and confirm the agent either completes it in one `write_file` or chunks it with `mode="append"`. **It must not shell out to `bash` heredocs.** That fallback is the tell that the model is still flying blind.

## Out of scope but worth filing

`openai-stream-adapter.ts:90` truncates the `tool_use` **display** event to 500 chars (`tc.arguments.slice(0, 500)`). That is presentation-only and correct, but it means a truncated call and a merely-long call look identical in the transcript. Once `finish_reason` is on the state (Task 1), consider tagging the event so the console can render "⚠ truncated" — a separate change to `StreamEvent` and `src/daemon/console.ts`.
