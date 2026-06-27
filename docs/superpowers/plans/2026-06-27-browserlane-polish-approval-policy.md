# BrowserLane Polish + Approval Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-06-27-browserlane-polish-approval-policy-design.md`

---

## Task 1 — RED: Write failing tests
`scripts/approval-hook-ccd-allowlist.test.mjs`
- [x] Test: generated hook script contains `mcp__ccd_session__*` allowlist entry before the catch-all MCP block
- [x] Test: `mcp__ccd_session__spawn_task` exits 0 (not prompted)

`scripts/console-overview-colors.test.mjs`
- [x] Test: console.ts `renderOverview` card calls include color for `failed`, `in_progress`, `review`
- [x] Test: console.ts contains `--wp-blur` variable and `blur(var(--wp-blur`

`scripts/console-scheduled-rename.test.mjs`
- [x] Test: console.ts contains `>Scheduled<` (section summary)
- [x] Test: console.ts does NOT contain `>Directives<` (old label)
- [x] Test: console.ts contains `New scheduled item` (button label)
- [x] Test: card label for active scheduled items is NOT "active directives"

---

## Task 2 — GREEN: Fix window persistence
File: `browser-lane-app/Sources/BrowserLaneApp/AppDelegate.swift`
- [x] Add `window.frameAutosaveName = "BrowserLaneMain"` before `window.center()`
- [x] Check for saved frame: only call `window.center()` when no saved frame exists

---

## Task 3 — GREEN: Fix icon persistence
File: `browser-lane-app/Sources/BrowserLaneApp/BrowserLaneSettings.swift`
- [x] In `applyIconState()`, after setting `applicationIconImage`, call `NSWorkspace.shared.setIcon(image, forFile: Bundle.main.bundlePath, options: [])`
- [x] Guard `setIcon` call with `#if !DEBUG` comment (it's fine in production; in debug just let the xcrun dev icon show)

---

## Task 4 — GREEN: Overview color coding
File: `src/daemon/console.ts`
- [x] Add `const laneColor = { in_progress: 'var(--accent)', review: 'var(--ok)', failed: 'var(--err)' }` near LANE_DEFS
- [x] Modify `card()` function to accept a 4th `numColor` param, apply as inline style on `.ov-num`
- [x] Update `LANE_DEFS.map(L => card(...))` call to pass `laneColor[L.key] || ''`
- [x] Add `.ov-card.ok` and `.ov-card.err` CSS rules mirroring the existing `.ov-card.warn`

---

## Task 5 — GREEN: Drag-drop attachment
File: `src/daemon/console.ts`
- [x] Add `ondragover="event.preventDefault();this.classList.add('drag-over')"` etc. to `.attach-row` div
- [x] Add `function onAttachDrop(e) { e.preventDefault(); const files = e.dataTransfer?.files; if (files?.length) onAttachFiles({ files, value: '' }); this.classList?.remove('drag-over'); }`  
- [x] Add CSS `.attach-drop.drag-over { border: 1px dashed var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--panel-2)); border-radius: 6px; }`
- [x] Add class `attach-drop` to the attach-row div

---

## Task 6 — GREEN: Fix translucency blur at 0%
File: `src/daemon/console.ts`
- [x] Change CSS `backdrop-filter: blur(6px)` → `backdrop-filter: blur(var(--wp-blur, 6px))`
- [x] In `applyTheme()`: after setting `--wp-opacity`, also set `--wp-blur` (`6px` if op > 0, else `0px`)
- [x] In `onOpacityInput()`: same paired set
- [x] In `saveOpacity()`: let `loadModels()` handle it (it calls `applyTheme`)

---

## Task 7 — GREEN: New task in center window
File: `src/daemon/console.ts`
- [x] Add `let _taskFormInSession = false;` state variable
- [x] Add `function showNewTaskPanel()` that moves `#taskForm` into `#session`
- [x] Add `function _closeNewTaskPanel()` that moves form back and calls `renderOverview()`
- [x] Change "New task" button onclick from `toggleForm('taskForm')` to `showNewTaskPanel()`
- [x] Guard `renderOverview()` with `if (_taskFormInSession) return;`
- [x] Modify `cancelForm('taskForm')` to delegate to `_closeNewTaskPanel()` when in session
- [x] Modify `createTask()` success: call `_closeNewTaskPanel()` instead of `toggleForm("taskForm")` when in session
- [x] Add CSS `.new-task-panel { padding: 24px; } .new-task-panel h2 { margin: 0 0 12px; font-size: 18px; font-weight: 600; }`

---

## Task 8 — GREEN: Directives → Scheduled rename
File: `src/daemon/console.ts`
- [x] `<summary>Directives</summary>` → `<summary>Scheduled</summary>`
- [x] `＋ New directive` → `＋ New scheduled item`
- [x] `Create directive` → `Schedule`
- [x] `card("active directives", ...)` → `card("scheduled", ...)`
- [x] APNS briefing text: `active directives` → `active scheduled items`

---

## Task 9 — GREEN: CCD session auto-approval
File: `src/lib/orchestrator/approval.ts`
- [x] In `generateHookScript()`, insert CCD/Superpowers allowlist block before `# MCP tools — always require approval`
- [x] Update the LIVE hook with the same patch (`~/.hivematrix/hooks/3719395fb4184acba0f29d5d.sh`; the older planned hook path no longer existed)

---

## Task 10 — Verification gates
- [x] `npm run typecheck` — zero errors
- [x] `npm test` — all tests passing (including new RED→GREEN tests)
- [x] `node scripts/scope-wall.mjs` — zero violations

---

## Task 11 — Commit and push
- [ ] `git add` relevant files
- [ ] Commit with conventional message
- [ ] Push to main
