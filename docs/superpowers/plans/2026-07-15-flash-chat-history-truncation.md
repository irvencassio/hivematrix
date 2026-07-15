# Flash Chat History Truncation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-15-flash-chat-history-truncation-design.md`

Root cause: `getTurnsForSession()` in `src/lib/flash/store.ts` returns the
**oldest** `limit` turns (`ORDER BY ts ASC LIMIT ?`) instead of the newest,
whenever called without `sinceIso` — which both `server.ts` HTTP callers do.
Once a session passes 100 turns, the Flash chat panel is permanently stuck
showing the same early window on every reopen. Fix is contained to one
function, one file, no schema change, no new concept.

## Task 1: Fix `getTurnsForSession` to return the newest page in chronological order

**Files:**
- `src/lib/flash/store.ts` (production code)
- `src/lib/flash/store.test.ts` (test)

**Step 1 — RED.** Add this test to `src/lib/flash/store.test.ts` (append near
the end, after the existing `getCurrentSession` tests; add `appendTurn,
getTurnsForSession, getDb` — `getDb` from `@/lib/db` — to the existing
destructured import block at the top, which currently reads:
```ts
const { createSession, getOrCreateSession, getCurrentSession, getFlashCliSessionId, setFlashCliSessionId, clearFlashCliSessionId } = await import("./store");
```
Change to also pull in `appendTurn` and `getTurnsForSession` from `./store`,
and add a second dynamic import line for `getDb` from `@/lib/db` (same
dynamic-import style as the existing line, so the `HOME` override on line 10
still takes effect before the DB module is first touched):
```ts
const { createSession, getOrCreateSession, getCurrentSession, getFlashCliSessionId, setFlashCliSessionId, clearFlashCliSessionId, appendTurn, getTurnsForSession } = await import("./store");
const { getDb } = await import("@/lib/db");
```

Then append:
```ts
// ---------------------------------------------------------------------------
// getTurnsForSession: the no-sinceIso page must be the NEWEST `limit` turns,
// in ascending (chronological) order — not the oldest `limit` turns.
// ---------------------------------------------------------------------------

test("getTurnsForSession: with no sinceIso, returns the newest `limit` turns in ascending order (not the oldest)", () => {
  const session = createSession("console", "history-truncation-test");
  const db = getDb();

  // Insert 105 turns, then force each row's `ts` to a distinct, deterministic,
  // strictly increasing value — appendTurn's real-clock timestamps aren't
  // reliably distinct at millisecond resolution in a tight synchronous loop,
  // so set them explicitly instead of relying on wall-clock timing.
  const total = 105;
  for (let i = 0; i < total; i++) {
    const turn = appendTurn(session.id, "user", `turn-${i}`);
    const ts = new Date(2026, 0, 1, 0, 0, i).toISOString(); // 2026-01-01T00:00:0i.000Z
    db.prepare("UPDATE flash_turns SET ts = ? WHERE id = ?").run(ts, turn.id);
  }

  const page = getTurnsForSession(session.id, 100);

  assert.equal(page.length, 100);
  // Newest 100 of 105 means turn-5 .. turn-104 survive; turn-0..turn-4 are dropped.
  assert.equal(page[0].content, "turn-5");
  assert.equal(page[page.length - 1].content, "turn-104");
  // Ascending order: every ts strictly increases across the returned page.
  for (let i = 1; i < page.length; i++) {
    assert.ok(page[i].ts > page[i - 1].ts, `expected ts to increase at index ${i}`);
  }
});

test("getTurnsForSession: with fewer than `limit` turns, returns all of them in ascending order (unchanged behavior)", () => {
  const session = createSession("console", "history-truncation-small-test");
  appendTurn(session.id, "user", "first");
  appendTurn(session.id, "assistant", "second");
  appendTurn(session.id, "user", "third");

  const page = getTurnsForSession(session.id, 100);

  assert.equal(page.length, 3);
  assert.deepEqual(page.map((t) => t.content), ["first", "second", "third"]);
});
```

Run `npm test -- src/lib/flash/store.test.ts` (or the project's equivalent
single-file test invocation — check `package.json`'s `test` script for the
exact runner flags). Confirm the **first** new test fails, and that it fails
for the right reason: `page[0].content` should currently be `"turn-0"` (the
existing `ORDER BY ts ASC LIMIT ?` returns the oldest page), not `"turn-5"`.
The second new test should already pass (it's a same-behavior regression
guard, not exercising the bug) — that's expected, not a problem.

**Step 2 — GREEN.** In `src/lib/flash/store.ts`, change only the no-`sinceIso`
branch of `getTurnsForSession` (currently lines ~143-145):
```ts
  return getDb()
    .prepare("SELECT * FROM flash_turns WHERE sessionId = ? ORDER BY ts ASC LIMIT ?")
    .all(sessionId, limit) as FlashTurnRow[];
```
to:
```ts
  return getDb()
    .prepare(
      "SELECT * FROM (SELECT * FROM flash_turns WHERE sessionId = ? ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC",
    )
    .all(sessionId, limit) as FlashTurnRow[];
```
Do not touch the `sinceIso` branch above it, the function signature, or any
caller. Re-run the same test file; both new tests (and every pre-existing
test in the file) must pass.

**Step 3 — verify no regressions in dependent modules.** Run the full suite
(not just this file) since `getTurnsForSession` is called from
`src/daemon/server.ts` (two routes) and `src/lib/flash/distill.ts` (the
`sinceIso` branch, unchanged, but confirm its own tests still pass):
```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```
All three must be clean. This change adds no new table, store, or concept, so
no `DECISIONS.md` entry is needed (per AGENTS.md's complexity budget — only
new persistent stores/orchestration primitives/product concepts require one).

**Addendum, added after execution:** the plan's literal SQL (ts-only ordering)
turned out to be insufficient — implementing it exposed a real, deterministic
tie-breaking bug: back-to-back synchronous `appendTurn` calls can share the
same millisecond-resolution `ts`, and without a secondary sort key the
`DESC`-then-`ASC` two-pass can reverse tied rows relative to true insertion
order (caught by the plan's own second test, which started failing
consistently, not flakily). Fixed by adding `rowid` (this table has no
`WITHOUT ROWID` clause and a `TEXT` primary key, so SQLite's implicit rowid
reliably tracks insertion order) as a secondary sort key in both the inner
and outer `ORDER BY`, and switching the outer `SELECT *` to an explicit
`FlashTurnRow` column list so the internal `rowid` alias never leaks into the
returned rows. Still fully contained to the same one function/branch;
independently re-verified (typecheck, full suite, scope-wall) after the
change, not just the implementing subagent's self-report.

**Definition of done for this task:**
- [ ] Both new tests added to `store.test.ts`
- [ ] RED confirmed: first new test failed against the old query, with the
      expected wrong value (`"turn-0"` where `"turn-5"` is expected)
- [ ] GREEN confirmed: both new tests pass against the fixed query
- [ ] `npm run typecheck` clean
- [ ] `npm test` — full suite passes (no regressions elsewhere)
- [ ] `node scripts/scope-wall.mjs` — zero violations
- [ ] No changes outside `src/lib/flash/store.ts` and
      `src/lib/flash/store.test.ts`

## Finishing

Single-task plan — no merge/integration step between tasks. After Task 1's
definition of done is met and independently re-verified (re-run the three
gate commands directly, don't just trust the implementing subagent's report):
commit to `main` directly (small, well-tested diff — normal for this loop
per project memory). **Do not push, do not release** — leave the commit
local/ahead-of-origin for the operator, matching this session's own
same-day precedent (`68b58c79`, `3420c169`, `9b7095af` all sit unpushed
ahead of `origin/main` right now).
