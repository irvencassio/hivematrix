# Flash Chat History Truncation — Root Cause + Fix Design

> Self-improvement task, spawned via HiveMatrix's `workflow:"work"` Task kind.
> Operator-facing bug report: "Flash chat is not persisting conversation history
> correctly — user leaves/returns to the chat window and the last conversation
> is gone; chat shows earlier state instead." Running autonomously (headless
> `claude -p` daemon task, no live approver in this run) — this doc records the
> brainstorm findings and the decision made, for the operator to review after
> the fact. Per AGENTS.md: **do not release; the operator releases.**

## 0. Non-staleness check

Before brainstorming, checked whether this was already fixed by a prior loop
iteration (see memory `feedback-verify-before-redoing-stale-dispatch`):
`git log --oneline -20` on `main`, today's `docs/superpowers/specs|plans/2026-07-15-*`,
and `GET /brain/search?q=flash+chat+history+truncation+turns+pagination` against
HiveMatrix's own durable memory. None turned up prior work on this specific
symptom. Also checked `ps aux | grep "claude -p"` — the one running process is
this session's own invocation, not a second concurrent dispatch. This is new
work, not a duplicate.

One adjacent, easy-to-confuse incident exists: an unmerged worktree
(`fix/goals-data-loss-db-test-isolation`, branched from `main`@0.1.202,
**not yet part of `main`@68b58c79**) documents that on 2026-07-14 a test-suite
DB-isolation bug wiped several production tables, including `flash_turns`
(837 rows of chat/voice history deleted). That incident is a real, distinct,
**one-time data-loss event** — already root-caused and partially fixed there
(a fail-closed guard on `resolveDbPath()` under `NODE_ENV=test`), with
`flash_turns` restoration explicitly flagged out of scope for operator
sign-off. It does **not** explain today's report: that fix addresses tests
wiping the DB, not the live, ongoing, reproducible "close and reopen the chat,
lose the recent conversation" behavior described today. Confirmed these are
different bugs (see §1) rather than assuming the older incident covers this.

## 1. What actually happened (confirmed live, not from the bug report's hypotheses)

The bug report's own five hypotheses (not saved to DB / session state not
restored / cache invalidation / DB sync local-vs-server / app state management)
were checked against the real code and live daemon state, in order:

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Not saved to DB on each message | **No** | `appendTurn` (`src/lib/flash/store.ts:105`) is a plain `INSERT`, called on every turn; live data confirms turns keep accumulating (session `lastActiveAt` keeps advancing all day). |
| Session state not restored on app return | **Right effect, wrong mechanism** | The session *itself* is found correctly (see below) — the bug is in what's fetched *for* that session, not which session. |
| Cache invalidation clearing recent history | **No** | No caching layer exists in this path. The console re-fetches from the daemon fresh on every panel-open (`hydrateFlashThread()`, `src/daemon/console.ts:6823`); the server hits SQLite directly. |
| Database sync issue (local vs. server) | **No** | Single local daemon + single local SQLite file; no sync/replication architecture in this path at all. |
| App state management not preserving context | **No** | `_flashState.messages` is unconditionally overwritten from the server response on every `hydrateFlashThread()` call — no stale client-side cache. |

### 1.1 Real root cause: `getTurnsForSession()` returns the OLDEST page, not the newest

`showFlashPanel()` → `hydrateFlashThread()` (`console.ts:6823-6837`) is what runs
every time the operator opens/returns to the Flash chat panel:

