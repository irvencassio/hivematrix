# Task Age Indicator — Design

> Parity feature: Hive 1 showed a small "last updated N ago" indicator on each task so two
> similar-looking tasks (e.g. two "LinkedIn" tasks) can be told apart by age. Restore it on
> both the desktop console (`hivematrix`) and the iOS app (`hivematrix-ios`).

## Problem
Two tasks with the same title are indistinguishable in the board. Hive 1 differentiated them
with a relative-time chip ("5 min ago" vs "5 days ago"). The current apps drop it.

## Findings (from code audit)
- **No server change needed.** `GET /tasks` does `SELECT * FROM tasks` and returns raw rows
  (`src/daemon/server.ts:1469`), so `updatedAt`/`createdAt`/`startedAt`/`completedAt` are
  already on the wire. The desktop console already holds them in `state.tasks`; the iOS
  `TaskItem` struct simply never decoded them.
- **Date-format landmine.** The daemon writes `updatedAt` in **two** formats:
  - on INSERT: `new Date().toISOString()` → `2026-06-14T10:30:45.123Z` (`src/lib/db/index.ts:644,690`)
  - on UPDATE: SQLite `datetime('now')` → `2026-06-14 10:30:45` (space-separated, UTC, **no `T`/`Z`**)
    (`src/lib/db/index.ts:620,733`, `src/daemon/server.ts:1478`)
  A naive `new Date(...)` / `ISO8601DateFormatter` misparses the space form (treats it as local
  time, or fails → "55 years ago"). The parser MUST accept both and treat the space form as UTC.

## Decisions
- **Time source:** `updatedAt` (literal "age of last update", matches the request wording),
  falling back to `createdAt` when absent. NOTE: Hive 1's iOS used a stable lifecycle chain
  (`startedAt ?? completedAt ?? assignedAt ?? createdAt`) instead — chosen here is `updatedAt`
  per the user's "last update" wording. Easy to switch in one place if churn proves noisy.
- **Format:** custom bucketed humanizer returning identical strings on both platforms:
  `just now`, `N min ago`, `N hr ago`, `N days ago`, `N mo ago`, `N yr ago` (singular at 1).
- **Display:** a subtle chip alongside the existing model/review/project chips. Desktop reuses
  the `.badge` class (muted variant). iOS adds a `clock` SF Symbol + caption text (mirrors Hive 1).
  Absolute timestamp shown on hover (desktop `title`).
- **Staleness:** desktop board already re-renders every 5s (`setInterval(refresh, 5000)`), so the
  relative text self-refreshes; no extra timer. iOS recomputes on each data refresh.

## Why TDD here (AGENTS.md)
The risk is entirely in the date parser (mixed formats, UTC handling), not the UI. Both the
desktop inlined `timeAgo` and the Swift `relativeTimeAgo` are pure functions covered by tests,
including the SQLite space-format-as-UTC case that would otherwise silently render wrong ages.

## Out of scope
No new API fields, no schema change, no change to how timestamps are written.
