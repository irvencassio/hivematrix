# Pattern Nudges — design

> Operator ask (2026-07-19): learn patterns over time and time notifications
> intelligently — low-motivation Mondays, recurring missed goals, overextension/
> burnout, work/family trade-offs — rather than blanket reminders. Operator ran
> "stories" against the idea and it resonated; this is that feature, scoped to
> what the codebase can actually observe today.

## What data actually exists (see research summary below the fold)

- **Goals**: `goals` + `goal_checkins` (`src/lib/goals/store.ts`) — append-only
  check-in history per goal, with date/value/note. `computeStreak`/`isDueToday`
  already exist; a "miss" is not stored but is fully derivable from checkin
  dates vs. cadence.
- **Tasks**: `tasks`/`task_history` — `createdAt`/`completedAt` timestamps for
  every task the operator has touched. A late-night/weekend skew in this data
  is a real, derivable proxy for overwork.
- **Nothing exists** for: work hours (as opposed to task timestamps), operator
  mood/sentiment, family-stress signal, or any explicit energy/motivation log.
  Confirmed by grep — zero hits for `mood`, `sentiment`, `burnout`, `energy
  level` in `src/`.

**Consequence for scope**: this design only detects patterns the existing data
can actually support. It does not invent a new mood/hours-logging surface for
the operator to fill in by hand — that would add a new operator chore in
exchange for a feature meant to reduce friction, and there's no existing
telemetry to seed it from. "Work/family trade-off" and "18-hour days" are
therefore served by the **overextension** detector below (a task-timestamp
proxy for overwork), not by a literal hours/family-stress signal — that
remains explicitly out of scope until a real signal source exists (see
Deferred).

## Shape: a sixth heartbeat ritual, not a new subsystem

`heartbeat.ts` already has four proactive rituals riding one `tick()`, each
added in the same shape: its own enable flag (default off), its own
hour/minute config, its own daily/weekly idempotence marker, its own sibling
module with a pure compose function. Day Brief, Capability Ratchet, and Weaver
Audit are the precedent. Pattern Nudges is a fifth/sixth instance of that same
shape — zero new schedulers, zero new delivery planes (reuses `notify()` +
`appendOperatorTurn` + `broadcastEvent`, exactly like the others), zero new
tables.

### New module — `src/lib/flash/pattern-nudges.ts`

Pure detectors (unit-testable, no I/O):

- `detectOverextension(activityTimestamps: string[], now: Date): boolean` —
  trailing 7 days of task `createdAt`/`completedAt` timestamps. True when
  ≥40% fall in a late-night window (22:00–05:00 local) or on a weekend day,
  **and** there are at least 12 timestamps in the window (a quiet week must
  not read as overextension for lack of signal).
- `computeGoalMisses(cadence, checkinDates, now, windows = 4): number` —
  partitions the trailing `windows` cadence-length periods (daily=1d,
  weekly=7d, milestone=14d) and counts how many have zero check-ins. Pure
  arithmetic over dates already in `goal_checkins`; no new storage.
- `detectMissedGoalPattern(goals): {title, misses, windows} | null` — worst
  offender among active goals with ≥2 of the last 4 periods missed AND at
  least one historical check-in (so a goal that never had momentum doesn't
  read as "recurring").
- `detectLowMotivationMonday(now, trailingActivityCount, threshold = 2):
  boolean` — Monday, local hour < 12, and check-ins + completions in the
  trailing 3 days below threshold.
- `pickRecentWin(candidates): string | null` — most recent completed task
  title or annotated goal check-in in the trailing 14 days. If nothing
  qualifies, the Monday nudge is suppressed outright (silence beats a
  generic "you've got this").
- `composePatternNudge(input): {kind, message} | null` — priority order
  **overextension > missed-goal-pattern > low-motivation-monday** (rarer/more
  consequential signal wins if more than one fires the same day). Exactly one
  nudge per day, ever — this is the anti-nagging guarantee.
  - Overextension is phrased as an **open offer**, never a push: *"want me to
    lighten what's queued, or just flag it for now?"* — never "you should
    work less" and never auto-acting on it. This is the "you need space to
    decide this yourself" case.
  - Missed-goal is phrased as a **pattern statement**, not a personal
    failure: *"that's a pattern, not a one-off"* — matching the operator's own
    framing.
  - Low-motivation-Monday is the "you need this reminder" case: surfaces a
    concrete, real win, not generic encouragement.
