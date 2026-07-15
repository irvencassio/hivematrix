# Message Lane Reliability + Browser Lane Verify Caching — Design

## Context

Three blocking Message Lane issues plus one secondary Browser Lane issue, reported
by the operator with a screenshot (FDA toggle ON in System Settings, setup dialog
shows it disabled) and the access ledger
(`~/_GD/brain/hive/playbooks/projects/solo-founder-os-access.md`), which documents
iMessage repeatedly cycling through blocked/degraded states invisibly.

Four parallel research passes traced each to a confirmed root cause (file:line
citations below). Two cross-cutting patterns emerged that are worth naming even
though — per Q14's "verified NOT to unify" precedent — each fix stays local:

- **Identity fragility across updates** (Issues 1 & 2): the daemon's process
  identity and the app's bundle identifier are not stable/singular, so FDA grants
  and update assumptions both silently break at that seam.
- **In-memory state not surviving the update-triggered relaunch** (Issues 2 & 4):
  `restartViaLaunchd()` fires on every applied update; anything cached only in
  process memory resets to "unknown" at that point, regardless of whether the
  relevant code actually changed.

## Non-Goals (all issues)

- No release/build/publish step — operator releases (per task instructions).
- No new persistent store, orchestration primitive, or product concept without a
  DECISIONS.md entry (Q14 complexity budget).
