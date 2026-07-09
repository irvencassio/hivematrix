# Local Agent Context Hygiene Design

> ⚠️ **SUPERSEDED 2026-07-06 — DeepSeek/ds4 removed; the local stack is Qwen-only.**
> Retained as a historical record. See
> docs/superpowers/plans/2026-07-06-qwen-only-local-presets.md


## Problem

The failed Settings Observability task did not fail because the requested code
change was hard. It failed after the local DeepSeek/DwarfStar executor exceeded
the model context:

```text
Prompt has 102522 tokens, but the configured context size is 100000 tokens
```

The transcript shows three context-bloat sources:

1. `read_file` was allowed to read a PNG attachment as UTF-8, pushing binary
   noise into the conversation.
2. Broad `find` / `grep` commands wandered through generated directories,
   `.claude` worktrees, `dist`, and dependencies.
3. Tool results are logged to the UI as 500-character snippets, but the full
   50-100KB tool result is still appended to the model conversation.

The local agent eventually found `src/daemon/console.ts`, but it had already
burned most of its context and failed before editing.

## Goal

Make ordinary UI/code cleanup tasks finish reliably on local models by keeping
tool context small, relevant, and text-safe.

## Approaches

### Approach A — Tool Hygiene Guardrails

Update the generic local tool bridge so tools return compact, safe output:

- `read_file` refuses binary files and image uploads with an actionable message:
  use visual inspection or OCR/image tooling instead of dumping bytes.
- Default `read_file` output is capped to a smaller line window unless the model
  asks for a bounded `offset` + `limit`.
- `search` prefers `rg` with default excludes for `.git`, `.claude`, `dist`,
  `node_modules`, build outputs, virtualenvs, and cache folders.
- `list_files` applies the same excludes and returns a bounded count plus a
  hint when results are truncated.
- The message appended back to the model is capped at the same small size the UI
  logs, or includes a "truncated, ask narrower" marker.

Pros: directly fixes the failure mode and helps every local task.
Cons: the local model sometimes needs to make a second, narrower tool call.

### Approach B — Context-Budget Compaction

Before each local-model call, estimate conversation size and compact older tool
results into summaries when it approaches a threshold.

Pros: robust against many kinds of bloat.
Cons: more complex, and summarizing tool results can hide exact code snippets the
model still needs.

### Approach C — Route UI Code Changes To Frontier/Codex

Change routing so HiveMatrix console/UI edits default to a frontier Codex/Claude
executor rather than DeepSeek/DwarfStar.

Pros: higher success rate for broad code navigation.
Cons: does not fix local agent hygiene, and local-only mode would still fail.

## Recommendation

Implement Approach A first, with a small fallback from Approach B: if a tool
result is longer than the model-safe cap, append only the capped result plus a
clear truncation note to the model conversation. Keep Approach C as a routing
policy improvement later, not the root fix.

## Acceptance Criteria

- A local agent reading a PNG upload does not inject raw binary bytes into
  conversation history.
- Broad searches and file listings skip generated/dependency/worktree folders by
  default.
- Tool results appended to `messages` are capped and carry truncation notices.
- Tests cover binary read refusal, default excludes, and model-message truncation.
- The previous Settings Observability task class can find `src/daemon/console.ts`
  through bounded search without context overflow.

## Verification

- Focused tests:
  - `src/lib/orchestrator/tool-bridge.test.ts`
  - `src/lib/orchestrator/generic-agent.test.ts`
- Standard gates:
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
  - `npx tsx scripts/qwen-readiness.mts`
