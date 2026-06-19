# Role Model Overrides Design

## Context

HiveMatrix already exposes role-specific model routing for Mixed mode when the
frontier provider is Claude: Thinking, Coding, and Operational can be adjusted
from Settings. When the provider is Codex, the console hides Thinking and Coding
and treats both as a single provider-level choice. That prevents using
GPT-5.3-Codex-Spark for routine coding while reserving GPT-5.5 for harder work.
It also prevents local Qwen from being selected for Coding, and prevents
Spark/Sonnet from being selected for Operational escape hatches.

## Goal

Keep the Frontier provider selector as the default family hint, but make every
Mixed-mode role independently overrideable:

- Thinking: strongest frontier by default.
- Coding: default to the selected provider's normal coding model, but allow
  Opus, Sonnet, Spark, GPT-5.5, and local Qwen.
- Operational: default to local Qwen, but allow Qwen plus Spark and Sonnet.

## Approaches

1. Keep the current provider-gated UI and add separate Codex-specific provider
   options elsewhere.
   - Smaller visible change.
   - Keeps the confusing split where Codex hides role controls.

2. Add role option metadata in `src/lib/models/available.ts` and have the
   console render role selects from that shared matrix.
   - One source of truth for the UI and future validation.
   - Lets provider defaults and per-role overrides coexist cleanly.

3. Remove the Frontier provider selector and make roles the only control.
   - Maximum flexibility.
   - Loses a useful quick default-family control for users who want Claude vs
     Codex as the broad posture.

## Decision

Use approach 2. `frontierProvider` remains a broad default-family selector, but
Thinking, Coding, and Operational all remain visible. The role selects include
role-specific valid options built from configured backends:

- Thinking: Claude Opus/Sonnet and Codex GPT-5.5/Spark.
- Coding: Claude Opus/Sonnet, Codex GPT-5.5/Spark, and local Qwen.
- Operational: local Qwen, Codex Spark, and Claude Sonnet.

Defaults remain conservative:

- Claude provider: Thinking defaults to Opus, Coding defaults to Sonnet,
  Operational defaults to local Qwen.
- Codex provider: Thinking defaults to GPT-5.5, Coding defaults to Spark,
  Operational defaults to local Qwen.

## Verification

- Unit tests cover role option availability by backend.
- Resolver tests cover Codex provider defaults and role overrides.
- Console tests ensure Thinking and Coding are no longer hidden for Codex.
- Run:
  - `npm test -- src/lib/models/available.test.ts src/lib/routing/model-resolver.test.ts src/daemon/console.test.ts`
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
