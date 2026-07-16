# Sidebar "Brain" → "Memory" Label Rename — Design

## Problem (operator ask, dispatched task)

The left sidebar nav button (`src/daemon/console.ts`, `id="brainNav"`) currently reads
"🧠 Brain". The operator wants the visible label changed to "Memory" — described as
more intuitive terminology that aligns with how the operator refers to the knowledge
base/brain-docs system. The ticket explicitly scopes this as a label/text change only;
the icon may stay or change "if appropriate."

No human is available to answer clarifying questions in this session (autonomous
self-improvement dispatch — see memory `project-hivematrix-self-improvement-loop`).
This doc records what was verified against the running code and the reasoning behind
the choice.

## Current state (verified against HEAD `cb0fcb45`, up to date with origin/main; two
pre-existing unrelated untracked doc files from an earlier same-day dispatch present
but unaffected)

- `console.ts:1812` —
  `<button class="ov-nav oc-nav" id="brainNav" onclick="showBrain()">🧠 Brain</button>`
  — the exact sidebar element the ticket describes, in the `.col.board` left nav
  alongside Overview/Chat/Roles/Tools/Goals (`console.ts:1809-1815`).
- The rest of the codebase already calls the destination panel "Brain / Memory Review"
  in multiple places (panel title `console.ts:7057`, section comment `console.ts:925`)
  — the sidebar label is the one remaining spot still saying only "Brain," so this
  brings the nav label in line with naming that's already half-migrated elsewhere.
- `id="brainNav"`, `onclick="showBrain()"`, and every internal function/variable
  (`showBrain`, `renderBrainPanel`, `_brainState`, `/brain/*` endpoints, etc.) are
  internal identifiers, not user-visible text — the ticket scope is "label/text change
  only," so these stay untouched. Renaming them would be a much larger, unrequested
  refactor (~40+ call sites per grep across `console.ts`/`console.test.ts`) for zero
  additional user-visible benefit.
- `console.test.ts:984` already asserts
  `id="brainNav"[^>]*onclick="showBrain\(\)"` (attributes, not label text) — unaffected
  by a text-only change. No existing test asserts the literal visible button text, so
  nothing today already covers (or could be broken by) the label itself.
- Grepped `src/` broadly for other user-visible "Brain" labels (quoted strings, `>Brain<`
  markup, icon-adjacent text) — the only other hit is an unrelated `"Brainstorm"` workflow
  label in `src/lib/types/workflow.ts`, a different feature. The sidebar nav is
  data-inlined per-button (not driven by a shared array), so there is exactly one place
  in the UI that renders this text.
- No spec/plan/commit anywhere in git history, `docs/superpowers/`, or
  `~/_GD/brain/projects/hive/known-issues.md` already covers this — confirmed via
  `git log`, directory listing, and a known-issues grep. Genuinely new work, not a
  stale/duplicate dispatch.

## Options considered

1. **Text-only swap, keep the 🧠 emoji icon.** `🧠 Brain` → `🧠 Memory`. Smallest
   possible diff; a brain emoji reads fine next to "Memory" (a brain is a reasonable
   icon for a memory/knowledge-base feature), and the ticket explicitly treats the icon
   as optional ("keep brain icon or update icon if appropriate") — keeping it is the
   more conservative, defensible reading absent any stated operator preference for a
   specific replacement icon.
2. **Swap text and icon** (e.g. to something like 💾 or 📚). Rejected: the ticket
   presents the icon change as discretionary, not requested. Picking a "more
   appropriate" icon is a subjective call with no clearly-right answer, and it's
   avoidable, unrequested polish — against the complexity-budget preference for the
   smallest defensible change.
3. **Also rename the internal `brainNav`/`showBrain`/`_brainState`/`/brain/*`
   identifiers and endpoints for full consistency.** Rejected: the ticket explicitly
   scopes this as "label/text change only." A full identifier rename touches ~40+ call
   sites, and the `/brain/*` HTTP endpoints plus the `~/_GD/brain/` on-disk folder
   concept are a separate, older, much larger naming surface entirely out of scope for
   a sidebar-label ticket.

## Chosen approach

Option 1. Swap the visible sidebar text from "Brain" to "Memory", keep the 🧠 icon,
touch no identifiers/endpoints/other panels. One line in `src/daemon/console.ts`, one
new test in `src/daemon/console.test.ts` scoped narrowly to the nav button's visible
text (not a blanket `/Brain/` check — "Brain" legitimately still appears elsewhere as
an identifier and panel-title substring, e.g. the existing "Brain / Memory Review"
panel title, which is out of scope and must keep working).

Scope: one line in `src/daemon/console.ts` (the nav button text), one new test in
`src/daemon/console.test.ts`. No other files touched; `scope-wall.mjs` should be a
no-op (no persistent store, no new concept) — run it anyway as a verification gate.
