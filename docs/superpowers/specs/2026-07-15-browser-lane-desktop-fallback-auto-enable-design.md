# Browser Lane desktopFallback Auto-Enable — Design

## Context

Dispatched task: "Browser Lane desktopFallback auto-config — When first
authenticated site is added, auto-enable browserLane.desktopFallback."

The feature this exposes already fully exists and is tested:
`readBrowserBeeDesktopFallbackEnabled()` (`src/lib/browser-lane/jobs.ts:424-434`)
checks two possible config locations — canonical `config.browserLane.desktopFallback`
and legacy `config.browserbee.desktopFallback` — defaulting to `false` (off)
when neither is set. Today this is 100% manual: the operator must hand-edit
`~/.hivematrix/config.json`. DECISIONS.md's 2026-06-14 Browser Lane entry
frames this explicitly as a deliberate, opt-in reliability trade-off ("lower
reliability, but the only working path without an OpenAI API key") — the
flag exists for operators who've hit the Codex Computer Use
subscription-account wall and know they want the degraded local-desktop
fallback. The gap: an operator who never discovers the flag never benefits
from it. This design adds exactly one automatic trigger — set the canonical
key the moment the operator adds their first authenticated browser site —
and touches nothing about `jobs.ts`'s read/decision logic.

## Investigation

**Hook point.** `upsertBrowserSite()` (`src/lib/browser-lane/store.ts:118`)
is the sole write path into the `browser_sites` table (schema:
`src/lib/db/index.ts:420-434`). It's an upsert
(`INSERT ... ON CONFLICT(_id) DO UPDATE ...`), so a call can be either a
brand-new row or an update to an existing one.

**"First authenticated site" is exactly "table had zero rows before this
call."** `BrowserSite.authStrategy`
(`src/lib/browser-lane/contracts.ts:26`) is one of `"manual_session" |
"keychain_password" | "google_sso" | "microsoft_sso"` — there is no
anonymous/public strategy, so every row in `browser_sites` is inherently an
authenticated site. That collapses "first authenticated site added" to a
single, cheap, unambiguous check: `SELECT COUNT(*) FROM browser_sites` reads
`0` immediately before the `INSERT`/`ON CONFLICT` statement runs. Because the
table can only be empty before an insert of a genuinely new row (an empty
table has nothing to conflict with), this check can never misfire on an
update to an existing row.

**Config read/write pair.** `loadHiveConfig()` / `saveHiveConfig(config)`
(`src/lib/central/config.ts`) are the pair to reuse — not
`readHiveConfig()` (`src/lib/brain/settings.ts`, used internally by
`jobs.ts`), which has no atomic-write counterpart. `saveHiveConfig` writes via
tmp-file + `renameSync` specifically because out-of-process readers (the
PreToolUse approval hook, the heartbeat) must never observe a half-written
config — the file header comment says this explicitly. Any auto-enable write
must go through `saveHiveConfig`, never a hand-rolled `writeFileSync`.

**Must-not-override rule.** Per DECISIONS.md, this flag is a deliberate
operator trade-off, not a default HiveMatrix should push everyone toward.
Auto-enable must act *only* when the operator has never touched the setting
either way: both `config.browserLane?.desktopFallback` and
`config.browserbee?.desktopFallback` must be `undefined`. If either key is
present — `true` or `false`, canonical or legacy — the config is left
completely alone, including the case where the canonical key is already
`true` (a no-op, not a redundant `saveHiveConfig` call, per the brief's
explicit ask to keep that atomic-rename side effect quiet/minimal).

**Test conventions surveyed.**
- `src/lib/browser-lane/store.test.ts` uses `HIVEMATRIX_DB_PATH` + `@/lib/db`'s
  `_resetDbForTests()`, but resets **once** at module scope (a `before()`
  shared across every test in the file, which then accumulates rows across
  tests). This feature's cases hinge on the exact row count immediately
  before a specific call, so reusing that file's shared-DB style would risk
  an earlier test's rows silently changing what a later "first site" case
  actually exercises. `src/lib/goals/persona-seed.test.ts` (shipped today,
  same repo) faced the identical shared-state problem and solved it with a
  per-test `freshDb()` helper that mints a new temp DB file and calls
  `_resetDbForTests()` inside each test that needs true isolation — this
  design follows that precedent instead.
- No test file in the repo calls `saveHiveConfig`/`loadHiveConfig` directly
  (grepped; the one hit in `flash-mcp.test.ts:489` is a comment, not a call).
  The closest real precedent for faking `~/.hivematrix/config.json` is
  `flash-mcp.test.ts:719-725,744`: `mkdtempSync` a temp dir, write
  `<tmp>/.hivematrix/config.json`, point `process.env.HOME` at it (Node's
  `os.homedir()` reads `HOME` first on POSIX), restore `process.env.HOME` in
  a `finally`/`after`. This design reuses that exact technique rather than
  inventing a new one, since `central/config.ts` has no test seam of its own.

## Non-Goals

- Not touching `readBrowserBeeDesktopFallbackEnabled` or any backing-decision
  logic in `jobs.ts` — the read side is correct and already tested.
- Not migrating the legacy `browserbee.desktopFallback` key to the canonical
  one, or writing to the legacy key at all — always writes the canonical
  `browserLane.desktopFallback` only, per the brief.
- Not adding any operator-facing notification/UI that auto-enable fired.
  Not requested; the value is picked up the next time a Browser Lane job's
  backing decision runs.
- Not adding a way to "undo" or re-arm auto-enable. The gate is the same
  one-shot, additive-only contract already established for
  `healEmptiedTables()`/`seedGoalsFromPersonaIfEmpty()` in this repo: acts
  once when the trigger condition is genuinely met, never revisits a config
  key the operator (or a prior run of this same feature) has already set.
- No new persistent store, table, or column — reuses `browser_sites` exactly
  as-is (one read-only `COUNT(*)`).
- No release/build/publish step. Operator releases.

## Approaches

**A. New sibling module `src/lib/browser-lane/desktop-fallback-auto-enable.ts`**,
exporting one function, `autoEnableDesktopFallbackOnFirstSite(): { enabled:
boolean }`, that contains the entire must-not-override config read/write
decision (no DB access of its own). `store.ts`'s `upsertBrowserSite` computes
the one DB-dependent fact this feature needs — `isFirstSite` via `COUNT(*)`
before the `INSERT` — and calls the new function only when true, after the
insert (and any credential-row insert) has completed successfully. Mirrors
today's `goals/persona-seed.ts` precedent shape exactly: a small, DB-free,
independently-unit-testable sibling module plus a minimal call-site edit.

**B. Inline the whole thing directly in `store.ts`.** Rejected: every
existing export in `store.ts` is DB CRUD — reads/writes rows, returns
row-shaped data. This feature has zero DB dependency of its own (it's pure
config-file logic); folding it into `store.ts` muddies that file's one clear
responsibility and forces its config-matrix unit tests (which need no DB
setup at all) to live alongside a test file built around one shared DB per
file. A dedicated module keeps `store.ts`'s job untouched and gives the
config logic a test file that can be 100% DB-free where it doesn't need one.

**C. Add the write-side logic to `jobs.ts`, beside
`readBrowserBeeDesktopFallbackEnabled`**, with `store.ts` importing it from
there. Rejected: the brief is explicit that `jobs.ts`'s read logic is not to
be touched, and while adding a new sibling export wouldn't touch that logic,
`jobs.ts` today is oriented entirely around job dispatch/backing-decision
types — none of its exports read config only to write it back. This would
also introduce a new dependency edge (`store.ts` → `jobs.ts`) that doesn't
exist today in either direction, for no benefit over a standalone leaf
module that needs nothing `jobs.ts` provides.

## Recommendation

**A.** Reuses the exact `loadHiveConfig`/`saveHiveConfig` pair the brief
calls for (atomic write intact), keeps `store.ts`'s only new responsibility
to the one fact only it can cheaply know (row count before insert), and
gives the must-not-override decision matrix a small, dependency-free,
directly-unit-testable home — a reviewer can understand the whole feature
from one new ~40-line file plus a three-line call-site edit.

One judgment call: the "no redundant write" requirement for "canonical
already `true`" falls out of the *same* single check as "canonical already
`false`" — both are just "the canonical key is not `undefined`." No separate
branch is needed or written; case (e) in the plan's test matrix exists to
prove this collapse is correct, not because the implementation needs distinct
logic for it.

Second judgment call: `autoEnableDesktopFallbackOnFirstSite` takes no
parameters and always calls the real `loadHiveConfig`/`saveHiveConfig`
(no dependency-injected reader/writer). The brief's own emphasis — reuse
these two functions, not a mock, so the atomic-rename write is genuinely
exercised — argues against adding a DI seam here; tests get equivalent
control by pointing `HOME` at a temp directory (the established
`flash-mcp.test.ts` technique), which exercises the real function pair
end-to-end rather than a substitute.

## Verification

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

New test file: `src/lib/browser-lane/desktop-fallback-auto-enable.test.ts` —
pure config-matrix coverage of `autoEnableDesktopFallbackOnFirstSite()` (no
config file at all; both keys absent with unrelated config preserved;
canonical `false` left alone; canonical `true` left alone with a
zero-write/mtime-unchanged assertion; legacy `true`/`false` each leaving the
canonical key uncreated) plus `upsertBrowserSite` wiring coverage (first site
into an empty table auto-enables; a second site added to a non-empty table
performs no config write at all, verified by resetting config to `{}` after
the first insert so a buggy re-trigger would be observable rather than masked
by the override guard) — full detail in the plan doc.

`qwen-readiness.mts` not required — this touches `src/lib/browser-lane/`
only, not `src/lib/local-model/`, `qwen-profile.ts`, or `models/backends.ts`.

No release/build/publish step. Operator releases.
