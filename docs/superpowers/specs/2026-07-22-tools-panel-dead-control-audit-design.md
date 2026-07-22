# Tools & Skill-Panel Dead-Control Audit — Design

> Superpowers: brainstorm phase. Scope: `src/daemon/console.ts` (the CONSOLE_HTML
> template) + `console.test.ts`. Goal: stop finding dead Tools controls one release
> at a time.

## Problem

Releases 0.1.237–0.1.240 each shipped a fix for exactly ONE dead Tools control,
each discovered only after a human clicked it. All four shared one shape:

> a control is rendered from one input (a key, a catalog row) but its handler
> reads a SEPARATE piece of module-level state the entry point never populated, so
> the handler hits a silent `if (!x) return` and nothing happens.

Unit tests over the key-builder couldn't see it — both halves were individually
correct; the *wiring between render and handler* was wrong. Source-grep agreement
tests (already in the suite) catch the encoding half (attrEnc↔decode, attrEnc↔title)
but not the *state-population* half.

## Approach chosen: drive it, don't reason it

Add a **jsdom effect-based driver** to `console.test.ts`: mount the real
CONSOLE_HTML, stub only the routes the buttons call, then dispatch a real click on
the real `.tools-run-btn` (etc.) and assert an **observable effect** (a fetch to the
expected route, or a DOM mutation). A control that produces no effect is a finding.
This exercises the render→handler→state wiring end to end, which is exactly the
seam the four regressions lived in — and it runs in `npm test`, so the next such
bug fails CI instead of waiting for a human click.

Rejected alternatives: (a) more source-grep agreement tests — blind to unset shared
state; (b) a real headless browser (puppeteer) — heavier, non-deterministic, and no
better than jsdom for asserting handler effects.

## Findings (from driving every in-scope control)

- **FINDING 1 (dead control).** Cold Tools open renders **zero** Run buttons. A Run
  button only renders when `_toolRunKey` resolves the row against `skCatalog()`
  (`_skills`/`_commands`), but `showTools()`/`loadCapabilities()` load `/capabilities`
  alone and never populate that catalog. Until an unrelated background `refresh()`
  happens to run `renderSkillCatalog()` AND the panel is re-rendered, every runKey is
  `""` and no button appears — the class, one level earlier than the prior fixes (the
  button isn't even there to click). Fix: `loadCapabilities()` loads the catalog
  alongside `/capabilities`, so the button's existence is a property of the panel.

- **FINDING 2 (misdirected feedback).** `copySkill`/`publishSelected` run from inside
  the skill panel but wrote status to `#skStatus` — the right-rail Skills sidebar
  line, a different column the operator may have collapsed. The action fired but its
  "Copied…"/"Published…" confirmation landed offscreen. Fix: prefer the panel line
  `#skRunStatus`, fall back to the rail (the same pattern `runSelectedSkill` uses).

Everything else in scope produced an effect when driven — see the inventory in the
plan doc.

## Non-goals

No new store/primitive/product concept (Complexity Budget). Two devDeps added for
the test harness only: `jsdom` + `@types/jsdom`. No route/server changes.