1. `GET /flash/session/current?peer=operator` → resolves the session id via
   `getCurrentSession('operator', ...)`. This is correctly peer-scoped
   (`WHERE channel = ? AND peer = ?`) and, because the operator's session is
   "everlasting" (one unified row per the console+voice+task-completion design
   in `store.ts`'s header comment), there is only ever one candidate row for
   this peer — so this step reliably returns the right session id. **Not the
   bug.**
2. `GET /flash/sessions/:id/turns` → server route (`server.ts:4798-4804`) calls
   `getTurnsForSession(id, 100)` with no `sinceIso`. In `store.ts:137-146`,
   that branch is:
   ```ts
   return getDb()
     .prepare("SELECT * FROM flash_turns WHERE sessionId = ? ORDER BY ts ASC LIMIT ?")
     .all(sessionId, limit) as FlashTurnRow[];
   ```
   `ORDER BY ts ASC LIMIT 100` returns the **first** 100 turns ever recorded
   for that session — not the most recent 100. Once a session accumulates more
   than 100 turns, this query is frozen: it will return the exact same
   oldest-100-turn window forever, no matter how much more recent conversation
   has happened since.

**Confirmed live, right now**, by curling the daemon directly with the
operator's real session id (`78bd78ec01f94ab69b336b76`):

- `GET /flash/sessions` shows that session's real `lastActiveAt` as
  `2026-07-15 21:54:16`.
- `GET /flash/sessions/78bd78ec01f94ab69b336b76/turns` returns exactly 100
  rows, spanning `2026-07-15T03:20:31.124Z` → `2026-07-15T17:24:01.036Z`.

That's **~4.5 hours of real, persisted, un-deleted conversation** (everything
after 17:24 today) that the chat panel silently cannot show, on every reopen,
because the query never reaches it. This matches the report exactly: not
"empty" (a real wipe would look like that), but "shows earlier state instead"
— because the window is real, just permanently stuck at the wrong end of the
table.

This is a read-side pagination bug, not a data-loss bug. The data is intact
and growing correctly; only the retrieval query for "show me the
conversation" is wrong.

### 1.2 Same bug, second call site

`POST /flash/turns/:id/feedback` (`server.ts:4819-4840`, the "bad turn"
eval-logging path) also calls `getTurnsForSession(turn.sessionId, 100)`
(`server.ts:4829`) and then walks the result backward to find the user turn
that preceded the rated turn, for `recordBadTurnForEval`. For any session over
100 turns, this fetches the same wrong (oldest) window, and the actual
rated turn is very likely not even present in it — so this path can silently
log the wrong "preceding user turn" as an eval regression case. Fixing the one
shared function fixes both call sites; no separate change needed here.

`getTurnsForSession`'s `sinceIso` branch (used by the learning-loop distiller,
`distill.ts:264`, to fetch everything new since the last distillation pass) is
already correct for its own contract — ascending order starting just after a
checkpoint is the right shape for "what's new since X." Not touched by this
fix.

### 1.3 A second, real, but currently unreachable bug (flagged, not fixed here)

While tracing this, found that `flash_sessions.lastActiveAt` is written in two
different string formats depending on code path:

- On `INSERT` (new session): `new Date().toISOString()` → e.g.
  `2026-07-15T19:12:41.334Z`.
- On every `UPDATE` (session resumed, `getOrCreateSession` x2 and
  `updateSessionSummary`): SQLite's `datetime('now')` → e.g.
  `2026-07-15 21:54:16` (space, no `Z`, no milliseconds).

`listSessions()` (`GET /flash/sessions`, a plain string `ORDER BY lastActiveAt
DESC`) mis-orders across these two formats, because `'T'` (0x54) sorts after
`' '` (0x20): a freshly-inserted, never-yet-resumed session's pristine ISO
timestamp will out-rank a genuinely more recent, already-resumed session's
SQLite-formatted timestamp. **Confirmed live**: the `GET /flash/sessions`
response captured above lists a one-off `diag-vision-test` session
(`lastActiveAt` `19:12:41`, ISO format) *ahead of* the operator's real session
(`lastActiveAt` `21:54:16`, SQLite format) — chronologically backwards.

This is a real bug, but it is **not** the cause of today's report: the
peer-scoped queries that actually drive the chat panel
(`getCurrentSession`/`getOrCreateSession`, both `WHERE channel = ? AND
peer = ?`) only ever have one candidate row for the unified operator peer, so
the cross-row ordering bug can't bite there. Grepped `console.ts` for any
consumer of the plain `GET /flash/sessions` list (as opposed to
`/flash/session/current`) — none exists in the shipped console UI today. So
this is a live correctness bug with no currently-reachable user-facing symptom.

