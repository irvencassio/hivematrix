# Console Usage Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-console-usage-section-design.md`

All edits in `src/daemon/console.ts` (markup + CSS + checkUsage/checkModels/
refresh fns) and `src/daemon/console.test.ts`. No server changes.

## Task 1 — RED: tests

- [ ] Add `"frontier usage has its own Usage section above Models"`:
  - `assert.match(CONSOLE_HTML, /id="usageSec"/)`
  - `assert.ok(CONSOLE_HTML.indexOf('id="usageSec"') < CONSOLE_HTML.indexOf('id="modelsSec"'))`
  - `assert.match(CONSOLE_HTML, /<details class="ctx-sec" id="usageSec" open>/)`
- [ ] Add `"Usage section renders Claude and Codex provider cards"`:
  - `assert.match(CONSOLE_HTML, /id="usageSummary"/)`
  - js matches `/usageProviderCard\("Claude"/` and `/usageProviderCard\("Codex"/`
  - js matches `/getElementById\("usageSummary"\)/`
- [ ] Add `"per-window usage details remain available but secondary"`:
  - `#usage` index is between `#usageSec` and `#modelsSec`
  - `assert.match(CONSOLE_HTML, /id="usageDetailsSec"/)`
  - js `assert.doesNotMatch(js, /Frontier · cloud/)` (removed from checkModels)
- [ ] Add `"Models panel still shows local engine and embeddings"`:
  - js matches `/Local · on-device/` and `/Embeddings/`
- [ ] Add `"header usage pill shows concise percent and reset"`:
  - `assert.match(CONSOLE_HTML, /id="usagePill"/)`
  - js matches `/"% · "/` (new format) and `/function fmtResetsCompact\(/`
  - fallback preserved: js matches `/pill\.textContent = "⚡ " \+ \(u\.taskCount/`
- [ ] Add `"Usage UI introduces no dollar/cost copy"`:
  - extract checkUsage + usageProviderCard bodies; assert no `/\$\d|\bcost\b/i`.
- [ ] Run `npm test` — watch fail.

## Task 2 — GREEN: CSS for compact cards

- [ ] After the `.usage-bar-fill.hi` rule (~line 183) add `.usage-cards`,
  `.usage-card`, `.usage-card.low`, `.uc-top`, `.uc-name`, `.uc-pct`,
  `.uc-reset`, and `.usage-details > summary` styles (dark-theme vars only).

## Task 3 — GREEN: markup — new Usage section above Models

- [ ] Replace the `#modelsSec` block (lines ~1035-1037) with:
  - new `<details class="ctx-sec" id="usageSec" open><summary>Usage <button
    id="usageRefresh" class="usage-refresh" … onclick="…refreshUsageNow()">↻</button></summary>`
    containing `<div id="usageSummary">…</div>` and
    `<details class="usage-details" id="usageDetailsSec"><summary>Per-window
    details</summary><div id="usage"></div></details></details>`
  - then `<details class="ctx-sec" id="modelsSec" open><summary>Models <button
    id="modelsRefresh" class="usage-refresh" … onclick="…refreshModelsNow()">↻</button></summary>
    <div id="modelStatus"></div></details>`

## Task 4 — GREEN: helpers + checkUsage rewrite

- [ ] Add `fmtResetsCompact(iso)` (strips the `in ` prefix from `fmtResets`).
- [ ] Add `lowestWindow(wins)` → returns the `{label,remaining,resetsAt}` with
  the minimum remaining (ignoring nulls), or null.
- [ ] Add `usageProviderCard(name, win, statusNote)` rendering the compact card
  (uses `usageBarClass(100-remaining)`, `.low` when remaining ≤ 20).
- [ ] In `checkUsage()`:
  - compute `claudeWins` / `codexWins` arrays from the payload,
  - build `#usageSummary` with a Claude card and a Codex card (status-note cards
    when only auth/plan state is available; muted fallback when nothing),
  - keep the existing detailed `#usage` rendering as-is,
  - update the pill: when `allWins.length`, show `⚡ <pct>% · <fmtResetsCompact>`
    of the worst window; keep the tooltip lines; keep the subStatus branch and
    the verbatim task-count fallback branch.

## Task 5 — GREEN: refresh functions

- [ ] Add `refreshUsageNow()` (disables `#usageRefresh`, `await checkUsage(true)`).
- [ ] Update `refreshModelsNow()` to target `#modelsRefresh` and refresh model
  status only (`loadModels()` + `checkModels()`); drop the usage refresh.
- [ ] Remove the `Frontier · cloud` group header line from `checkModels()`.

## Task 6 — Gates

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `node scripts/scope-wall.mjs`
- [ ] `npm run verify:portal`

## Task 7 — Commit & push to main

- [ ] Stage console.ts, console.test.ts, the two superpowers docs; commit; push.
