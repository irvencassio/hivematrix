# Goals Data Loss — Root Cause + Fix Design

> Self-improvement task, spawned via HiveMatrix's `workflow:"work"` Task kind.
> Operator-facing bug report: "HiveMatrix Goals view shows 'No goals yet' after
> app update, despite goals existing in GOALS.md." Running autonomously
> (headless `claude -p` daemon task, no live approver in this run) — this doc
> records the brainstorm findings and the decision made, for the operator to
> review after the fact. Per AGENTS.md: **do not release; the operator releases.**

## 1. What actually happened (confirmed from evidence, not the bug report's hypotheses)

The bug report's own root-cause hypotheses (migration wiped the table / goals
never persisted / stale cached bundle / import logic never ran) are all
**wrong**, checked in order:

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Migration cleared the goals table | **No** | `_migrations_applied` ledger is append-only and idempotent by design (every `CREATE TABLE` is `IF NOT EXISTS`; see `src/lib/db/index.ts` `runMigrations` doc comment). No migration in `MIGRATIONS` drops or truncates `goals`. |
| Goals were never persisted before the update | **No** | The last-known-good local backup (`~/.hivematrix/backups/hivematrix-preupdate-2026-07-13T09-58-12-356Z.db`) has 2 real goal rows, correctly persisted. |
| App is loading a stale cached DB snapshot | **No** | The live DB (`~/.hivematrix/hivematrix.db`) really does have 0 rows in `goals` right now. This is real data loss, not a UI/cache issue. |
| Auto-import from GOALS.md never runs on startup | **Partially true, but pre-existing** — see §1.2, not the cause of *this* incident. |

### 1.1 Real root cause: a test suite wiped the live production database

`~/.hivematrix/hivematrix.db` is the **same file** used by both the running
HiveMatrix daemon and — until commit `03fbd5ba` (2026-07-14T21:58 -04:00) —
by two test suites that called `getDb()` and then ran `DELETE FROM <table>`
cleanup against whatever database `getDb()` happened to resolve to, without
first pinning it to a temp dir:

- `src/lib/messagebee/send-cap.test.ts`
- `src/lib/orchestrator/directive-dispatch-cap.test.ts`

`resolveDbPath()` (`src/lib/db/index.ts:11`) falls back to
`~/.hivematrix/hivematrix.db` — the real path — whenever `HIVEMATRIX_DB_PATH`
isn't set and `HOME` hasn't been overridden. On this machine, that real path
*is* the production daemon's database. So a bare `npm test` run on this dev
machine (the release gate, per the fix commit's own message) opened, ran
migrations against, and deleted from the live DB.

Commit `03fbd5ba`'s own message confirms this mechanism (it was written by
Opus 4.8 in an earlier session, fixing 2 of the files): *"a bare `npm test`
… ran them against the live hivematrix.db — wiping the real per-run send
ledger … and applying migrations out-of-band."*

**Timeline** (all times -04:00 local, matching commit timestamps):
1. **07-13 09:58** — last-known-good local backup: 2 goals, 93 tasks, 837
   `flash_turns`, 43 `feedback` rows, 4 `directives`, 3 `work_packages`, etc.
   all present and intact.
2. **07-14, sometime between 09:58 (07-13) and 21:58** — during active
   development on the messagebee duplicate-send fix (commits `cb7c6b26`
   14:55 → `ec03eb06` 21:49), `npm test` was run locally at least once
   *before* the isolation fix existed, and `send-cap.test.ts` /
   `directive-dispatch-cap.test.ts` wiped `message_send_cap` and
   `directive_dispatch_cap` — and, going by which other tables ended up
   empty, other suites' own per-file cleanup logic likely did the same to
   their tables in the same run(s). This is the actual data-loss event.
3. **07-14 21:58** — commit `03fbd5ba` isolates those two suites to a temp DB
   (good fix, but scoped to the two files someone happened to be touching —
   not a sweep for the same pattern elsewhere, and no guard against a *future*
   file making the same mistake).
4. **07-14 22:00** — release 0.1.202 (commit `58323407`) ships.
5. **07-14 22:08 (= 07-15T02:08Z)** — the app's own pre-update backup step
   runs ahead of applying 0.1.202, and faithfully captures what was *already*
   an empty database. The backup mechanism itself is not at fault — it did
   its job; there was nothing good left to back up by the time it ran.

