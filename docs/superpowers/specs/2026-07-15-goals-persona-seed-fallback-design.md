# GOALS.md Persona Seed Fallback — Design

## Context

Dispatched sprint task: "GOALS.md database sync after update — Ensure goals
persist through app updates — Auto-import from GOALS.md if database is empty
— Test: Update app, verify goals are present."

Checked scope against what's already shipped before touching anything.
"Ensure goals persist through app updates" is already fully solved:
`src/lib/db/self-heal.ts` exports `healEmptiedTables()`
(`HEALABLE_TABLES = ["goals", "message_identities"]`), invoked at boot in
`src/daemon/index.ts` right after `getDb()`, restoring rows into an empty
live table from the newest pre-update backup that still has rows for it.
Read both files this session and confirmed the logic matches the shipped
description exactly (released, tagged 0.1.203) — not touching it.

The genuinely missing piece — this design's actual scope — is the tier-2
fallback: when `goals` is empty **and** `healEmptiedTables()` finds no backup
with usable rows either (a fresh machine's first run, or every backup
happens to also be hollowed out), nothing currently seeds `goals` from the
operator's own `persona/GOALS.md`. The only existing "import from GOALS.md"
behavior is conversational/on-demand (the AI assistant importing goals when
explicitly asked — a distinct, existing code path, out of scope here). This
design adds an automatic, boot-time, best-effort seed as the next fallback
tier after self-heal.

## Investigation

**GOALS.md format contract.** `src/lib/flash/distill.ts` uses
`GOALS_SECTION_SPEC`, defined in `src/lib/brain/persona-section.ts` — the one
shared implementation of the "dated persona-file section" pattern used by
USER.md, GOALS.md, and SOUL.md alike:

```ts
export const GOALS_SECTION_SPEC: DatedSectionSpec = {
  header: "## Active goals",
  seed: "# GOALS — what the operator is working toward\n\nMaintained by the agent from real conversations. Edit freely; the agent anchors briefs and priorities to this file.",
  maxItems: 40,
};
```

`mergeDatedSection` (the write side) appends bullets as `- YYYY-MM-DD: <text>`,
deduped by normalized containment, capped at the newest 40. This matches the
real file sampled at `~/_GD/brain/persona/GOALS.md` exactly.

Critically, `persona-section.ts` **already exports a read-side pure function
for this exact contract**: `parseSectionBullets(content: string): string[]`
strips a leading `- `, then a leading `YYYY-MM-DD:` prefix, trims, and drops
blanks — i.e. "markdown string in, flat list of goal-title strings out,"
precisely what this feature needs. It is not speculative or unused — it's the
established read-side companion to `mergeDatedSection` (covered by
`persona-section.test.ts`: dashless bullets, dated bullets, non-bullet prose
all already exercised) and **already used in production on this exact file**:
`src/lib/voice/command-turn.ts`'s `readSpokenGoals()` does
`parseSectionBullets(readFileSync(join(root, "persona", "GOALS.md"), "utf-8"))`
verbatim. That's a second, independent precedent for "read the whole GOALS.md
file, hand it to `parseSectionBullets`" — confirming reuse here is the
established pattern, not a guess.

**Brain-root resolution.** `configuredBrainRootDir()` in
`src/lib/brain/settings.ts` is the one shared resolver (~15 call sites across
`brain/`, `flash/`, `voice/`, `skills/`, `embeddings/`, `youtube/`,
`orchestrator/`) — reads `~/.hivematrix/config.json`'s `memory.brainRootDir`
(normalized, `~`-expanded), defaulting to
`DEFAULT_MEMORY_SETTINGS.brainRootDir = "~/_GD/brain"` when unset, and
returns `null` when memory is disabled. Every existing GOALS.md reader
(`day-brief.ts:121`, `weaver-audit.ts:62`, `command-turn.ts:710`) calls
`configuredBrainRootDir()` then inline-joins `persona/GOALS.md` — there is no
shared path constant; the join is repeated at each call site by convention.
This design follows that same convention rather than inventing a new shared
path constant.

