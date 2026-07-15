# Lane Setup Modal Permission Staleness — Design

## Context

Operator report (2026-07-15, ~1pm): Message Lane and Mail Lane setup both show
FDA/Automation as disabled (red) while System Settings shows the corresponding
toggle enabled (blue). Framed as a regression of the same-day Message Lane FDA
fix (`docs/superpowers/specs/2026-07-15-message-lane-fixes-design.md` Issue 1,
shipped in `5ed170df`/`368189e9`, released as 0.1.204) that "didn't work," now
also appearing in Mail Lane.

## Investigation

Live-tested the running daemon (v0.1.205, `curl` against `127.0.0.1:3747` with
the daemon auth token) rather than reasoning from source alone:

- `POST /messagebee/probe`, `GET /messagebee` (passive), and `GET
  /onboarding/setup` **all currently report Message Lane FDA as granted**
  (`chatDbReadable: true`), matching System Settings. `getMessagebeeStatus()`
  self-probes whenever the channel is enabled regardless of the passive/active
  distinction (`status.ts:24`, `shouldProbe = opts.probe === true || enabled`),
  so there is no live false-negative in the detection logic itself right now.
- `POST /mailbee/probe` also currently reports `mailControllable: true`
  (Mail.app happens to be running). `getMailbeeStatus()` correctly threads
  `allowLaunch: opts.probe === true` into the real AppleScript probe
  (`mailbee/status.ts:47`) — the probe endpoint is not the false-negative
  source either.

