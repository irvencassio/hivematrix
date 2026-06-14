# Task Age Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-14-task-age-indicator-design.md`

## Shared behavior contract (both platforms must match)
`timeAgo(value, now)` where `value` may be `2026-06-14T10:30:45.123Z` OR `2026-06-14 10:30:45`
(both UTC), returns:
- empty/invalid → `""`
- future / clock skew → `just now`
- `< 45s` → `just now`
- `< 90s` → `1 min ago`
- `< 60m` → `N min ago`
- `< 90m` → `1 hr ago`
- `< 24h` → `N hr ago`
- `< 42h` → `1 day ago`
- `< 30d` → `N days ago`
- `< 45d` → `1 mo ago`
- `< 365d` → `N mo ago`
- else → `N yr ago` (singular `1 yr ago`)

## hivematrix (desktop console)
- [ ] RED: in `src/daemon/console.test.ts`, add tests that extract the `timeAgo` body via
  `/*__TIMEAGO_START__*/.../*__TIMEAGO_END__*/` sentinels, eval it, and assert the contract —
  especially `timeAgo('2026-06-14 10:30:45', Date.parse('2026-06-14T10:35:45Z')) === '5 min ago'`
  (proves space form parsed as UTC). Also assert `ageBadge(` exists and `renderBoard` calls `ageBadge(t)`.
- [ ] GREEN: in `src/daemon/console.ts` add sentinel-wrapped self-contained `function timeAgo(value, nowMs)`
  and `function ageBadge(t)`; insert `+ ageBadge(t)` into the card `.m` group (`renderBoard`, ~line 765);
  add `.badge.age { opacity: .7; }` near `.badge` CSS (line 206).
- [ ] VERIFY: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.

## hivematrix-ios
- [ ] Add `updatedAt: String?` and `createdAt: String?` to `TaskItem` + `CodingKeys`
  (`HiveMatrix/Models/Models.swift`).
- [ ] Add `RelativeTime.swift` with pure `func relativeTimeAgo(_ value: String?, now: Date) -> String`
  implementing the contract (normalize space→`T`+`Z`, fallback `DateFormatter` UTC). Add
  `TaskItem.ageText` computed from `updatedAt ?? createdAt`.
- [ ] RED: add `RelativeTimeTests` (XCTest) mirroring the contract incl. the SQLite-space-UTC case.
- [ ] Wire a `clock` SF Symbol + `ageText` into `TaskRow` (HStack ~line 550) and `DesktopTaskCard`
  (chip row ~line 358) in `HiveMatrix/Views/BoardView.swift`.

## Done when
Both boards show a relative-time chip per task; parser tests green on desktop; iOS tests written
(note: iOS suite runs under Xcode, not in this CLI env).