**Goals DB layer.** `src/lib/goals/store.ts` exports
`upsertGoal(input: UpsertGoalInput): Goal` (handles id generation via
`generateId()`, `createdAt`/`updatedAt` timestamps, and defaults — `cadence`
defaults `"weekly"`, `status` defaults `"active"`) and
`listGoals(opts): Goal[]`. Schema (`db/index.ts`, `v35` migration):
`title TEXT NOT NULL`, `cadence TEXT NOT NULL DEFAULT 'weekly'`,
`status TEXT NOT NULL DEFAULT 'active'`, `sortOrder INTEGER NOT NULL DEFAULT 0`.
`getDb()` is a process-global singleton (`db/index.ts`, `g.__hivematrixSqlite`)
— `upsertGoal`/`listGoals` calling it internally will transparently share the
same connection `daemon/index.ts` already opened before self-heal runs; no
second connection, no re-migration risk.

**Daemon integration point.** `src/daemon/index.ts`'s `main()`: `getDb()` →
self-heal's try/catch block (`healEmptiedTables` + `message_identities`
high-water-mark reset) → connectivity policy init. The self-heal block is the
exact shape to mirror: dynamic `import()`, wrapped in try/catch,
`console.warn` on action taken, `console.error` on failure, never re-thrown.
This design's fallback slots in as one more such block immediately after
self-heal's.

