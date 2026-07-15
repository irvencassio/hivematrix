# Board Status Colors — Design

## Problem (operator ask)

Board view task cards give no quick scanning signal for who owns the next action:

- `ready_for_review` and `needs_input` both render as flat grey badges — indistinguishable.
- The only card that currently gets a colored (gold) border is whichever one happens to be
  **selected** — a selection artifact, not a status signal. Every other `needs_input` card
  looks like every other neutral card.

Desired: `ready_for_review` → green (waiting on team, not urgent for the operator).
`needs_input` → persistent yellow border on **every** such card, not just the selected one
(waiting on the operator, action required). Applies to desktop + mobile, and to every
sibling app that has a Board view.

## Current state (verified against HEAD `58323407`)

Single source of truth for the desktop console: `src/daemon/console.ts` — a server-rendered
`CONSOLE_HTML` string (no build step, no React/Next despite `COMPONENT-MAP.md`'s stale claim).
Card markup and `renderBoard()` are plain browser JS inside the embedded `<script>` block
(`console.ts:1941+`), not the outer TS module — so nothing there can `import` a TS helper.

- `ReviewState = "needs_input" | "ready_for_review" | "needs_parent_decision"`
  (`src/lib/tasks/review-state.ts:4`). `getReviewStateMeta()` already maps each value to
  `{label, tone: "attention" | "review"}` (`review-state.ts:11-24`) — **but it's dead code**,
  never called from `console.ts`. `needs_parent_decision` is already grouped under tone
  `"review"` (same as `ready_for_review`) by whoever wrote this — it's a child-worker
  ambiguity a coordinator resolves, not something the operator needs to act on.
- Card badge markup — `console.ts:2305`:
  `(t.reviewState?'<span class="badge">'+esc(t.reviewState)+'</span>':'')` — prints the raw
  enum (`needs_input`, not "Needs Input") through the generic `.badge` rule (`console.ts:597`,
  all grey: `background: var(--badge-bg); color: var(--badge-text)`).
- Tone modifiers `.badge.ok` / `.badge.warn` / `.badge.err` already exist (`console.ts:314-316`)
  but are only wired to the unrelated `.sk-badge` (skills) elements today — a ready-made,
  unused convention for exactly this.
- Selected-card border — `.card.sel { border-color: var(--accent); }` (`console.ts:577`).
  `--accent` is **not a neutral "selection" color** — it's the theme's signature hue:
  dark `#d9a441` (gold), light `#9a6700`, matrix `#39ff7e`.
- **Token collision, verified in the actual `:root`/theme blocks (`console.ts:19-105`):**
  light theme's `--accent` (`#9a6700`) is *byte-identical* to `--warn` (`#9a6700`); matrix
  theme's `--accent` (`#39ff7e`) is *byte-identical* to `--ok` (`#39ff7e`). If a persistent
  `needs_input`/`ready_for_review` border reuses `--warn`/`--ok` while `.sel` keeps
  overriding `border-color` with `--accent`, a selected-but-otherwise-neutral card becomes
  visually identical to an unselected `needs_input` (light theme) or `ready_for_review`
  (matrix theme) card — which recreates exactly the ambiguity this task exists to remove.
  **Selection must not be encoded as `border-color` any more.**
- Existing idiom for "subtle tinted emphasis container" in this exact file: `color-mix(in
  srgb, var(--warn) 10%, var(--panel-2))` for `.stuck-banner` (`console.ts:317`) and
  `color-mix(in srgb, var(--accent) 8%, var(--panel-2))` for `.attach-drop.drag-over`
  (`console.ts:311`). No new CSS technique needed — reuse this.
- No separate mobile component/CSS exists. `console.ts`'s `@media (max-width: 760px)`
  (`console.ts:191-199`) reflows the same markup/CSS into one column; `.card`/`.badge` rules
  are not overridden per-breakpoint, and a test already locks the cross-size contract
  (`console.test.ts:1349`, "stable width and height constraints"). A base-rule fix therefore
  covers mobile automatically, as long as it doesn't add fixed widths.

### Companion apps (only 3 of 5 have a Board at all)

| App | Board view? | Current `needs_input`/`ready_for_review` handling | Existing border/selection concept |
|---|---|---|---|
| `hivematrix-ios` | Yes (`BoardView.swift`) | Flat grey text only (`TaskRow:611`, `DesktopTaskCard:398`) | `isSelected` → solid **orange** border (`BoardView.swift:413-417`) |
| `hivematrix-android` | Yes (`BoardScreen.kt`) | `StatusBadge` colors `task.status` only; `reviewState` is never read (`BoardScreen.kt:162-179`) | None |
| `hivematrix-androidwatch` | Yes (`BoardScreen.kt`) | `needs_input` **already yellow** (`Color(0xFFFFD60A)`, `BoardScreen.kt:208-210`); `ready_for_review` still flat grey | None |
| `hivematrix-glasses` | No — no task list UI at all, only capture-to-task creation | n/a | n/a |
| `hivematrix-watch` | No — board deliberately removed (`RootView.swift:1-8` doc comment); vestigial model, unused | n/a | n/a |

Glasses and watchOS are correctly out of scope — there is nothing to change.

## Approaches considered

**A. Border-color swap only (`--accent`→`--warn`/`--ok` on `.card`, leave `.sel` as-is).**
Simplest diff. Rejected: reintroduces the exact collision described above in light/matrix
themes — selection would silently mimic a status on 2 of 3 themes.

**B. New dedicated "selection" token (`--select`), keep status colors on border, `.sel` keeps
using `border-color`.** Avoids the collision by picking a 4th hue for selection. Rejected as
higher-complexity than needed — adds a new token family purely to work around a
border-color/border-color fight, when CSS already gives us a second, additive channel
(`box-shadow`) for exactly this "two independent signals on one box" case.

**C. (Recommended) Decouple the two signals onto different CSS properties.** Status owns
`border-color` + a subtle `color-mix` fill (reusing the `.stuck-banner`/`.attach-drop` idiom
verbatim — same function, same 8-10% figure, same `--panel-2` base). Selection becomes a ring
via `box-shadow: 0 0 0 2px var(--accent)`, additive on top of whatever border color the status
put there. A selected `needs_input` card shows its amber border *and* the accent ring; a
selected neutral card shows just the ring (today's look, minus the border-color swap that
caused the collision). Zero new tokens, zero new CSS features — reuses `.card.sel`'s existing
`--accent` and the file's existing `color-mix` pattern.

## Recommended design

### `hivematrix` (desktop + mobile, one fix covers both)

CSS (`console.ts`, alongside the existing `.card`/`.badge` rules):
```css
.card.tone-attention { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 8%, var(--panel-2)); }
.card.tone-review    { border-color: var(--ok);   background: color-mix(in srgb, var(--ok) 8%, var(--panel-2)); }
.card.sel { box-shadow: 0 0 0 2px var(--accent); }   /* replaces border-color: var(--accent) */
.badge.ok { background: color-mix(in srgb, var(--ok) 16%, var(--badge-bg)); }     /* extends existing rule */
.badge.warn { background: color-mix(in srgb, var(--warn) 16%, var(--badge-bg)); } /* extends existing rule */
```
`.badge.ok`/`.badge.warn` already set `color` (line 314-316); adding a tinted `background` on
those same rules makes the badge itself read as a small green/amber pill instead of grey text,
same treatment style as the card border.

Client script (`renderBoard()`'s card-building closure, `console.ts:2298-2308`): since this
runs as plain browser JS with no module loader, it cannot `import getReviewStateMeta` from
`review-state.ts`. Mirror its 3-case mapping inline (6 lines) rather than reaching for a build
step:
```js
function reviewStateMeta(rs) {
  if (rs === "needs_input") return { label: "Needs Input", tone: "attention" };
  if (rs === "ready_for_review") return { label: "Ready for Review", tone: "review" };
  if (rs === "needs_parent_decision") return { label: "Needs parent decision", tone: "review" };
  return null;
}
```
Card class + badge markup then become:
```js
const rsm = reviewStateMeta(t.reviewState);
'<div class="card'+(state.selected===t._id?' sel':'')+(rsm?' tone-'+rsm.tone:'')+...
...
+ (rsm?'<span class="badge '+(rsm.tone==="attention"?"warn":"ok")+'">'+esc(rsm.label)+'</span>':'')
```
This is the one place a small duplication is introduced (the tone/label table exists in both
`review-state.ts` and this client script) — unavoidable without adding a bundler for the
console, which is out of this task's scope and not something AGENTS.md's complexity budget
would sanction for a styling fix.

### `hivematrix-ios`

Add a small, Board-scoped helper in `BoardView.swift` (not touching the existing
`statusBadge(_:)` in `WorkflowsView.swift`, which serves 5 unrelated call sites with a
different `status`-keyed convention — changing its `needs_input`/`blocked` → `.orange` case
would ripple into `WorkflowsView`/`SkillsView` with no product ask behind it). Border color
keyed off `reviewState`: `needs_input` → `.yellow` (matches the Android Watch app's existing
`0xFFFFD60A` precedent, for cross-platform consistency), `ready_for_review`/
`needs_parent_decision` → `.green`. Apply to both `TaskRow` (611) and `DesktopTaskCard`
(398-417), replacing the flat `.secondary` text color with the same tone → also driving a
border/background on `DesktopTaskCard` alongside the existing `isSelected` treatment (kept
as-is; orange selection vs. yellow/green status border/text is already visually distinct, no
collision like the web token case).

### `hivematrix-android`

`StatusBadge` (`BoardScreen.kt:162-179`) currently ignores `task.reviewState` entirely. Add a
priority check: if `reviewState` is `needs_input` or `ready_for_review`, it wins over the
lane-status color. No custom color tokens exist in this app beyond `MaterialTheme.colorScheme`
— use literal colors matching the other two platforms for visual parity across the product
(`0xFFFFD60A` yellow, `0xFF3FB950` green, matching desktop's `--ok`). Add a border
(`Modifier.border`) to `TaskCard` (132-160), which has no border concept today.

### `hivematrix-androidwatch`

Smallest diff of the three: `needs_input` yellow already exists. Add the missing
`ready_for_review` → green case next to it in the same `TaskRow` conditional
(`BoardScreen.kt:188-217`), reusing the same `0xFFFFD60A` constant already used 3x in this
file (pull it into one named constant while touching this code, since I'm already editing all
3 call sites' neighborhood — small, contained cleanup, not a detour). Given the tiny watch
screen, this stays text/icon-colored rather than adding a full card border, matching the
existing pattern on this platform.

## Accessibility

Text labels stay present in all cases (badges show "Needs Input"/"Ready for Review", not
color alone) — satisfies WCAG 1.4.1 (color is a reinforcement, not the sole signal). Border +
fill color choices reuse `--ok`/`--warn`, which are already used elsewhere in this file for
positive/warning meaning (`.badge.ok`/`.badge.warn`, `.stuck-banner`) — no new contrast
surface to validate beyond what's already shipped. Selection ring (`box-shadow`) does not rely
on hue at all (works the same for a color-blind operator: a highlighted outline exists or it
doesn't) — an incidental accessibility improvement over today's color-only `.sel` border.

## Non-goals

- Not touching the task-detail pane's `t.reviewState` display (`console.ts:2549`) — operator
  asked about the **Board view** specifically.
- Not adding contrast-ratio automated tests — no existing precedent for that in this repo;
  the color choices are all reused, already-shipped tokens, not new hex values.
- No DECISIONS.md entry — this introduces no new persistent store, orchestration primitive, or
  product concept (kernel: Event/Task/Directive/Policy/Persona/Memory untouched). It wires an
  existing enum (`ReviewState`) to existing tokens (`--ok`/`--warn`/`--accent`) via existing
  CSS idioms (`color-mix`) already present in this same file.
- `hivematrix-glasses`/`hivematrix-watch` — confirmed no Board view exists; nothing to change.

## Open questions for approval

1. **Selection → `box-shadow` ring instead of `border-color`.** Changes the current selected-
   card look (solid gold border) to a ring around the card. Necessary to avoid the light/matrix
   theme token collision described above — is this an acceptable visual change?
2. **Symmetric border+tint for both tones**, vs. the literal ask (border-only for
   `needs_input`, border-or-fill for `ready_for_review`). Recommending symmetric because this
   file already treats warn/accent emphasis as border+tint together everywhere else
   (`.stuck-banner`, `.attach-drop.drag-over`) — an asymmetric treatment would be the outlier.
   OK to proceed symmetric?
3. **`needs_parent_decision`** groups with `ready_for_review` (green) — reusing the tone
   already assigned by `getReviewStateMeta` rather than inventing a 3rd visual treatment you
   didn't ask for. Confirm, or should it stay neutral/grey since it wasn't in your original ask?
