# Usage Pill Ticked Bars — Design

> Operator (Irv) request, 2026-07-22. Rework the three header usage meters
> (`5h`, `7d`, `ctx`) so each is a **longer horizontal bar with tick marks at its
> segment boundaries**, and correct the `7d` fill/colour to a day-paced signal.

## Problem

The header carries three tiny meters in `src/daemon/console.ts`:

- `5h` — a 44px continuous fill bar (`usage-bar` + `usage-bar-fill`).
- `7d` — a 44px row of **7 discrete boxes** (`usage-bar-days` / `usage-bar-day`),
  filled `day <= cycleDay`. So the fill counted **elapsed days**, not usage: on
  day 7 it shows 6–7 filled boxes regardless of how little was consumed. With the
  live "Day 7 of 7 · 62% left" (38% used) it renders a nearly-full bar, implying
  the week is spent when only ~3 days-worth is.
- `ctx` — a 44px continuous fill bar.

The operator wants all three visually unified as a longer bar with boundary ticks,
and the `7d` fill to read **days-worth consumed**, coloured by pace.

## Operator's formalized math (7d only)

- The 7-day window is a weekly budget; each of 7 ticks = one day-worth ≈ 14.3%
  (`100/7`).
- `usedPct = 100 - remainingPct`.
- **Fill (segments lit)** `= round(usedPct / 14.3)` = days-worth consumed, clamped
  to `[0, 7]`. Example: 62% left → 38% used → `38/14.3 = 2.66` → **3** segments.
- **Colour** is a pace signal vs. the current cycle day `N`. Allowed cumulative
  pace by day `N` = `N * 14.3%`.
  - `usedPct <= N * 14.3%` → **green** (on/under pace).
  - `usedPct >  N * 14.3%` → **red** (burning hot).
  - Examples: day 1 & used > 14.3% → red; day 2 & used 28% (< 28.6%) → 2 **green**.

## Decisions

### 1. Geometry — all three (5h, 7d, ctx)

One shared DOM shape: `usage-bar` (track) > `usage-bar-fill` + N-1 boundary
`usage-bar-tick` overlays. The `.usage-bar-tick` class already exists (a
page-`--bg` notch, `position:absolute; top/bottom:0; width:1.5px; z-index:1`) —
reuse it, don't invent a new one. Ticks are pre-rendered static markup (segment
counts are fixed) positioned by inline `left:%`.

- Bars grow **44px → 76px** (both `.usage-win-bars .usage-bar` and
  `.ctx-meter .usage-bar`). Height unchanged (8px).
- `5h`: 5 hour-segments → **4 ticks** at 20/40/60/80%. Fill = `utilization%`.
- `7d`: 7 day-segments → **6 ticks** at `k/7` (14.29…85.71%). Fill snaps to
  `filledBars/7 * 100%` so the fill edge lands on a tick and reads as N whole
  segments.
- `ctx`: **3 ticks** at 25/50/75% (75% = the auto-compaction threshold, so the
  tick is informative). Fill = context `pct` as today.

The old `usage-bar-days` / `usage-bar-day*` markup and CSS are removed — `7d`
adopts the same `usage-bar`+`usage-bar-fill` shape as `5h`, reusing the existing
`.usage-bar-fill.ok/.warn/.hi` colour classes. Fewer concepts, per the complexity
budget.

### 2. 7d fill/colour logic (`renderUsage7dBar`)

- `usedPct = 100 - clamp(win.remaining, 0, 100)` (operator's exact definition).
- `filledBars = clamp(round(usedPct / (100/7)), 0, 7)`.
- Fill width = `filledBars / 7 * 100`, class = `usage-bar-fill ` + colour.
- **Colour: keep the existing `usageBarClass` 7-day branch unchanged.** It already
  implements the operator's pace formula: `usedPct <= cycleDay * 14.3 → ok`, else
  `hi`. Every operator example agrees with it (day 1 >14.3 → red; day 2 28% →
  green; day 7 38% → green). It carries **one deliberate refinement** — a day-7
  cap at `6/7` (85.7%) so a nearly-exhausted final day still reads red rather than
  false-green — designed in `2026-07-01-usage-7-day-green-red-design.md` and
  covered by tests. No operator example touches the 85.7–100% day-7 band, so I
  keep the safer designed behaviour rather than silently widen it. **Assumption to
  confirm:** if the operator wants pure `N*14.3` with no day-7 cap, it's a
  one-line change to `usageBarClass`.
- Tooltip text (`"Day N of 7 · X% left · resets in …"`) is **preserved verbatim**.

### 3. 5h and ctx — geometry only

Per the operator's scope note, `5h` and `ctx` get the longer-bar + tick treatment
only. `5h` keeps its existing `usageBarClass` colour (its own hour-paced logic,
not the day-pace math). `ctx` keeps its `ctx-ok/notice/warn/critical` colour and
percent label. No logic change to either beyond the fill already being set.

### 4. Styling consistency

Pill shells, the constant-width transparent border on `#usageWinToggle button`
(no active/yellow highlight — both meters always shown), tooltips and the `ctx`
percent label are unchanged. Only bar length and the tick overlays change.

## Out of scope

- The observability modal timeline (its own `tl-tick` system).
- Any backend/usage-data change — this is presentation only.
- Releasing — the operator releases.