**Test conventions.** `src/lib/goals/store.test.ts` isolates
`process.env.HOME` to a fresh `mkdtempSync` dir once at module load, then
calls the real store functions directly (no injected `db` param) with tests
written to tolerate shared state across the file (`.some()`/`.find()`
assertions, never exact-count assertions). But this feature has cases that
specifically hinge on the table being *genuinely empty vs. non-empty* at the
moment `seedGoalsFromPersonaIfEmpty` runs — shared, un-reset state across
tests in one file would let an earlier test's rows silently make a later
"handles a missing GOALS.md file" case pass for the wrong reason (short-
circuiting on "table not empty" instead of exercising "file missing").
`src/lib/messagebee/store.test.ts` shows the more defensive, already-used
precedent for exactly this need: `HIVEMATRIX_DB_PATH` (takes priority over
`HOME` in `db/index.ts`'s path resolution) + the exported test-only
`_resetDbForTests()` to point the DB singleton at a fresh empty file per
test. This design's test file uses that pattern, not `goals/store.test.ts`'s
simpler one, because it needs true per-test isolation that the goals store's
own test file happens not to need.

## Non-Goals

- Not touching `healEmptiedTables()` / `self-heal.ts` — already correct,
  already shipped, out of scope per the dispatch brief.
- Not touching the conversational/on-demand "import from GOALS.md" tool path
  (`goal_upsert` / `CAPABILITY_DOCTRINE`) — different trigger (explicit
  operator ask vs. automatic at boot), different code path, unrelated to this
  design.
- Not adding a "seeded before" marker/flag. The empty-table check is the same
  one-shot contract `healEmptiedTables()` already relies on ("empty == data
  loss, non-empty == leave alone"); a second concept for the same guarantee
  is exactly the quiet complexity AGENTS.md's Complexity Budget flags.
- Not truncating the GOALS.md content read (unlike `day-brief.ts`'s
  `defaultReadGoalsPersona`, which slices to 4000 chars for LLM prompt-budget
  reasons). This feature needs the *complete* bullet list, not a
  prompt-sized snippet — truncating risks silently dropping legitimate goals
  near a 40-bullet, ~4000-char file. `command-turn.ts`'s `readSpokenGoals`
  (the closer analog: also extracts a structured list, not prompt context)
  doesn't truncate either.
- No new persistent store, table, or column — reuses `goals` exactly as-is.
- No release/build/publish step. Operator releases.

## Approaches

**A. New sibling module `src/lib/goals/persona-seed.ts`**, reusing
`parseSectionBullets` + `configuredBrainRootDir` + `upsertGoal`/`listGoals`;
one new try/catch block in `daemon/index.ts` right after self-heal's.
Two exports: a thin pure wrapper `parseGoalTitlesFromGoalsMd(content): string[]`
(documents the contract this feature depends on, fully unit-testable,
delegates its entire body to `parseSectionBullets`) and the orchestration
`seedGoalsFromPersonaIfEmpty(brainRoot?): { seeded: number }` (internal
empty-check via `listGoals()`, internal try/catch mirroring
`learnIntoPersonaFile`'s `catch { return 0 }`, calls `upsertGoal` per parsed
title). Mirrors `self-heal.ts`'s file-per-concern layout (it lives beside
`store.ts`, the module it depends on, exactly as `self-heal.ts` lives beside
`db/index.ts`). Smallest diff: one new file, one new test file, ~10 added
lines in `daemon/index.ts`.

**B. Extend `healEmptiedTables()` itself** to also read GOALS.md as a third
healing source. Rejected: `self-heal.ts` is deliberately single-purpose —
restoring rows from a **sqlite backup** by shared-column mapping. GOALS.md is
a structurally different source (markdown, not a table), and `upsertGoal`
reuse (the right way to get id/timestamp/default handling) would mean
`self-heal.ts` importing `goals/store.ts` — an inverted, new dependency
direction for a file that's currently a generic, domain-agnostic DB utility.
Bloats a small, clean, already-well-tested file with a conceptually unrelated
fallback source.

**C. Inline the parse-and-seed logic directly in `daemon/index.ts`**, no new
lib file. Rejected: every other piece of boot logic in `daemon/index.ts`
(`migrateConfig`, `planBoot`, `backupDatabase`, `healEmptiedTables`,
`resetLastRowid`, …) is a dynamically-imported `@/lib/*` function — the
entrypoint contains zero inline business logic today, by consistent
convention. Inlining ~15-20 lines here breaks that convention and leaves no
unit-testable seam: the brief requires the parsing to be "a pure
function... fully unit-testable with no DB/filesystem," which is impossible
to satisfy cleanly for code living directly in an untested entrypoint
script.

## Recommendation

**A.** Reuses three already-correct, already-tested pieces of scaffolding
(`parseSectionBullets`, `configuredBrainRootDir`, `upsertGoal`/`listGoals`)
instead of duplicating any of them, adds exactly one new file pair (mirroring
the existing `store.ts`/`store.test.ts` and `self-heal.ts`/`self-heal.test.ts`
sibling-file convention already used twice in this same area of the
codebase), and the daemon-side change is a copy-shaped sibling of the
self-heal block already sitting right above it — a reviewer who understands
that block for free understands this one.

One judgment call worth naming: `sortOrder`. `upsertGoal` defaults
`sortOrder` to `0` when omitted, which would leave every seeded goal tied and
order-of-insertion-dependent under `listGoals`'s
`ORDER BY sortOrder ASC, createdAt ASC` (ties are plausible since seeding
happens in a tight synchronous loop and `createdAt` timestamps can collide at
millisecond resolution). GOALS.md's bullets are already meaningfully ordered
(oldest-dated first, per the real sample). Passing
`sortOrder: <index in the parsed list>` for each seeded goal preserves that
order deterministically in the Goals panel at zero extra cost — worth doing,
not worth a design alternative of its own.

Second judgment call: per-title error isolation. `seedGoalsFromPersonaIfEmpty`
wraps the whole operation in one outer try/catch (file read, brain-root
resolution, parsing — mirrors `learnIntoPersonaFile`'s `catch { return 0 }`
scope) but *also* wraps each individual `upsertGoal` call in its own
try/catch, so one bad row (should not happen given
`parseGoalTitlesFromGoalsMd` already filters blanks, but `title TEXT NOT NULL`
makes a defensive check cheap insurance) can't silently erase credit for —
or leave inconsistent bookkeeping about — goals already written before it.
This mirrors `self-heal.ts`'s own per-table/per-backup catch granularity
rather than a single flat try/catch around the whole loop.

## Verification

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

New tests: `src/lib/goals/persona-seed.test.ts` — pure-function coverage of
`parseGoalTitlesFromGoalsMd` (normal multi-bullet file, missing header,
empty file, bullets without a date prefix, non-bullet prose mixed in,
leading/trailing whitespace) plus temp-DB integration coverage of
`seedGoalsFromPersonaIfEmpty` (seeds an empty table from a temp GOALS.md;
does not fire/duplicate when the table already has rows; handles a missing
GOALS.md file and a `null` brain root without throwing) — full details in the
plan doc.

No live "update the app" test is possible in this non-interactive session
(no packaging/release step, per this loop's hard boundary of fix-and-commit
only) — verification relies on the unit/integration tests plus the daemon
boot code path being identical in shape to the already-shipped, already-soaked
self-heal block sitting directly above it. State this limitation explicitly
when reporting completion.

No release/build/publish step. Operator releases.
