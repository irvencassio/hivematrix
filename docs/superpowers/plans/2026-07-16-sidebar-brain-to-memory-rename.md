# Sidebar "Brain" → "Memory" Label Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-16-sidebar-brain-to-memory-rename-design.md`
(Option 1 — text-only swap, `🧠 Brain` → `🧠 Memory`, no identifier/endpoint renames.)

## Task 1 — failing test, then fix, then verify

- [ ] In `src/daemon/console.test.ts`, add a new test near the other nav-related tests
      (e.g. immediately before the existing "Brain / Memory Review nav opens a
      three-pane read-only screen…" test at line 982):

  ```ts
  test("sidebar nav button for the Brain/Memory panel is labeled Memory, not Brain", () => {
    assert.match(
      CONSOLE_HTML,
      /id="brainNav"[^>]*onclick="showBrain\(\)">🧠 Memory<\/button>/,
      "sidebar nav button text should read 'Memory', not 'Brain'",
    );
  });
  ```

- [ ] Run `npm test -- --test-name-pattern="labeled Memory"` (or the project's
      equivalent single-test filter). Confirm it **fails** against the current source —
      `console.ts:1812` still renders `🧠 Brain`, so the assertion should fail. This is
      the RED step; do not proceed until you've actually seen it fail for the expected
      reason (not a typo/import error).

- [ ] In `src/daemon/console.ts`, change line 1812 from:

  ```html
  <button class="ov-nav oc-nav" id="brainNav" onclick="showBrain()">🧠 Brain</button>
  ```

  to:

  ```html
  <button class="ov-nav oc-nav" id="brainNav" onclick="showBrain()">🧠 Memory</button>
  ```

- [ ] Re-run the same test filter. Confirm it **passes** (GREEN). No refactor step
      needed — this is a one-line literal text change with no logic to clean up.

- [ ] Re-run the pre-existing test at `console.test.ts:982`
      ("Brain / Memory Review nav opens a three-pane read-only screen…") specifically —
      confirm it still passes unchanged, since it asserts `id`/`onclick` attributes, not
      the label text, and this change must not touch those.

## Verification gates (run after Task 1, before declaring done)

- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — full suite passes (not just the new test — confirm no regression)
- [ ] `node scripts/scope-wall.mjs` — zero violations (expected no-op: no new
      persistent store/concept introduced)

## Finishing

- [ ] `git status` / `git diff` — confirm only `src/daemon/console.ts` and
      `src/daemon/console.test.ts` changed (plus this plan/design doc pair being newly
      added), nothing stray swept in (note: two pre-existing untracked docs from an
      earlier same-day dispatch are already sitting in the tree — do not add or touch
      them, they are not part of this change).
- [ ] Commit to `main` with a descriptive message.
- [ ] **Push to `main`** — the dispatch explicitly requests this ("Push to main. No
      build at this time."), unlike the usual leave-unpushed precedent for this loop.
      Do **not** run any release/build/notarize/publish skill or script — a source
      push is requested, a release is not, and release remains operator-only.
