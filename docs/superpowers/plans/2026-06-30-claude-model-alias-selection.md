# Claude Model Alias Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-30-claude-model-alias-selection-design.md`

Goal: selecting a Claude model uses the CLI **alias** (`opus`/`sonnet`/`haiku`)
so it always resolves to the latest model (Sonnet 5, etc.), and display labels
drop version numbers. Never goes stale again.

TDD throughout: change/add the assertion first (RED), then the source (GREEN).

## Task 1 — Shared Claude family short-name helper (catalog.ts)
- [ ] `task-display.test.ts`: add cases — `getTaskModelShortName("claude-sonnet-5-0","")` → "Sonnet"; `getTaskModelShortName("sonnet","")` → "Sonnet"; `getTaskModelShortName("opus","")` → "Opus". (existing `claude-sonnet-4-6`→"Sonnet" stays.)
- [ ] `catalog.ts`: add `export function claudeShortName(modelId: string): "Opus"|"Sonnet"|"Haiku"|null` — matches `opus`/`claude-opus*`, `sonnet`/`claude-sonnet*`, `haiku`/`claude-haiku*` (case-insensitive), else null.
- [ ] `task-display.ts:16`: check `claudeShortName(modelId)` before `MODEL_SHORT_NAMES[modelId]`.
- [ ] `frontier-usage.ts:99`: label = `claudeShortName(primary) ?? MODEL_SHORT_NAMES[primary] ?? primary`.

## Task 2 — Alias modelIds + dropped version labels
- [ ] `available.test.ts`: role-options `coding` → `["opus","sonnet","codex:gpt-5.5","codex:gpt-5.3-codex-spark","qwen/qwen3.6-27b"]`; `operational` → `["qwen/qwen3.6-27b","codex:gpt-5.3-codex-spark","sonnet"]`.
- [ ] `available.ts:14-15`: `CLAUDE_OPUS_ID = "opus"`, `CLAUDE_SONNET_ID = "sonnet"` (update comments).
- [ ] `available.ts:62-63`: names → `"Claude Opus"` / `"Claude Sonnet"` (drop version + parenthetical).
- [ ] `available.ts:283-284`: role labels → `"Claude Opus"` / `"Claude Sonnet"`.
- [ ] `catalog.ts:25-27`: `MODEL_OPTIONS` opus/sonnet/haiku `modelId` → `"opus"`/`"sonnet"`/`"haiku"`.

## Task 3 — Frontier-detection regexes learn the aliases
- [ ] `frontier-usage.test.ts`: add `isFrontierModel("sonnet")` / `isFrontierModel("opus")` → true. Defaults at :64-65 → `"opus"`/`"sonnet"`.
- [ ] `writer-role.test.ts`: add `isFrontierModelId("sonnet")`/`("opus")` → true; add `resolveWriterModel({canUseCloud:true, writerModel:"sonnet"})` → provider `"anthropic"` (guards the silent local-misclassification bug).
- [ ] `model-resolver.test.ts`: defaults at :20/:27/:47 → `"opus"`/`"sonnet"`/`"sonnet"`.
- [ ] `frontier-usage.ts:44`: `/^(claude|gpt|o[0-9]|codex|opus$|sonnet$|haiku$)/i`.
- [ ] `writer-role.ts:26`: `/^(claude-|codex:|gpt-|o[0-9]|opus$|sonnet$|haiku$)/i`.
- [ ] `model-resolver.ts:35`: `/^(claude-|codex:|gpt-|o[0-9]|opus$|sonnet$|haiku$)/i`.

## Task 4 — Effort gate accepts aliases (subprocess.ts)
- [ ] `subprocess.ts:328`: gate becomes `(!input.model || claudeShortName(input.model) !== null)` (import `claudeShortName` from catalog) so Claude alias tasks still get `--effort`.

## Task 5 — Internal intent-classifier uses aliases
- [ ] `intent-classifier.ts:93`: `--model claude-haiku-4-5-20251001` → `--model haiku`.
- [ ] `intent-classifier.ts:107`: `--model claude-sonnet-4-6` → `--model sonnet`.

## Task 6 — Docs
- [ ] `docs/MODEL-ROUTING.md:29-30,106-107`: reference aliases (`opus`/`sonnet`) for the Claude defaults; note full names still accepted.

## Verification gates
- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — all passing
- [ ] `node scripts/scope-wall.mjs` — zero violations