**Full blast radius** (comparing the 07-13 good backup to the live DB today):
wiped tables included `goals` (2), `goal_checkins` (0 anyway), `tasks` (93),
`directives` (4), `directive_criteria` (4), `runs` (3), `run_journal` (43),
`feedback` (43), `task_telemetry` (198), `flash_sessions` (36),
`flash_turns` (837 — chat/voice history), `work_packages` (3),
`work_package_items` (12), `usage_totals` (28), `message_channels` (2),
`message_identities` (4), `coo_dispatch_audit` (1). The live DB has been
organically repopulating since (15 tasks, 5 feedback, 79 flash_turns as of
this writing) through normal use, but **goals stayed at 0** because nothing
in normal operation re-creates a goal on its own.

**This was never a "goals bug."** It surfaced as one because the Goals panel
is what the operator looks at daily for the accountability loop. The same
incident quietly erased ~40 hours of task history, chat/voice transcripts,
and feedback scoring. I'm scoping the *code fix* to what the task asked
(goals resilience + the actual root cause, which protects every table), but
flagging the wider loss honestly rather than only fixing what was reported.
See §4 (out of scope) for what I'm deliberately not doing about the rest of
the wiped data without operator sign-off.

### 1.2 Secondary, pre-existing finding: no GOALS.md → structured-goals sync