Following the same discipline as the goals-data-loss incident doc (fix what's
reported + its true root cause; flag adjacent real bugs for operator
sign-off rather than silently expanding scope): **not fixing this here.** If
the operator wants it fixed, the mechanical fix is straightforward — write
`lastActiveAt` with `new Date().toISOString()` in all three `UPDATE`
statements in `store.ts` instead of `datetime('now')`, matching what
`INSERT` already uses (and matching what the functions already hand back
in-memory to their callers today — e.g. `getOrCreateSession` already
*returns* `lastActiveAt: new Date().toISOString()` right after the `UPDATE`,
papering over the on-disk inconsistency for that one call but leaving the
persisted row mismatched for every future query).

## 2. Approaches considered (for the chosen fix)

**A. (Chosen) Rewrite the no-`sinceIso` branch as `ORDER BY ts DESC LIMIT ?`
in a subquery, with an outer `ORDER BY ts ASC`.**
```sql
SELECT * FROM (
  SELECT * FROM flash_turns WHERE sessionId = ? ORDER BY ts DESC LIMIT ?
) ORDER BY ts ASC
```
Standard SQL idiom for "last N rows, in chronological order" — one query, one
round trip. The outer `ORDER BY` guarantees final output order regardless of
how SQLite orders the derived table internally. Keeps `getTurnsForSession`'s
existing contract (returns an ASC-ordered array) exactly the same for every
caller — no caller needs to change. Matches this file's existing style of a
single prepared statement per branch (no post-processing step).

**B. Fetch `ORDER BY ts DESC LIMIT ?` then `.reverse()` the JS array.**
Equivalent result. Rejected in favor of A only for house-style consistency —
every other function in `store.ts` (`getRecentTurns`, `listSessions`, the
`sinceIso` branch right above this one) is a single prepared-statement
expression with no post-processing; introducing the one two-step exception
here isn't worth it for an identical outcome.

**C. `COUNT(*)` the session's turns, compute `OFFSET = max(0, total - limit)`,
then `ORDER BY ts ASC LIMIT ? OFFSET ?`.** Rejected: needs two round trips
instead of one, and the count-then-offset gap is racy if a turn is inserted
between the two queries (the offset could be off by one). More code for no
benefit over A.

## 3. Chosen fix

`src/lib/flash/store.ts` — `getTurnsForSession`'s no-`sinceIso` branch only
(Approach A). The `sinceIso` branch, every other function in the file, and
both `server.ts` call sites are unchanged; the fix is fully contained at the
one shared chokepoint both callers already go through.

New regression test in `src/lib/flash/store.test.ts` (already the home for
this module's tests): seed a session with more than `limit` turns at
deterministic, explicit timestamps (set directly via SQL after `appendTurn`,
since `appendTurn` doesn't take a caller-supplied `ts` and real-clock
timestamps in a tight test loop aren't reliably distinct at millisecond
resolution), then assert `getTurnsForSession(id, limit)` returns the
newest `limit` turns, in ascending order — proving both "which rows" and
"what order" are correct, not just one or the other.

## 4. Explicitly out of scope (flagged for the operator, not silently done)

- **§1.3's `lastActiveAt` format inconsistency.** Real bug, currently
  unreachable from any shipped client path, different code path (session
  listing/ordering, not turn pagination) from what was reported. Worth its
  own small follow-up if the operator wants `GET /flash/sessions`'s ordering
  to be trustworthy for a future consumer (e.g. a session-switcher UI).
- **Restoring the `flash_turns` rows lost in the 2026-07-14 incident.**
  Unrelated to this bug (that data is gone from the DB, not stuck behind a
  bad query) and already explicitly flagged for operator judgment in the
  `fix/goals-data-loss-db-test-isolation` worktree's own design doc.
- **Raising the 100-turn page size, or adding real pagination
  (load-more/infinite-scroll) to the chat panel.** Once this fix lands, the
  panel correctly shows the newest 100 turns on open, which comfortably
  covers a normal session. Turns older than that within the same "everlasting"
  operator session become unreachable from the console UI (there's no
  "load older messages" control). That's a pre-existing UX limitation, not
  a regression from today's report or this fix, and is a product decision
  (how much scrollback should the console keep client-accessible) rather
  than a bug — flagged, not fixed here.
