# Desktop console: promote frontier Usage into its own section — Design

> Date: 2026-06-26
> Status: Approved (recommendation pre-approved; code inspection confirms it is implementable)

## Problem

The operator checks frontier usage often, but it is buried inside the **Models**
panel (`#modelsSec`) *below* local-engine and embeddings detail. `checkModels()`
even appends a `Frontier · cloud` group header before the `#usage` div, so the
usage bars sit at the very bottom of a long Models stack. Routine usage checks
require scrolling past on-device model detail every time.

## Current structure (src/daemon/console.ts)

Right sidebar (`section.col.context`) order: `#approvals`, `#setupSec`,
**`#modelsSec`**, `#obsSec`, `#connSec`, `#dirSec`, …

`#modelsSec` contains:
- `#modelStatus` — filled by `checkModels()` (Local · on-device, Embeddings,
  then a `Frontier · cloud` group header).
- `#usage` — filled by `checkUsage()` (Claude subscription rows, Codex
  subscription rows, HiveMatrix task counts).

The Models summary's refresh button (`#usageRefresh`, `refreshModelsNow()`)
refreshes local model status *and* usage together.

Header pill `#usagePill` shows `⚡ 63% left` (Claude's most-constrained window
only) or a task-count fallback.

Data shape (`/usage`):
- `subscription` (Claude): `fiveHour`/`sevenDay`/`sevenDayOpus`/`sevenDaySonnet`,
  each `{ remaining, utilization, resetsAt }`.
- `subscriptionStatus` (Claude auth state when no numbers).
- `codexSubscription`: `{ planType, error, fiveHour, sevenDay }` where windows
  carry `{ utilization, resetsAt }` (remaining = 100 − utilization).
- `byModel`, `taskCount`, `inputTokens`, `outputTokens` (counts/tokens only —
  **no dollars**, already enforced by tests).

## Decision

### New "Usage" section, above Models

Insert a new collapsible section `#usageSec` (a `.ctx-sec` `<details open>`)
directly **above** `#modelsSec` in the right sidebar. It contains:

1. `#usageSummary` — the at-a-glance surface: one compact card per active
   provider (Claude, Codex). Each card shows:
   - provider name,
   - **lowest relevant remaining percent** across that provider's windows,
   - a compact progress bar (fill = used%, colored via the existing
     `usageBarClass` so a low remaining → amber/red — "impossible to miss but
     not noisy"); a `.low` card modifier (remaining ≤ 20) adds a red accent,
   - the binding window's label + reset time (e.g. `5-hour · resets in 2h 13m`).
   When a provider has only an auth/status note (not numbers), the card shows
   the plan label / status instead of a bar — no fabricated percentages.
2. `#usageDetailsSec` — a secondary, collapsed `<details>` ("Per-window details")
   wrapping the existing `#usage` div with the full per-window rows and
   HiveMatrix task counts. Detail is preserved, just no longer primary.
3. A refresh button `#usageRefresh` in the section summary → `refreshUsageNow()`
   (calls `checkUsage(true)` → `/usage?refresh=1`).

### Models stays focused

- Remove the `Frontier · cloud` group header from `checkModels()`.
- Remove the `#usage` div from `#modelsSec`.
- Models summary refresh button is renamed `#modelsRefresh`; `refreshModelsNow()`
  refreshes local model status only (`loadModels()` + `checkModels()`).
- `#modelStatus` keeps Local · on-device + Embeddings rendering unchanged.

### Header pill: worst active frontier window, with reset

`#usagePill` is kept and improved to mirror the worst active frontier window
**across both providers**: `⚡ 63% · 2h 13m` (lowest remaining % · compact reset).
The detailed multi-line tooltip is preserved. The no-subscription **task-count
fallback line is kept verbatim** (a regression guard test asserts it).

### Constraints honored

- No dollar costs anywhere in the new UI (cards show "% left", reset windows,
  and — in details only — counts/tokens).
- `/usage` endpoint and its scheduler are untouched (frontend-only change).
- No secrets/tokens/auth headers/credentials rendered.
- Dark-theme consistency: cards reuse existing CSS variables and the existing
  `.usage-bar`/`usageBarClass` palette.
- Visible without scrolling: the section sits near the top, summary-first; the
  long per-window list is collapsed by default.

## Out of scope

- No `/usage` payload or scheduler changes.
- No change to local-engine/embeddings rendering beyond removing the misplaced
  Frontier header.

## Tests (TDD, console source-level)

1. A standalone `#usageSec` exists and is positioned **above** `#modelsSec`.
2. Claude and Codex both render in the Usage summary (`usageProviderCard("Claude"…`,
   `usageProviderCard("Codex"…`, into `#usageSummary`).
3. Models still renders local engine + embeddings (`Local · on-device`,
   `Embeddings`) and no longer hosts the `Frontier · cloud` usage header.
4. Per-window usage details remain available (`#usage` lives inside
   `#usageDetailsSec` within `#usageSec`, between `#usageSec` and `#modelsSec`).
5. No dollar/cost copy introduced (no `$`, no `cost`/`spend` in usage code).
6. Header pill `#usagePill` still exists and uses the concise `% · <reset>`
   summary; the task-count fallback line is preserved.

## Gates

- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
- `npm run verify:portal`
