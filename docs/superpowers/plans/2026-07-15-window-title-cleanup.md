# Window Title Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-15-window-title-cleanup-design.md`
(Option 3 — replace the redundant `<title>HiveMatrix</title>` with a minimal
non-redundant `<title>Console</title>`, no new state/concept.)

## Task 1 — failing test, then fix, then verify

- [ ] In `src/daemon/console.test.ts`, add a new test near the other
      `CONSOLE_HTML`-string-assertion tests (e.g. after the "no obvious TS-only
      syntax" test, ~line 66):

  ```ts
  test("window title does not redundantly repeat the in-page HiveMatrix logo", () => {
    assert.doesNotMatch(
      CONSOLE_HTML,
      /<title>HiveMatrix<\/title>/,
      "tab title should not literally duplicate the page header's HiveMatrix logo",
    );
    assert.match(CONSOLE_HTML, /<title>Console<\/title>/);
  });
  ```

- [ ] Run `npm test -- --test-name-pattern="window title"` (or the project's
      equivalent single-test filter). Confirm it **fails** against the current
      source — `console.ts:16` still has `<title>HiveMatrix</title>`, so the first
      assertion should fail. This is the RED step; do not proceed until you've
      actually seen it fail for the expected reason (not a typo/import error).

- [ ] In `src/daemon/console.ts`, change line 16 from:

  ```html
  <title>HiveMatrix</title>
  ```

  to:

  ```html
  <title>Console</title>
  ```

- [ ] Re-run the same test filter. Confirm it **passes** (GREEN). No refactor step
      needed — this is a one-line literal change with no logic to clean up.

## Verification gates (run after Task 1, before declaring done)

- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — full suite passes (not just the new test — confirm no regression)
- [ ] `node scripts/scope-wall.mjs` — zero violations (expected no-op: no new
      persistent store/concept introduced)

## Finishing

- [ ] `git status` / `git diff` — confirm only `src/daemon/console.ts` and
      `src/daemon/console.test.ts` changed, nothing stray.
- [ ] Commit to `main` with a descriptive message. **Do not push** (leave ahead of
      `origin/main` for the operator to push+release together, matching same-day
      precedent). **Do not run any release/build/notarize/publish skill or script** —
      release is operator-only.