Even in the last-known-good state (07-13, before the wipe), the structured
`goals` table only ever had 2 rows, while `persona/GOALS.md` (the operator's
free-form, agent-maintained goal ledger — real path is
`~/_GD/brain/persona/GOALS.md`; the bug report's `~/brain/persona/GOALS.md`
doesn't exist) has 13 dated bullets. This is by original design — see
`src/lib/feedback/scoreboard.ts`: *"GOALS.md is the aspirational list; the
measurable objectives in HiveMatrix are…"* the structured store. They're two
intentionally distinct things (aspirational prose ledger vs. actively
tracked goals with cadence/check-ins), and the existing chat tool text
(`src/lib/orchestrator/lane-tools.ts:568`, `src/daemon/console.ts:3222`)
already invites the operator to bridge them on demand: *"ask to import goals
from GOALS.md."*

That said, the bug report is right that this **shouldn't require operator
action** when the structured store is unexpectedly empty — an empty Goals
panel silently breaks `daily_review`, `goal_checkin`, and
`weaver-daily-audit`, which is a bad failure mode regardless of *why* it's
empty. So this needs a startup self-heal, independent of the root-cause fix
in §1.1.

One more detail worth flagging (not fixing here — see §4): GOALS.md itself
has accumulating near-duplicate entries (three separate dated lines for the
"$500K ARR" goal, four for "Engine 1 / $25K retainer," two for "annuity
licensing" — each added on a different day with different wording). The
`distill.ts` merge-into-GOALS.md path is commented as "dated/deduped/bounded"
but evidently doesn't catch paraphrases. That's a real, separate bug in the
persona-file writer, out of scope for a goals-store data-loss fix.

## 2. Approaches considered

### 2.1 For the root cause (test suites touching the live DB)

**A. Audit and fix each individual test file that's missing isolation.**
Rejected as the *primary* fix: I re-swept the current tree and every one of
the 39 test files that call `getDb()` already isolates via either
`HIVEMATRIX_DB_PATH` or a temp `HOME` override — the two files from this
incident are already fixed, and there's no other currently-open hole. Per-file
auditing is also how this bug shipped in the first place (individual
discipline, not a system that fails closed) and it doesn't protect the *next*
test file someone (human or agent) adds. Grep-based auditing is also
error-prone in practice — my own first pass here produced 5 false positives
by only checking for `HIVEMATRIX_DB_PATH` and missing the equally-valid `HOME`
convention.

**Correction, added after enabling the guard (§2.1-C):** the "39 files" sweep
above was itself incomplete — it only checked for *direct* `getDb()` callers.
With the guard live, `npm test` surfaced two more files that reach `getDb()`
*transitively* without isolating first (`src/lib/orchestrator/codex-agent.test.ts`
via `buildCodexPrompt()` → mailbee/messagebee `isChannelEnabled()`, and one test
in `src/daemon/server.test.ts` via `buildFirstRunSetupResponse()`), both now
fixed — which only underscores why Approach C's fail-closed guard, not per-file
auditing, has to be the real backstop.

**B. A global test-setup hook that force-pins `HIVEMATRIX_DB_PATH` for the
whole `npm test` run.** Rejected: this would change the isolation *unit* from
per-file (each suite gets its own throwaway DB) to per-run (every suite in
one `npm test` invocation would share one DB file), which risks new
cross-file test interference that doesn't exist today. Bigger blast radius
than the bug being fixed.

**C. (Chosen) A fail-closed runtime guard in `resolveDbPath()`.** Under
`NODE_ENV=test`, if the path about to be opened is the *actual* production
path this process's real `$HOME` resolves to (captured once, before Node
starts, via an env var set in the `npm test` script itself — so it can't be
clobbered by a test file overriding `process.env.HOME` later), throw instead
of opening it. This:
- Doesn't touch any of the 39 already-correct test files or their two valid
  isolation conventions.
- Fails loud and immediate (a thrown error in the offending test file) rather
  than silently succeeding while corrupting data — matches this codebase's
  existing "fail-closed" convention (e.g. the flash honesty gate).
  Protects every current and future test file with one guard, at the one
  place all DB access already funnels through — no new abstraction, reuses
  the existing `resolveDbPath()`/`getDb()` chokepoint per AGENTS.md's
  complexity budget ("reuse the shared scaffolding; don't re-roll it").
- Is cheap to unit test directly.

### 2.2 For goals resilience (self-heal from GOALS.md)

**A. Full LLM-driven import at startup** (reuse the existing chat-tool import
path, which lets the model interpret GOALS.md's free text and call
`goal_upsert` with judgment — e.g. merging the three ARR-goal paraphrases into
one). Rejected for the *automatic* startup path specifically: it requires a
model call during daemon boot (slow, costs money, non-deterministic, and a
transient model-call failure would leave goals empty again with no clear
error). This remains the right tool for an operator-invoked "import my goals"
chat request — not for an unattended startup hook.

**B. (Chosen) A small deterministic parser + startup hook.** Parse
`persona/GOALS.md`'s `- YYYY-MM-DD: <text>` bullets (its one actual format —
confirmed by reading the live file), and on daemon startup, if
`listGoals().length === 0` and GOALS.md exists, `upsertGoal()` one row per
bullet (title = the text after the date prefix), skipping any line whose text
exact-matches (case-insensitive) a goal that's already there. This is
deterministic, fast, has no model dependency, and directly satisfies "If [the
DB backup is] not [good enough], auto-import from GOALS.md on next app
launch" from the bug report. It will import GOALS.md's existing near-duplicate
entries as separate goals (see §1.2's caveat) — accepted as a known, reported
limitation rather than papering over it with a hand-rolled fuzzy-dedup
heuristic in an emergency-recovery code path.
- Reuses `upsertGoal`/`listGoals`/`configuredBrainRootDir` — no new DB access
  layer.
- Runs once (only fires when the table is truly empty), so it's naturally
  idempotent across restarts once goals exist.

**C. Also restore the 2 goals from the 07-13 backup.** Considered and
rejected as *not worth doing*: both of those 2 goals ("Land Engine 1 — first
fractional AI retainer," "Gym 4x/week") are already represented (in
paraphrase) in GOALS.md's current bullets, so the Option-B import supersedes
them with fresher (07-14-dated) wording. Recovering the stale DB rows on top
would just add more duplicates.

## 3. Chosen fix (both parts)

1. `src/lib/db/index.ts` — fail-closed prod-DB guard in `resolveDbPath()` +
   `package.json`'s `test` script passes the guard value.
2. `src/lib/goals/import-from-persona.ts` (new, small) — deterministic
   GOALS.md bullet parser + import, reusing `goals/store.ts`.
3. `src/daemon/index.ts` — one call to the above at startup, alongside the
   existing startup loops (e.g. `startBrowserLaneReadinessLoop`), guarded so
   it only imports when `listGoals()` is empty.
4. Run the import once, now, against the live DB (via the same code path) so
   the operator's Goals panel is populated without waiting for the next
   daemon restart.

## 4. Explicitly out of scope (flagged for the operator, not silently done)

- **Restoring `tasks`/`flash_turns`/`feedback`/`directives`/`work_packages`
  from the 07-13 backup.** Real data, but restoring ~40-hour-stale rows into
  a live DB that's had 17+ hours of *new* real activity since is a judgment
  call with real tradeoffs (duplicate/orphaned task rows, chat history that
  would appear out of order, etc.) that the bug report didn't ask for and I'm
  not comfortable making unilaterally. The backup file is preserved at
  `~/.hivematrix/backups/hivematrix-preupdate-2026-07-13T09-58-12-356Z.db` if
  the operator wants it.
- **GOALS.md's own near-duplicate accumulation** (`distill.ts`'s merge step
  not actually deduping paraphrased goals). Real bug, different subsystem,
  deserves its own design doc rather than a rushed fix bundled into this one.
- **A general "did an update silently wipe data" self-check/rollback in the
  updater** (`src/lib/updater/updater.ts`, `scripts/update-apply-proof.mts`).
  Would have caught this faster, but it's a materially larger feature
  (row-count baselines, rollback triggers) than "fix the goals view," and the
  root-cause fix in §2.1 already closes the actual hole. Worth a follow-up
  task on its own.