- No changes to the launchd daemon-supervision model itself (`src-tauri/src/lib.rs`
  documents this as an explicit, deliberate design: "launchd owns 24/7
  supervision... the app must NOT spawn its own child") — that's a bigger
  architectural change than this task warrants.
- No macOS TCC database edits (can't be done programmatically anyway).

---

## Issue 1 — Full Disk Access false negative

### Investigation

Traced end-to-end: dialog → `POST /onboarding/setup/full-disk-access/probe`
(`server.ts:1182-1184`) → `getMessagebeeStatus({probe:true})` (`status.ts:22-46`)
→ `probeChatDbAccess()` (`imessage.ts:100-127`) — a fresh, uncached probe every
call. **No staleness/caching bug exists JS-side.**

The real cause: the daemon that performs the read is a *different process
identity* than the app bundle the user grants FDA to. Confirmed via
`src-tauri/src/lib.rs:123-149` (`spawn_bundled_daemon`) and
`src/lib/onboarding/app-bundle.ts:22,46-55` — the daemon binary is
`Contents/Resources/daemon/bin/node`, separately re-signed
(`scripts/sign-bundled-machos.sh:32-33`) but its own Mach-O identity. Once
installed, it's not even a child process of the app — it's an independent
`launchd` LaunchAgent (`src/lib/onboarding/actions.ts:51-79`,
`buildDaemonPlist`), so there's no parent/child "responsible process"
attribution back to "HiveMatrix" for TCC to use. The System Settings entry the
user sees and toggled ON covers the app bundle, not this detached binary.

This is a **third occurrence** of the same symptom class — two prior design docs
(`docs/superpowers/specs/2026-06-13-messagebee-permission-probe-design.md`,
`2026-07-03-first-run-setup-reliability-design.md`) already fixed the "lossy
readiness signal" (structured probe reasons, the setup-capability model in
`setup-status.ts`) but explicitly flagged this exact identity gap as unsolved
("still cannot directly prove which macOS app/process has Full Disk Access") and
scoped it out. The 2026-07-03 doc's own recommendation — use the real
readability check, not a proxy — is still correct; the probe isn't lying. What's
missing is telling the user *why* it disagrees with what they see in System
Settings, and giving them a real fix.

Compounding: the current remedy text (`imessage.ts:111`, "...then restart
HiveMatrix") is actively wrong. `lib.rs:498-503` shows relaunching the GUI app
only compares daemon *version* and no-ops if versions match — quitting/reopening
HiveMatrix never touches the already-running launchd daemon. The only
`launchctl kickstart` call sites today are version-drift self-heal
(`updater/daemon-update.ts:73-78`) and one-time bootstrap
(`actions.ts:141-147`) — never permission-triggered.

### Approaches

**A. Fix the message only.** Correct the `open_failed` remediation text to name
the actual daemon binary and stop telling users to "restart HiveMatrix" (which
does nothing here). Smallest possible change.

**B. A, plus a real remediation action.** Add an action that resolves the
daemon's real path (`getBundledDaemonPaths()`) and either reveals it in Finder
(so it can be dragged into the FDA list's `+` picker — System Settings won't
show a hidden `Contents/Resources` binary any other way) or opens the FDA pane
directly. Also wire a genuine "restart the daemon" action
(`launchctl kickstart -k`, mirroring `daemon-update.ts:73-78`) for the case
where the daemon *was* already granted FDA under a previous entry and just
needs the process to pick it up.

**C. Architectural: unify the daemon and app under one FDA identity.** Would
close the gap for good but touches the daemon-supervision model two prior docs
and the current architecture deliberately keep separate — needs its own
DECISIONS.md entry if ever pursued, not a 2-5-minute task.

### Recommendation

**B.** Same shape as the calendar-permission-misdiagnosis precedent (fix the
misleading diagnosis + close the actual actionability gap, both small, no new
concept). C is out of scope per Non-Goals.

**Reframe for the operator:** this isn't the probe "incorrectly reading" FDA
state — the daemon genuinely cannot read chat.db, because it's a process macOS
has never separately authorized. The bug is that the app doesn't say so; it just
says "disabled," which reads as false when the visible HiveMatrix toggle is on.

---

## Issue 2 — Config lost on update

### Investigation

Config lives in `~/.hivematrix/hivematrix.db` (`db/index.ts:11-16`,
`updater/updater.ts:28-36` — both agree), a fixed dot-dir path under `$HOME`,
**not** namespaced by bundle ID or version. This rules out "DB path drifts
between versions." `message_channels`/`message_identities`
(`db/index.ts:159-189`, migration v5) are additive/idempotent — no destructive
migration exists.

The actual gap: **two independent update mechanisms exist, and the safe one
isn't used.**
- Real production path: Tauri's native updater
  (`src-tauri/src/lib.rs:422-462`, `check_for_update` →
  `download_and_install` → `kickstart_launchd_daemon`) and the manual Install
  button (`updater/feed-check.ts:126-162`, `applyUpdateViaRelaunch` — just
  `pkill` + `open -a HiveMatrix`). Neither touches the DB at all — no backup,
  no restore, no rollback. They only swap the `.app` bundle and restart
  processes.
- `applyUpdate()` (`updater/updater.ts:178-218`) is a fully-built
  download→verify→**backup DB**→install→restart→probe→**rollback-on-failure**
  pipeline, exactly what `hive-update-proof`
  (`scripts/update-apply-proof.mts`) exercises and asserts. **Confirmed via
  grep: it is called only from the proof script and its own test. Never from
  `server.ts`, `console.ts`, or the Rust shell — dead code in production.**
  The proof's own docstring admits it: "Does NOT touch the live daemon
  bundle — installs to a staging dir and uses a no-op restart." It proves a
  pipeline that isn't wired to what actually runs.

Since the DB path is stable and migrations are additive, there's no static
"smoking gun" delete in the real update path. Ranked candidates for what's
actually erasing rows, since the DB itself likely survives:
1. `setSelfHandles()` (`messagebee/store.ts:187-193`) replaces the array
   wholesale, not merge — a post-update onboarding re-render or resubmit with
   blank/partial data would silently discard existing handles. (The existing
   `weaver-message-lane-fix` skill is a manual runbook for correcting exactly
   this drift, though its known trigger there is data-entry, not
   update-specific — worth checking if it's the same mechanism.)
2. TCC/FDA invalidation on a code-signature or bundle-identifier change (one
   such rename, `com.cassio.hivematrix` → `com.irvcassio.hivematrix.core`, is
   referenced at `feed-check.ts:24`) would make `probeChatDbAccess()` fail
   post-update — presenting as "Message Lane not configured" even though the
   DB rows are untouched. This is Issue 1's identity fragility resurfacing.

### Approaches

**A. Write the failing test first, against the real path.** Per AGENTS.md TDD
discipline, I have ranked candidates, not a confirmed single cause. Extend
`update-apply-proof.mts` (or a new focused test) to assert
`message_channels`/`message_identities` rows survive the *actual* production
update path — bundle swap + `kickstart_launchd_daemon` — not the staged no-op
`applyUpdate()` path it currently tests. This will show whether rows are
literally lost (candidate 1) or merely misreported (candidate 2).

**B. Wire the existing, tested `applyUpdate()` backup/rollback pipeline into
the real production path** (`lib.rs`'s `check_for_update` /
`ensure_bundled_daemon_handoff`, and `feed-check.ts`'s manual install). Reuses
already-built, already-tested code — no new concept. Fixes the structural gap
(today literally nothing backs up the DB before a real update) regardless of
which specific hypothesis explains this incident.

**C. Audit and fix wholesale-replace-with-empty call sites**
(`setSelfHandles`/`configureMessageBee`, `onboarding/actions.ts:255-320`) if
A's test implicates candidate 1.

### Recommendation

**A → B unconditionally → C if A's test implicates it.** B is correct
independent of root cause (an update pipeline with zero DB safety net is a
landmine either way) and directly satisfies the operator's "(a) preserve
automatically" framing using code that already exists and is already tested.
A is the honest way to find out if C is also needed rather than guessing.

---

## Issue 3 — Home screen warning for degraded Message Lane

### Investigation

No home-screen lane-health indicator exists today. What exists:
- `.tools-dot` (`console.ts:922-927`) — wired only to the MCP Servers rail
  item.
- `.usage-status-dot` (`console.ts:338-341`, markup `console.ts:1856`) — the
  right precedent: a dot in the **persistent right rail** (part of the
  home/Overview layout, not a sub-panel), driven by client JS
  (`checkUsage()`, `console.ts:5664-5710`) on the existing 5s/30s refresh
  cycle (`console.ts:9855,9860`). No new poll loop needed for a new dot of
  this kind.
- Per-lane dots exist in `renderSettingsLanes()` (`console.ts:8571-8596`) via
  `GET /lanes` → `channelStatus()` — but only inside the Settings modal, not
  the home screen.
- `system-readiness` (`src/lib/system-readiness/index.ts:12-28,269-295`) is
  the right conceptual home for a new check: it already models
  `severity: ok|info|warn|critical` with `summary`/`nextAction`/
  `repairActions`, assembling 6 checks today. **No Message Lane check exists
  among them.**

The signal to drive it already exists, mostly unused:
`channelStatus()` (`lanes/service-manager.ts:583-594`) sets
`healthy: ch.enabled ? ch.permitted : null` from `chatDbReadable` — the only
place any "healthy" flag is computed today, and it only reaches Settings →
Lanes. `recordError()` (`messagebee/store.ts:117-120`) writes to
`message_channels.lastError`/`lastInboundAt`/`lastOutboundAt` on every
failure — **confirmed via grep: nothing anywhere reads these back.** It's a
write-only column. `selfHandles` emptiness (the actual historical blocker per
the access ledger) is never evaluated as a health condition anywhere. The
poll loop already runs (`startMessageBeePoller` → `startPollLoop`,
`poller.ts:196-201`, boot-started at `daemon/index.ts:150-151`) — no new loop
needed, it already refreshes `lastError` every 3s.

### Approaches

**A. Dot only.** Add a Message Lane check to `system-readiness`
(new entry near `index.ts:278-285`: enabled but `!chatDbReadable`, or enabled
with empty `selfHandles`, or a stuck send-cap reservation → `warn`/`critical`).
Surface via a `.usage-status-dot`-style indicator in the existing right rail.
Cheapest, fully reuses existing conventions and refresh cycle.

**B. A, plus finally reading back `lastError`.** Surface the actual stored
error text in the dot's tooltip/detail line — directly answers "not a silent
failure," since the *reason* becomes visible, not just a colored dot.

**C. New full-width banner primitive** for `critical`-severity items,
independent of the rail. Matches the operator's word "critical" more
literally, but `.stuck-banner`/`#lic_status_banner` are scoped to specific
tabs/tasks today — a home-screen-global banner would be a genuinely new
surface, not reuse.

### Recommendation

**B**, with an open question for the operator: is a corner-of-rail dot +
tooltip "unmissable" enough for a fully-blocked channel, or does "critical...
not a silent failure" call for escalating to a banner (C) specifically when
severity is `critical`? Leaning B-only unless told otherwise — it's the
smallest change consistent with the complexity budget, and the rail is part
of the screen you land on, not buried in a modal.

---

## Issue 4 (secondary) — Browser Lane re-verifies unnecessarily

### Investigation

Two independent, compounding causes, both confirmed in code:

1. **Verify cache is in-memory, wiped every daemon restart.**
   `lane-setup/index.ts:80-83` — the code comment states this outright:
   "Cleared on daemon restart → signingState honestly reads 'unknown' until
   the operator verifies again." `pickNextAction()` (`index.ts:123-145`)
   recommends `"verify"` whenever state is `"unknown"` — true after *every*
   restart. And the daemon restarts on every applied update
   (`restartViaLaunchd()`, `updater/daemon-update.ts:76-79`,
   `launchctl kickstart -k`, unconditional). `verifyLaneApp`
   (`lane-apps/verify.ts:42-81`) itself has zero memoization — every call is
   a fresh `codesign`/`spctl`/launch-probe cycle.
2. **Build-ID isn't scoped to Browser Lane's own files.**
   `scripts/package-browser-lane-app.mjs:10-21` (`stampBuildId`) sets the
   build identity from `git rev-parse --short HEAD` for the **whole repo**,
   not `browser-lane-app/`. `isCurrent()` (`lane-apps/index.ts:84-89`)
   requires exact match — so any unrelated commit anywhere in the monorepo
   flags a byte-identical Browser Lane install as stale, forcing
   reinstall → signing state reset → reverify.

Same pattern as Issue 2: in-memory state discarded by the unconditional
update-relaunch. No direct call-path sharing with Issue 2's update mechanism
was found (`update-apply-proof.mts:56` explicitly no-ops its restart hook),
so this is an independent instance of the same *pattern*, not a shared bug —
consistent with Q14's "verified NOT to unify" precedent, each fix stays local.

### Approaches

**A. Scope the build-ID hash to `browser-lane-app/` only.** Directly kills
the literal reported symptom ("reruns even when Browser Lane's own code
hasn't changed"). Doesn't stop a same-code restart from still forcing a
reverify.

**B. Persist the verification cache** (DB row, one of the two sanctioned
schema files — not a new store) keyed by installed-bundle identity (CDHash),
so a restart alone no longer forces "unknown" → reverify; only an actual
bundle change does.

**C. Both.** Same shape as the calendar-bug precedent: two small, independent
causes, fix both.

### Recommendation

**C**, done last — explicitly secondary per the operator's framing.

---

## Verification (all issues)

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

`qwen-readiness.mts` not required — none of these touch local-model paths.
No release/build/publish step; operator releases.