So the *detectors* are not lying, confirming the existing 2026-07-15 design
doc's Issue 1 finding that "the probe isn't lying." The false negative the
operator saw is real but lives one layer up, in how `src/daemon/console.ts`'s
two setup **modals** reconcile a fresh active probe against a stale/passive
refresh — a different bug class than Issue 1 (which was about the daemon
binary's own FDA identity, already fixed) and not covered by any existing
design doc. Two distinct, confirmed bugs, one per lane:

### Bug A — Mail Lane: passive poll clobbers a successful probe (reproducible now)

`openMailBeeSetup()` (`console.ts:5397-5418`) starts two independent,
concurrently-running loops:
- `pollMl()` (`console.ts:5403-5411`) — passive `GET /mailbee` every 3s,
  unconditionally re-renders via `renderMailBeeState(data)`. Runs for as long
  as the modal is open; nothing ever stops it.
- `mlRetryAutomationProbe()` (`console.ts:5445-5471`) — active `POST
  /mailbee/probe` every 2s, stops itself (`mlStopAutomationRetry()`) the
  moment `data.mailControllable` is true.

While the Mail Lane *channel* is still off (true for the entire setup flow,
until `submitMailBee()` is called), `getMailbeeStatus()`'s passive path
returns `mailControllable: false, mailProbeSkipped: true` (confirmed live —
`shouldProbe` requires `probe===true || enabled`, and `enabled` is false).
`renderMailBeeState()` (`console.ts:5481-5509`) does not check
`mailProbeSkipped` at all — it renders a skip identically to a genuine denial.

Sequence: probe succeeds → mark turns green → retry loop stops calling
render. Passive loop keeps calling render every 3s with skip-data → mark
flips back to red and **stays red**, because nothing is left running that
would flip it back to green. The end state a user actually sees is red,
despite permission being genuinely granted — matches the report exactly.

Confirmed live: `POST /mailbee/probe` → `mailControllable: true`; `GET
/mailbee` (what `pollMl` fetches) → `mailControllable: false,
mailProbeSkipped: true`, same moment.

### Bug B — Message Lane: "Restart daemon" never re-checks the open modal

Issue 1's shipped fix added `revealMessageBeeDaemon()` and
`restartMessageBeeDaemon()` (`console.ts:5188-5211`) for exactly the scenario
where FDA was just granted to the daemon binary and the process needs a
restart to pick it up. `restartMessageBeeDaemon()` correctly calls `POST
/messagebee/restart-daemon`, then schedules `setTimeout(refresh, 3000)`.

But `refresh()` (`console.ts:5577-5606`) never touches `mb_fda_mark` /
`renderMessageBeeState` — it re-renders the board, onboarding checklist,
connectivity, metrics, approvals, skills, MCP, observability. Message Lane's
modal has **no poll loop at all** (unlike Mail's), and no other call site
re-probes it after a daemon restart. Status text says "Daemon restarting —
re-checking access…" and then nothing happens: the mark stays whatever it was
before the restart, even though the restart may have fixed it (confirmed live
— the daemon this operator is running right now reports FDA granted, entirely
consistent with a restart having silently fixed it while the modal, if still
open at the time, would show nothing changed).

This is the most likely explanation for "the fix didn't work": the operator
plausibly used the exact remediation flow Issue 1 shipped (reveal binary →
grant in System Settings → restart daemon) and it plausibly worked at the
daemon level, but the modal never told them so.

### Why "systemic" is the right instinct, wrong mechanism

Both bugs are the same *shape* — a setup modal's rendered permission mark can
go stale relative to backend truth — but different mechanisms (an unguarded
passive-clobber loop vs. a restart action that forgot to re-render its own
modal), in different functions, requiring different fixes. This mirrors
Q14's repeated finding in this file's history: same symptom class, local
causes, no shared abstraction to introduce. Not a "the permission checker is
broken" bug — the checkers are correct every time they're actually called;
the modals just don't reliably call them at the right times.

## Non-Goals

- No changes to `probeChatDbAccess`, `probeAppleMail`, `getMessagebeeStatus`,
  or `getMailbeeStatus` — confirmed correct by live testing above.
- No new persistent store or polling primitive (Complexity Budget). Bug A's
  fix reuses the existing `mailProbeSkipped` field already returned by the
  server; Bug B's fix reuses the existing `/messagebee/probe` +
  `renderMessageBeeState` pair `openMessageBeeSetup` already calls.
- No release/build/publish step — operator releases.
- Not attempting to unify Mail Lane's and Message Lane's modal polling into a
  shared frontend helper. Each fix is 2-6 lines. A shared abstraction for two
  call sites this small would be the premature generalization the complexity
  budget warns against; revisit only if a third modal needs the same pattern.

## Approaches

### Bug A (Mail Lane)

**A1. Guard the automation mark against skip-data.** In
`renderMailBeeState`, only update `ml_auto_mark` / `ml_auto_detail` when
`!(data && data.mailProbeSkipped)`. A skip carries no information about the
permission — leave the last real result (initial default, or a prior
successful probe) exactly as it was. `ml_chan_mark` and the identity chips
keep updating on every passive tick unchanged, since those are exactly what
the passive poll is for. Mirrors the skip-vs-denied distinction
`renderMessageBeeState` already makes for FDA (`console.ts:5333-5343`) —
same pattern, not a new one, just applied where it was missing.

**B1. Stop `pollMl` once automation is confirmed, like `mlRetryAutomationProbe`
does.** Rejected: `pollMl` still needs to run for channel/identity updates
after automation is granted (e.g. the user adds a trusted sender next).
Stopping the whole loop would regress that.

### Bug B (Message Lane)

**A2. Have `restartMessageBeeDaemon()` re-probe and re-render the modal
directly**, the same way `openMessageBeeSetup()` does, before/alongside the
existing `refresh()` call — `api('/messagebee/probe', {method:'POST'})` →
`renderMessageBeeState(r)`. Smallest possible change, reuses the exact
existing probe+render pair.

**B2. Add a general poll loop to the Message Lane modal**, mirroring Mail's
`pollMl`. Rejected as disproportionate to the bug — the only gap is one
action (`restartMessageBeeDaemon`) not re-checking; a whole new recurring
loop would introduce more surface (and, per Bug A, its own clobbering risk)
to fix a one-call-site problem.

## Recommendation

**A1 + A2.** Both are the smallest change that removes the actual defect,
reuse an existing field (`mailProbeSkipped`) or an existing call pair
(probe+render), and match precedent already established elsewhere in this
same file. Total surface: two small, independent edits to
`src/daemon/console.ts`, each in a different function, each covered by a
test that fails on current code and passes after the fix.

## Verification

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

Manual: reopen Mail Lane setup with Automation already granted but the
channel not yet enabled — mark should reach green and stay green past 10+
seconds (covers 3+ passive poll ticks). Click "Restart daemon" in Message
Lane setup — status text should resolve to an actual granted/denied result
within a few seconds of the daemon coming back up, not hang on "re-checking
access…" indefinitely.

No release/build/publish step. Operator releases.
