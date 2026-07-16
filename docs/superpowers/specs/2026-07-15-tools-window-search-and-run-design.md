# Tools Window: Search + Discoverable Params + Visual Run — Design

## Problem (operator ask, dispatched task)

Make the Tools window discoverable and runnable: a search box, per-tool parameter
display (name/type/required-optional/description), a visual run form (required =
text input, optional = pill toggle, complex/freeform = textarea), and a Run button.
Once working and tested, retire the right-sidebar skills/commands list — the Tools
window becomes the one place to find and run a tool.

No human is available to answer clarifying questions in this session (autonomous
self-improvement dispatch — see memory `project-hivematrix-self-improvement-loop`).
This doc records what was verified against the running code and the reasoning behind
every scope call, so a reviewer (the operator) can see why the shipped slice is what
it is.

## Current state (verified against HEAD `ef873d03`, working tree clean, 5 commits
ahead of origin)

Two independent "find + run a thing" surfaces exist today; the dispatch's four
features already exist, unevenly, split across them:

**A. Right sidebar catalog** (`skCatalog()` = `/skills` + `/commands`, `console.ts:3537`):
- Search: `#skQuery` → `skQueryInput()` → `renderSkillList()` (`console.ts:3593`)
  filters by name/description/kind/compat text, real-time, already works.
- Click a row → `selectSkill()` → `showSkillPanel()` renders one of two run forms:
  - `_libSkillPanelHtml` (`console.ts:3672`, library skills): named params
    (`s.params: string[]`, no required/optional or type data — see below) as plain
    text inputs, plus one freeform `<textarea>` when `s.hasInput`. Run via
    `runSelectedSkill()` → `POST /skills/:name/run`.
  - `_localCmdPanelHtml` (`console.ts:3717`, local slash-commands): a real options
    picker (`_cmdOptionsHtml`, `console.ts:4026`, built by the already-shipped
    `command-options-picker` work, commit `09077ab0`) — flag/value/choice chips
    (pill-toggle UI, exactly what the ticket asks for optional params), grouped
    "pick-one" sets, plus positional text inputs. Run via `runSelectedCommand()` →
    `POST /commands/run`.

**B. Tools window** (`/capabilities` API, `server.ts:435`; `renderToolsPanel()`,
`console.ts:7560`): a *read-only* inventory of native lane tools, Flash-only tools,
curated skill-tools, and the full skill library. Each row shows a schema summary
string (`toolsSchemaSummary`, required params suffixed `*`) and an expandable detail
— but **no search box, no Run button, no interactive param form**. It also **does
not include local slash-commands at all** — `/capabilities` only knows about
`native`/`flash`/`skill-tool`/`skill-library`; the local-command catalog the sidebar
shows under `source: 'local'` has no representation here.

So the dispatch is not "build this from scratch" — it's "merge B into a superset of
A, plus close A's own gaps," per its own "Replaces" section.

**Data model gap that matters for scope:** library skill params are
`params?: string[]` (`src/lib/skills/contracts.ts:109`) — names only, no type, no
required/optional flag, no description, no example. Checked two of the dispatch's
own worked examples directly: `get-weather` and `bible-study` SKILL.md declare *no*
`params` frontmatter at all; both rely on the skill's own prompt parsing freeform
`$ARGUMENTS` text (bible-study's "Step 0: Parse Invocation" step, in-markdown, not a
structured schema). The richer required/optional/typed model
(`CommandOptionsSpec`: flags, values, choices, positionals with a real `required`
boolean) exists **only** for local commands, not skills.

## Options considered

