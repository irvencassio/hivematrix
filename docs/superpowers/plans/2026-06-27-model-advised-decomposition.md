# Model-Advised Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-27-model-advised-decomposition-design.md`.
TDD throughout. Gates: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

---

## Task 1 — Shared chat client (RED → GREEN)

- [ ] `src/lib/models/chat-client.test.ts`: localChatComplete parses choices
      content via injected fetch; anthropicChatComplete parses content[0].text;
      non-200 throws; 404 falls through to the next candidate URL.
- [ ] Run, watch fail.
- [ ] `src/lib/models/chat-client.ts`: types + localChatComplete +
      anthropicChatComplete + resolveScoutClient + resolvePlannerClient.
- [ ] Watch pass.

## Task 2 — Decomposer (RED → GREEN)

- [ ] `src/lib/intake/decompose.test.ts`: scout-only fragments; planner refines;
      offline → null; both null → null; malformed JSON → null; `<2` → null;
      `<think>` stripped; cap at MAX_STEPS.
- [ ] Run, watch fail.
- [ ] `src/lib/intake/decompose.ts`: `decompose` + `parseSteps` + prompts.
- [ ] Watch pass.

## Task 3 — classify async + policy helper (RED → GREEN)

- [ ] Add tests to `src/lib/intake/classify.test.ts`: `proposedItemsFromFragments`
      stamps release→hold/high; `classifyIntakeAsync` with injected fake replaces
      items + adds reason; release fragment still held; `<2` → fallback;
      non-broad → model never called.
- [ ] Run, watch fail.
- [ ] Refactor inline item mapping into exported `proposedItemsFromFragments`;
      add `classifyIntakeAsync` + `_setIntakeDecomposeDepsForTests`.
- [ ] Watch pass; existing classify.test.ts still green.

## Task 4 — Feature flag (RED → GREEN)

- [ ] Add a test (features.test.ts or extend) for the new flag key.
- [ ] Add `taskIntakeModelDecomposition` to `KNOWN_FEATURES`.
- [ ] Watch pass.

## Task 5 — Server wiring (RED → GREEN)

- [ ] server.test.ts: with `_setIntakeDecomposeDepsForTests`, POST /tasks broad
      prompt → package items from the fake model; cleared → deterministic
      baseline (no network).
- [ ] Run, watch fail.
- [ ] Swap `classifyIntake` → `classifyIntakeAsync` in POST /tasks +
      intake/preview routes.
- [ ] Watch pass; existing intake/preview + broad-prompt tests still green.

## Task 6 — Gates + finish

- [ ] typecheck, npm test, scope-wall — all clean.
- [ ] COMPONENT-MAP note (model-advised decomposition + chat client).
- [ ] Commit + push to main. Report hash, files, gates, next slice. No release.
