# Browser Lane Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Work through the remaining Browser Lane review items that are correctness or safety issues:

- Add working `/lanes` daemon API aliases for iOS and future clients.
- Rename desktop console user-facing status from Bees to Lanes.
- Prevent Browser Lane Keychain writes from exposing secrets on command argv.
- Stop treating BrowserBee/WebBee browser aliases as active callable tools.
- Preserve URL + question in Browser Lane read mode.
- Make readiness selector/visual assertions honest.

## Constraints

- TDD first for each production change.
- Keep `/bees` compatibility endpoints unless removing them is proven safe.
- Do not expose password, cookie, token, or TOTP values to logs, args, traces, or diagnostics.
- Do not rename unrelated Bee architecture in this slice.
- Defer native app packaging and real visual perception to follow-up slices.

## Task 1: Lanes API Compatibility

- [x] Add failing daemon contract tests proving `/lanes` and `/lanes/:kind/autostart` are expected first-party routes.
- [x] Factor lane status shaping so `/lanes` returns `{ lanes: [...] }`.
- [x] Keep `/bees` returning `{ bees: [...] }` as a compatibility alias.
- [x] Update desktop console Settings code to call `/lanes` and use Lane wording.
- [x] Verify iOS already points to `/lanes`.

## Task 2: Keychain Secret Boundary

- [x] Add a failing Keychain test proving saved passwords are not present in runner args.
- [x] Extend the runner contract to accept optional stdin input.
- [x] Write secrets through stdin instead of argv.
- [x] Keep read behavior and redacted diagnostics stable.

## Task 3: Browser Alias Quarantine

- [x] Update orchestrator tests so `webbee_search` and `browserbee_run` are no longer recognized as active tools.
- [x] Remove old aliases from active tool capability mapping and execution dispatch.
- [x] Keep `hivematrix_browser` as the only browser model-facing tool.
- [x] Keep compatibility metadata only where required for persisted status/config.

## Task 4: CLI Read Semantics

- [x] Add a failing test for `hive browser read https://example.com "what changed"` proving the read request contains both URL and question.
- [x] Fix Browser Lane execution so the read backend receives URL context and question together.

## Task 5: Readiness Assertion Honesty

- [x] Add failing tests for selector assertions using structured snapshot actions/forms.
- [x] Add failing test that visual assertions fail closed until a visual backend exists.
- [x] Implement selector matching over structured refs/kinds/text/labels.
- [x] Treat visual assertions as unsupported probe failures, not text matches.

## Task 6: Verification

- [ ] Run focused tests for changed modules.
- [ ] Run `npm run typecheck -- --pretty false`.
- [ ] Run `npm test`.
- [ ] Run `node scripts/scope-wall.mjs`.
- [ ] Commit and push `main`.