- `patternNudgeCooldownOk(lastKind, lastSentDay, candidateKind, now,
  cooldownDays = 3): boolean` — the same `kind` cannot fire again within 3
  days, so an unresolved pattern doesn't repeat verbatim every morning; a
  *different* kind can still fire the next day.

One impure entry point, mirroring `runRatchetPass`: `runPatternDetectionPass
(deps)` fetches goals+checkins and trailing task activity, calls the pure
detectors, and returns `{kind, message} | null` — no `notify()` call inside
(same split as `ratchet.ts`; the wrapper in `heartbeat.ts` owns delivery).

### `heartbeat.ts` changes

New `HeartbeatConfig` fields (mirrors Day Brief's field set exactly):

```
patternNudgeEnabled: boolean;        // default false — see "off by default", below
patternNudgeHour: number;            // default 9
patternNudgeMinute: number;          // default 0
lastPatternNudgeCheckedDay?: string; // local YYYY-MM-DD — at most one detection pass/day
lastPatternNudgeSentDay?: string;    // local YYYY-MM-DD — only set when a nudge actually sent
lastPatternNudgeKind?: string;       // for the 3-day same-kind cooldown
```

`tickPatternNudge(config, now, deps)` — same shape as `tickRatchet`/
`tickWeaver`: due-check via the existing `dayBriefMomentDue()` helper against
`lastPatternNudgeCheckedDay` (reused verbatim, no new due-check function
needed), mark `lastPatternNudgeCheckedDay` before running (existing "mark
before the pass" ordering, so a slow pass can't double-fire), run
`runPatternDetectionPass`, apply `patternNudgeCooldownOk`, and only if it
passes: `notify()` + `broadcastEvent("flash:pattern-nudge", ...)` + update
`lastPatternNudgeSentDay`/`lastPatternNudgeKind`. Wired into `tick()` next to
the other three ritual due-checks.

**Off by default even for fresh installs** — unlike Day Brief/Ratchet/Weaver
(flipped on by default 2026-07-12), this ritual starts disabled everywhere.
It's a new class of message — commentary on the operator's work patterns —
and per `[[browser-lane-credential-human-click-only]]`-style caution, a
feature that comments on burnout/motivation should be something the operator
opts into after seeing what it says, not something that starts talking
unbidden. Enabled the same way as the others: Settings → Heartbeat.

## Complexity accounting (Q14 budget, for the DECISIONS.md entry)

- New persistent stores: **0** — six fields on the existing heartbeat config
  JSON blob, not a new table.
- New orchestration primitives: **0** — reuses the ritual-in-heartbeat-tick
  shape verbatim (4th precedent: Day Brief, Ratchet, Weaver, now this).
- New delivery plane: **0** — `notify()` + `appendOperatorTurn` +
  `broadcastEvent`, unchanged.
- New modules: **1** (`pattern-nudges.ts`), same one-module-per-ritual
  convention as `day-brief.ts`/`ratchet.ts`/`weaver-audit.ts`.
- New product concept: the nudge content itself (pattern-aware proactive
  commentary) — worth a short DECISIONS.md entry (Q23) precisely because it's
  new *territory* (judging the operator's rhythm) even though it adds no new
  mechanism.

## Deferred (explicitly out of scope for this pass)

- **Explicit mood/energy/family-stress signal.** No existing data source;
  adding one means asking the operator to log something new, which cuts
  against the goal. If a real signal ever exists (e.g. conversational
  sentiment already extracted by `distill.ts`), a future pass could feed it
  into `composePatternNudge`'s priority order without changing the ritual
  shape.
- **Autonomous mitigation** (auto-lightening the task queue, auto-snoozing a
  goal). v1 only ever offers/reports, matching Day Brief's own report-only
  posture; an autonomy-dial-gated action would be a separate, later decision.
- **Trailing-window tuning** (the 40%/12-count/2-of-4/3-day constants above)
  is a best-first-guess; expect the operator to retune after living with it,
  the same way heartbeat's other thresholds have been retuned in the past.

---

### Research summary (informing the above — see full agent report if needed)

Kernel concepts, goals store, heartbeat/rituals, notify(), telemetry, and
scope-wall constraints were mapped before this design was drafted. Key
findings: `goal_checkins` already has everything needed for miss-pattern
detection; `notify()` is the single reusable delivery choke point; there is no
existing "should I say this now" scoring function analogous to
`decidePolicy()` — the cooldown/priority logic above is that missing piece,
scoped narrowly to this one ritual rather than built as a generic engine.
