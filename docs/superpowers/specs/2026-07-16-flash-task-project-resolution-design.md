# Flash-created tasks get wrong project/projectPath — Design

## Dispatch as received

"PRIORITY: Fix IMMEDIATELY — actively breaking task scheduling right now. Tasks
created from Flash (chat) get incorrect `project` and `projectPath` values,
causing them to fail scheduler locks and run in the wrong directory." Cited
evidence: task `e238b04578fb48a39af66016`, a hivematrix-watch job, created with
`project="hivematrix"` and `projectPath="/Users/irvcassio"` (home dir, not a
git repo). Cited 3 root causes: `flash-mcp.ts:308` (`projectPath: argProjectPath
?? homedir()`), `flash-mcp.ts:376` (`project: "hivematrix"` hardcoded), and
`server.ts:4458` (`body.projectPath = homedir()`).

## Investigation — verified against the live daemon and current source, not taken on trust

**The cited task ID needed independent verification before anything else.**
`known-issues.md` already has an entry from earlier *today* (the
`6a9e7c737d104b56b2b09a4d` "STALE DISPATCH" entry) about a dispatch that cited
task `e328b04578fb48a39af66016` as blocking evidence — checked against the live
system and found **not to exist**. This dispatch's cited ID,
`e238b04578fb48a39af66016`, is the same digits transposed, which is close
enough to warrant checking rather than assuming. Queried the live daemon
(`GET /tasks/e238b04578fb48a39af66016` on `:3747`, daemon v0.1.209, 11 active
tasks) directly: **the task is real**, distinct from the stale one, and matches
the report exactly — `project:"hivematrix"`, `projectPath:"/Users/irvcassio"`,
`executor:"agent"`, `workflow:"work"`, `source:"flash:78bd78ec01f94ab69b336b76"`.
It ran, cost $10.68, and exited with code 1 (status `archived`). The two cited
`flash-mcp.ts` lines and the `server.ts` line were also re-read directly from
the current working tree (not assumed from the dispatch's line numbers) and
match as described.

**The actual mechanism is more specific than "these 3 fallbacks exist," and
that specificity matters for the fix.** `package.json` on `main` HEAD is
already `0.1.209` (same as the running daemon), but `git log` shows
`resolveEscalationTarget`'s self-improvement detection (`isSelfImprove`, the
`/\bhive\s?matrix\b/i` regex, the `SELF_IMPROVEMENT_PREFIX` injection) was
added in a commit that post-dates the code that actually built the running
0.1.209 binary — commits land on `main` continuously without a version bump
each time (the established pattern throughout `known-issues.md`: "commit X on
main, unreleased"). Confirmed the task's stored `description` starts with the
literal `SELF_IMPROVEMENT_PREFIX` text — but this is Flash's own
session-supplied text (this exact bracketed instruction is also how *this*
dispatch itself arrived, prefixed the same way), not proof that
`resolveEscalationTarget`'s injection branch fired; if it had fired, `title`
containing "HiveMatrix-watch" would also match the current regex (verified
empirically, see below), which would have (a) routed `projectPath` to
`repoPath` instead of `homedir()`, and (b) doubled the prefix. Neither
happened. So the task that actually broke was almost certainly created by a
simpler, pre-self-improvement-routing version of `handleEscalateToTask`:
unconditional `project:"hivematrix"` + `projectPath: argProjectPath ??
homedir()`, no `kind`/regex branch at all — which is exactly root causes #1
and #2 as filed, just via a slightly different code path than current `main`'s
richer (but equally broken) version. Re-verified both against the CURRENT
source directly (not the dispatch's claim): still present, unconditionally.

**Found a companion task that shows the practical shape of the gap.** Same
Flash session (`source:"flash:78bd78ec01f94ab69b336b76"`) later created task
`e7c6f88fef3a46b09f27c58e` ("Finish Part 4: Device status..."), currently
`in_progress`, with **correct** `project:"hivematrix-watch"` and
`projectPath:"/Users/irvcassio/hivematrix-watch"`. Its title/description don't
mention "hivematrix" as a literal substring, so this didn't go through
self-improve routing either — the model must have supplied `projectPath`
explicitly as a raw absolute path, something the existing tool schema already
allows. The likely story: the first task (`e238...`) ran with the wrong `cwd`,
its own agent apparently discovered the real repo location during that $10.68,
exit-1 run (its `output.summary` literally says "working tree is clean, branch
is ahead of `origin/main` by 2 commits... Part 1+3, and now Part 2" — text
about a real repo state, despite the wrong `cwd`), and something in that
session then knew to hand-supply the correct path for the follow-up. **This
is the actual shape of the bug**: the tool already "works" if the calling
model happens to already know the exact absolute path, but has no way to
specify a project *by name* — so the first mention of any project always has
to get lucky, guess wrong (→ homedir(), wasted cost, wrong `cwd`), or
painstakingly discover the real path itself before a later call can self-correct.

**Two additional real bugs found beyond the 3 cited, both on current `main`
only (not yet released, so not yet responsible for the `e238` incident, but
real and about to bite once this branch's other self-improvement work ships):**

1. `resolveEscalationTarget`'s `/\bhive\s?matrix\b/i` self-improve regex has a
   boundary bug — `\b` is satisfied at a hyphen, so it matches
   "HiveMatrix-watch", not just bare "HiveMatrix". Confirmed empirically
   (`node -e`, not hand-traced): `true` for `"HiveMatrix-watch UX overhaul..."`
   and `"hivematrix-watch"`. `~/.hivematrix/discovered-projects.json` lists
   `hivematrix-watch`, `hivematrix-ios`, `hivematrix-android`,
   `hivematrix-androidwatch` as separate real repos (confirmed on disk) — every
   one of those would falsely self-improve-route into the **core** hivematrix
   repo once this regex is live, which is a strictly worse failure mode than
   today's homedir() miss: it would silently land real edits in the wrong repo
   instead of just failing to find files in an empty cwd.
2. `selfImproveRepoPath()`'s documented fallback chain is `configured
   selfImprove.repoPath` → `process.cwd()`. Confirmed live:
   `~/.hivematrix/config.json` has no `selfImprove` key today. The function's
   own docstring already flags the risk for a packaged app ("cwd is the bundle
   root, not a git checkout... the operator MUST set `selfImprove.repoPath`");
   confirmed the concrete failure mode for *this* operator specifically —
   `onboarding/actions.ts`'s LaunchAgent plist sets `WorkingDirectory` to
   `homedir()`, so `process.cwd()` for the live packaged daemon resolves to
   bare `/Users/irvcassio`. Once (1) above is fixed and the regex correctly
   fires only for genuine core-repo self-improvement, this fallback would still
   land on homedir() instead of the real hivematrix checkout, unconfigured.

## Root cause

`handleEscalateToTask` (Flash's `escalate_to_task` tool) and `server.ts`'s
`POST /tasks` both independently guess at a task's `project`/`projectPath`
with no way to resolve a project *by name* — each re-rolls its own version of
"trust an explicit path, else guess `homedir()`," and `escalate_to_task`
additionally hardcodes `project:"hivematrix"` regardless of what the task is
actually about. Project-name-to-path resolution already exists twice in this
codebase (`aliases.ts#resolveProject` for the alias/custom/system registry,
`project-discovery.ts#discoverProjects` for auto-discovered git repos,
confirmed already containing `hivematrix-watch → /Users/irvcassio/hivematrix-watch`)
— neither task-creation path uses either one.

## Approaches considered

**A. Patch each of the 3 cited call sites independently, in place.** Rejected
— `flash-mcp.ts` and `server.ts` already have *divergent* copies of the same
"resolve a task's project" concern (different projectPath fallback in the
YouTube-summary sub-route: `process.cwd()`, not `homedir()`); patching 3 sites
independently adds a 3rd/4th slightly-different variant instead of collapsing
the duplication, the opposite of AGENTS.md's complexity budget ("reuse the
shared scaffolding, don't re-roll it").

**B. Add one shared name→path resolver, `resolveProjectByName`, as a small
extension of the existing `aliases.ts` (which already owns "resolve a project
reference to a path" via `resolveProject`) — falling back to
`discoverProjects()` when the alias/custom/system registry doesn't have it.
Both `escalate_to_task` and `POST /tasks` call it when a project name is known
but a path isn't; both reject with a clear error instead of guessing
`homedir()` when a *named* project can't be resolved.** Extends an existing
primitive (aliases.ts) rather than adding a new file/store — no DECISIONS.md
entry needed (no new persistent store, no new orchestration primitive; reuses
`discoverProjects()`'s existing cache and `resolveProject()`'s existing
registry verbatim). Also gives the `escalate_to_task` tool schema a `project`
name argument it currently lacks entirely — today a calling model can only
supply a raw absolute `projectPath` (which it usually doesn't know yet) or
`kind:"self-improvement"` (which only covers the core repo) — so this is the
piece that actually closes the gap the companion-task evidence above points
at, not just a defensive homedir() removal.

**C. Build a dedicated new "task target resolution" module/service, including
its own request/response types and a broader validation layer.** Rejected as
over-scoped for a bug fix — the two existing resolvers already cover exactly
what's needed (registry + discovery); a new module would duplicate rather than
reuse them, and this touches exactly two call sites, not a systemic surface
that would justify a new primitive.

## Decision: Approach B

1. `src/lib/routing/aliases.ts`: add `resolveProjectByName(name): {name,
   path} | null` — tries `resolveProject(name)` first (alias/custom/system
   registry, unchanged), then `discoverProjects()` by case-insensitive name
   match (the array is already confidence-sorted, so first match is the best
   one — matters because a few discovered names collide across mirrored
   directories, e.g. two `mailbee` entries). Returns `null` on no match; never
   guesses.

2. `src/lib/flash/flash-mcp.ts`:
   - `escalate_to_task`'s tool schema gains a `project` string argument
     ("name of the target project/repo, e.g. hivematrix-watch — resolved
     automatically").
   - Tighten the self-improve regex to `/\bhive\s?matrix\b(?!-)/i` — a
     negative lookahead against a following hyphen, so "HiveMatrix-watch" no
     longer false-positives while "Hive Matrix", "HiveMatrix's", and
     "hivematrix." (sentence-final) still do. Verified empirically against
     both the existing test strings and the new hyphenated ones.
   - `resolveEscalationTarget` gains an `argProject` input and returns a
     resolved `project` name (not a hardcoded string) plus an optional
     `error`. Priority: self-improve (unchanged shape, still `repoPath`) →
     explicit `project` name (resolve via `resolveProjectByName`; error if
     unresolvable, no homedir() guess) → explicit `projectPath` (trusted
     as-is, `project` name derived from its basename instead of hardcoded
     "hivematrix") → neither given (unchanged: `"hivematrix"` +
     `homedir()`, the genuine no-project-info operational-task case, e.g.
     "book a flight").
   - `selfImproveRepoPath()` gets a middle fallback tier —
     `resolveProjectByName("hivematrix")` — between the configured value and
     `process.cwd()`, so an unconfigured packaged app still lands
     self-improvement escalations in the real checkout instead of
     `homedir()` (via the LaunchAgent-cwd mechanism above), without changing
     the documented "operator should configure this" contract.
   - `handleEscalateToTask` uses the resolved `project`/`projectPath`
     verbatim (no more hardcoded `"hivematrix"`) and short-circuits to an
     `"Error: ..."` string (same convention `handleLearnSkill` already uses)
     when resolution fails, instead of creating a task pointed at nothing.

3. `src/daemon/server.ts`'s `POST /tasks`: when `projectPath` is absent **and**
   an explicit `project` name was given, resolve it the same way (400 with a
   clear error on failure). When neither is given, behavior is byte-for-byte
   unchanged (`project:"hivematrix"`, `projectPath: homedir()`) — this is the
   genuine no-project "operations task" case and must keep working exactly as
   today.

## Non-goals / explicitly out of scope

- The YouTube-summary sub-route's own `project`/`projectPath` fallback
  (`server.ts` ~line 4419-4420, `process.cwd()` not `homedir()`) — untouched.
  Confirmed it cannot reproduce this bug's actual symptom: it creates
  `executor:"workflow"` tasks, and the scheduler's backlog-claim query filters
  on `executor:"agent"` only (`scheduler.ts` ~line 447), so these never enter
  the per-repo lock accounting this bug report is about.
- The `route === "normal"` early-return in `POST /tasks` (trusts `body`
  verbatim, by design, for callers that already fully specify a task) —
  untouched, no caller of that path was implicated.
- The other ~15 `Task.create()` call sites found via a repo-wide grep
  (`mailbee/poller.ts`, `youtube/poller.ts`, `directive-engine.ts`,
  `voice/command-turn.ts`, etc.) — each already uses its own deliberate,
  correctly-scoped convention for its specific trigger source; none are
  Flash-originated or implicated in this report.
- Re-proving that per-repo lock accounting itself works for genuinely distinct
  real paths — already independently verified *today*, before this dispatch,
  in the `6a9e7c737d104b56b2b09a4d` STALE DISPATCH entry in `known-issues.md`
  (multi-claim scheduler loop, per-`projectPath` locking, `MAX_AGENTS=4`, all
  confirmed working live). This fix corrects what feeds the lock (the
  `projectPath` value itself); the locking mechanism was never broken.

## Verification plan

- New unit tests: `aliases.test.ts` (`resolveProjectByName` — registry hit,
  discovery hit including a duplicate-name case, no match → `null`,
  case-insensitivity). `flash-mcp.test.ts` (`resolveEscalationTarget` —
  explicit resolvable `project` name, explicit unresolvable `project` name →
  `error` and no homedir() fallback, regex no longer false-positives on
  "hivematrix-watch"/"hivematrix-ios" while still matching bare
  "HiveMatrix"/"Hive Matrix"/"HiveMatrix's", explicit `projectPath` derives a
  real `project` name instead of `"hivematrix"`, neither given → unchanged
  fallback). `self-improve-prover.test.ts` or a new prover-style test for
  `selfImproveRepoPath()`'s new discovery tier. `server.test.ts` (`POST
  /tasks` — resolvable `project` name with no `projectPath` fills in the real
  path; unresolvable → 400; neither given → unchanged).
- Live sanity check post-fix: replay the actual failing shape —
  `dispatchFlashOnlyTool("escalate_to_task", {title, description, project:
  "hivematrix-watch"}, ...)` against a temp-HOME fixture seeded with a fake
  discovered-projects cache (same isolation pattern as
  `project-discovery-cache.test.ts`) — assert the resulting task's
  `projectPath` is the resolved repo path, not `homedir()`.
- `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs` — independently
  re-run, not trusted from a subagent's self-report.
- Update `~/_GD/brain/projects/hive/known-issues.md` with a RESOLVED entry
  (matching this file's established format) — including the correction that
  the live-broken task predates the currently-unreleased self-improve
  regex/prefix machinery, and the two additional bugs found beyond the
  dispatch's 3 citations, so a future dispatch re-reporting either doesn't
  re-diagnose from scratch.
