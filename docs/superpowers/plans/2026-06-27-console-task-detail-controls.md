# Console Task-Detail Reply/Action Control Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-27-console-task-detail-controls-design.md`

All edits are in `src/daemon/console.ts` (CSS block ~395–419, `taskActionsHtml`
~1506–1568, `setCtxSubmitDisabled` ~1776, `.col.session` CSS ~82) and tests in
`src/daemon/console.test.ts`. TDD: write/adjust the assertion, watch it fail, implement.

## Task 1 — RED: tests for the action-bar pattern + full-width reply box

- [ ] In `src/daemon/console.test.ts`, update the legacy assertion at the
  "needs_input reply window" test: `class="reply-primary"…>Reply<` →
  `class="primary-action"…>Reply<`.
- [ ] Add a new test block `console: standardized task-detail action/reply controls`
  with assertions:
  - `assert.match(CONSOLE_HTML, /\.action-bar\s*\{/)` and role classes
    `.primary-action`, `.secondary-action`, `.danger-action`, `.ghost-action` defined.
  - `.reply-input` CSS includes `width: 100%` and `box-sizing` and does **not** include `flex: 1`.
  - `section\.col\.session[^}]*container-type:\s*inline-size` present.
  - `@container` rule present that sets `.action-bar` to `flex-direction: column`.
  - In `extractScript`: `taskActionsHtml` emits `class="action-bar"` and no longer
    emits `class="actions"`; `assert.doesNotMatch(js, /reply-primary/)`.
  - needs_input/reply submit: `class="primary-action"[^>]*onclick="replyTask`.
  - retry submit + steer submit use `class="primary-action"`.
  - top-bar toggles use `secondary-action` and `reply-toggle`; Delete uses `danger-action`.
  - video-review block: contains `action-bar` and exactly one `primary-action` in that block.
  - `setCtxSubmitDisabled` uses `querySelector(".primary-action")`.
- [ ] Run `npm test` — confirm the new/updated assertions FAIL (red).

## Task 2 — GREEN: standardized CSS

- [ ] Add `container-type: inline-size;` to the `.col` rule for the session column
  (add a dedicated `.col.session { container-type: inline-size; }` line near line 82).
- [ ] Rewrite `.reply-input` (line ~403) to:
  `width:100%; box-sizing:border-box; min-height:64px; resize:vertical;` (keep bg/border/
  font/padding; remove `flex:1`).
- [ ] Add the action-bar token block near the existing `.actions` rule (replace `.actions`
  usage with `.action-bar`; keep `.actions` styles only if still referenced elsewhere —
  it is not, so replace):

```css
.action-bar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:10px 0; }
.action-bar > button { min-height:30px; min-width:72px; border-radius:6px; padding:6px 14px;
  font-size:12px; line-height:1; cursor:pointer; display:inline-flex; align-items:center;
  justify-content:center; gap:6px; white-space:nowrap; border:1px solid var(--border);
  background:var(--panel-2); color:var(--text); }
.action-bar > button:focus-visible { outline:2px solid var(--accent-2); outline-offset:2px; }
.primary-action { background:var(--accent)!important; color:var(--create-btn-text)!important;
  border:0!important; font-weight:700; }
.primary-action:hover { filter:brightness(1.08); }
.secondary-action:hover { border-color:var(--accent-2); }
.ghost-action { background:transparent!important; color:var(--muted)!important; }
.ghost-action:hover { color:var(--text)!important; border-color:var(--accent-2); }
.danger-action:hover { border-color:var(--err); color:var(--err); }
.action-bar > button[disabled] { opacity:.5; cursor:default; filter:none; }
@container (max-width: 420px) {
  .action-bar { flex-direction:column; align-items:stretch; }
  .action-bar > button { width:100%; }
}
```

- [ ] Keep `.reply-section(.needs/.subtle)`, `.reply-head`, `.reply-subhead`,
  `.reply-question`, `.reply-toggle.active` as-is. Remove the now-dead `.reply-row*`
  and `.reply-primary` CSS rules (lines ~402, 406, 408, 418).
- [ ] Run `npm run typecheck`.

## Task 3 — GREEN: taskActionsHtml + selector

- [ ] Top action bar: `'<div class="actions">'` → `'<div class="action-bar">'`. Add role
  classes: Cancel `class="secondary-action"`, Retry `class="secondary-action reply-toggle"`,
  Reply `class="secondary-action reply-toggle"`, Archive `class="secondary-action"`,
  Delete `class="danger-action"` (was `class="danger"`).
- [ ] Retry section: button row `class="reply-row" style="margin-top:6px"` →
  `class="action-bar"`; submit button gets `class="primary-action"`.
- [ ] Steer section: same row → `class="action-bar"`; submit `class="primary-action"`.
- [ ] Reply section: button row → `class="action-bar"`; optional Edit button
  `class="reply-toggle"` → `class="ghost-action"`; submit `class="reply-primary"` →
  `class="primary-action"`. Remove inline `style="margin-top:6px"`.
- [ ] Video-review section: the Edit-script row and the multi-button row →
  `class="action-bar"` (drop inline `gap/flex-wrap`); Edit script → `class="ghost-action"`,
  Save edits/Send → `class="primary-action"`, Approve → `class="secondary-action"`,
  Cancel → `class="danger-action"`.
- [ ] `setCtxSubmitDisabled`: `sec.querySelector(".reply-row button")` →
  `sec.querySelector(".primary-action")`.
- [ ] Run `npm test` — all green.

## Task 4 — Gates + visual check

- [ ] `npm run typecheck` (0 errors), `npm test` (all pass), `node scripts/scope-wall.mjs` (0).
- [ ] Render the console HTML to a temp file and eyeball needs_input / review / failed /
  video-review markup; verify textarea is full-width and bars carry role classes. If a
  live daemon is practical, inspect at desktop and narrow column widths.

## Task 5 — Commit + push

- [ ] Commit (conventional message) and push to `main`.