**1. Add a full structured param schema to skills** (name, type, required,
description, example — matching the ticket's literal wording for every tool kind).
Rejected: requires a new SKILL.md frontmatter field, parser changes, and touching
every one of the ~50 existing skills to backfill it, or leaving old skills
inconsistent with new ones. That's a new authoring-format concept, which AGENTS.md's
complexity budget gates behind a DECISIONS.md entry ("no new persistent
store/concept without naming what it replaces") — and there's no existing skill
whose *behavior* is broken by the current flat-string model, only its
UI-completeness. Out of proportion to a single budget-capped dispatch; flagged as a
follow-up, not built here.

**2. Build a third, parallel run-UI inside the Tools window**, independent of the
sidebar's existing `_libSkillPanelHtml`/`_localCmdPanelHtml`. Rejected: violates
"reuse the shared scaffolding, don't re-roll it" for no benefit — the existing
render functions already implement three of the four literal UI pieces the ticket
asks for (pill toggles, freeform textarea, positional inputs), tested and shipped.
Duplicating them would double the maintenance surface for the *same* two POST
endpoints.

**3. Make the Tools window a superset view over the existing catalogs and existing
run forms, closing the two real gaps (missing local-command entries in
`/capabilities`; positionals rendered identically regardless of required/optional
even though `CommandOptionsSpec.positionals[].required` already carries that bit).**
Chosen. Concretely:
   - Extend `GET /capabilities` with a 5th group, `local-command`, built from the
     same `scanLocalCommands()` the `/commands` route already calls
     (`server.ts:3884`) — no new data source, just a second consumer of an existing
     one.
   - Give the Tools window its own search box, same filter semantics as
     `renderSkillList` (name/description/kind, real-time), applied across all five
     groups.
   - Make rows in the *runnable* groups (`skill-tool`, `skill-library`,
     `local-command`) clickable into the **existing** `showSkillPanel()` /
     `_libSkillPanelHtml` / `_localCmdPanelHtml` / `runSelectedSkill` /
     `runSelectedCommand` code paths — i.e. the Tools window becomes a second
     entry point into the same, already-tested run form, not a new one. `native`
     and `flash` rows stay informational/read-only: these are the model's own
     function-calling tools, invoked by the assistant mid-conversation, not
     something a human runs standalone with a Run button — consistent with the
     ticket's own worked examples (bible-study, weather, file-count are all
     skills, never a raw lane tool).
   - Fix the one real required/optional UI gap that already has the data to back
     it: `_cmdOptionsHtml`'s positionals render as identical plain-text inputs
     today regardless of `required`; split them so a required positional stays a
     plain always-visible input (can't be missed) and an optional positional
     renders as a toggle-pill consistent with the flag/value/choice controls next
     to it — matching the ticket's "required: text input; optional: greyed
     pill/toggle" spec exactly, for the one tool kind where the data already
     supports the distinction.
   - For library skills, keep the honest current contract: named `params` are
     effectively required-by-declaration today (no skill renders one as optional),
     so keep them as text inputs; the freeform `hasInput` textarea already *is*
     the ticket's "free-form input for complex inputs" bucket — no fabricated
     required/optional split where the data model doesn't have one.

## Sidebar removal — scoped as a gated, final step

The ticket's "Replaces" section says to remove the sidebar list "once working and
tested." Treating this literally as automatic once code lands would be wrong here:
the sidebar is currently the *only* way to reach the run forms at all, and this is
a single unsupervised, budget-capped session with no live QA. So sidebar removal is
the **last** task in the plan, explicitly gated on the prior tasks' own verification
gates (typecheck/test/scope-wall) passing clean — not because the instruction is
being second-guessed, but because deleting the only existing entry point to
skill/command execution deserves to land only once the replacement path in the same
commit has test coverage proving it reaches the same two endpoints. It is a single,
easily-revertible commit either way (unpushed, operator reviews before release), so
if budget runs out before this step, later tasks are simply left undone and
recorded precisely (per `feedback-verify-before-redoing-stale-dispatch`'s
"partial completion" precedent, `2026-07-15-window-state-restoration`) rather than
rushed.

## Scope NOT built (follow-up candidates, recorded for a future dispatch)

- Structured per-skill param schema (types, required/optional, examples) — Option 1
  above. Would need a DECISIONS.md entry first.
- "Parameter examples / default values" beyond what already exists
  (`argumentHint` placeholder text, positional `title` tooltips from
  `options:` frontmatter `description`) — no new example-string field invented.

## Testing approach

`console.test.ts` has no jsdom — plain string/regex assertions against the exported
`CONSOLE_HTML` template (see `2026-07-15-window-title-cleanup-design.md` precedent).
New tests follow the same style: assert the search input/filter function exists and
is wired, assert runnable-group rows call into `selectSkill`-equivalent, assert
`_cmdOptionsHtml` emits a plain input for required positionals and a toggle-pill for
optional ones. Backend `/capabilities` change gets a request-level test in
`server.test.ts` (or wherever existing `/capabilities`/`/commands` route tests live)
asserting the new `local-command` group is present and shaped like
`scanLocalCommands()`'s output.

## Verification gates

`npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` — all must be clean.
No local-model files touched, so `qwen-readiness.mts` is not required.
