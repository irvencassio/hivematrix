# 5h/7d Usage Toggle Active-State Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-16-usage-toggle-active-color-design.md`
(Option 3 — scope a border-color-swap override to `#usageWinToggle`, mirroring
`.ov-nav.active`'s constant-border-width technique; leave the shared `.obs-win
button.on` rule — and therefore the Observability modal's own pickers — untouched.)

## Task 1 — failing test, then fix, then verify

- [ ] In `src/daemon/console.test.ts`, add a new test near the existing
      `"header Usage section is removed..."` test (~line 1709):

  ```ts
  test("5h/7d header toggle marks its active button with the sidebar's yellow-border pattern, not a blue background", () => {
    // Reference pattern this must match: .ov-nav.active (left sidebar, e.g. #flashNav).
    assert.match(
      CONSOLE_HTML,
      /\.ov-nav\.active\s*\{\s*border-color:\s*var\(--accent\);\s*color:\s*var\(--accent\);\s*\}/,
      "sidebar reference pattern still present with this exact shape",
    );

    // The header toggle must override the shared blue .on style with the same
    // token/technique, scoped to #usageWinToggle only.
    assert.match(
      CONSOLE_HTML,
      /#usageWinToggle button \{[^}]*border:\s*1px solid transparent;?[^}]*\}/,
      "toggle buttons reserve a constant-width transparent border so activating one is a color fade, not a layout jump",
    );
    assert.match(
      CONSOLE_HTML,
      /#usageWinToggle button\.on \{[^}]*border-color:\s*var\(--accent\)[^}]*\}/,
      "active toggle button gets the same gold/yellow border-color token as the sidebar's active nav item",
    );
    assert.doesNotMatch(
      CONSOLE_HTML,
      /#usageWinToggle button\.on \{[^}]*background:\s*var\(--accent-2\)[^}]*\}/,
      "active toggle button must not keep the old blue background",
    );

    // Regression guard: the shared .obs-win rule (used elsewhere, e.g. the
    // Observability modal's window/group pickers) must be untouched.
    assert.match(
      CONSOLE_HTML,
      /\.obs-win button\.on \{ background:var\(--accent-2\); color:#fff; \}/,
      "shared .obs-win active style must stay exactly as-is for non-header pickers (e.g. Observability modal)",
    );
  });
  ```

- [ ] Run `npm test -- --test-name-pattern="5h/7d header toggle"` (or the project's
      equivalent single-test filter). Confirm it **fails** against the current source
      — `#usageWinToggle button`/`#usageWinToggle button.on` don't exist yet, so the
      middle two assertions should fail. This is the RED step; do not proceed until
      you've actually seen it fail for the expected reason (not a typo/import error).

- [ ] In `src/daemon/console.ts`, near the existing `.usage-win-bars` rules
      (`.usage-bar-day:last-child { margin-right: 0; }`, ~line 347), add:

  ```css
  #usageWinToggle button { border: 1px solid transparent; }
  #usageWinToggle button.on { background: var(--panel-2); color: var(--accent); border-color: var(--accent); }
  ```

  Do **not** edit `.obs-win button.on` (`console.ts:378`) — it must stay exactly as-is
  for the Observability modal's own window/group pickers, which are out of scope here.

- [ ] Re-run the same test filter. Confirm it **passes** (GREEN). No refactor step
      needed — this is a small, self-contained CSS addition with no logic to clean up.

## Verification gates (run after Task 1, before declaring done)

- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — full suite passes (not just the new test — confirm no regression,
      in particular the existing `"header Usage section is removed..."` test and
      anything else touching `usageWinToggle`/`obs-win`)
- [ ] `node scripts/scope-wall.mjs` — zero violations (expected no-op: no new
      persistent store/concept introduced)

## Finishing

- [ ] `git status` / `git diff` — confirm only `src/daemon/console.ts` and
      `src/daemon/console.test.ts` changed, nothing stray (note: a stale worktree at
      `.claude/worktrees/fix-goals-data-loss/` exists from unrelated prior work — do not
      touch it).
- [ ] Commit to `main` with a descriptive message. **Do not push** (leave ahead of
      `origin/main` for the operator to push+release together, matching same-day
      precedent). **Do not run any release/build/notarize/publish skill or script** —
      release is operator-only.
- [ ] Record the resolution in `~/_GD/brain/projects/hive/known-issues.md` (dated entry:
      what changed, the exact selector, so a reworded future dispatch about toggle
      colors can short-circuit against it) — this is a separate system from Claude
      Code's own memory store; autonomous dispatches only read the former.
