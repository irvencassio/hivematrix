# Message Lane Fallback Alert (Home Page) — Design

## Context

Follow-up to task `f3d9e48e273c4c1496a22fcd`, which investigated four Message Lane
issues and got stuck awaiting a reply on Issue 3 specifically: "is a corner-of-rail
dot + tooltip 'unmissable' enough for a fully-blocked channel, or does 'critical...
not a silent failure' call for escalating to a banner?" (see
`docs/superpowers/specs/2026-07-15-message-lane-fixes-design.md`, Issue 3 section —
uncommitted, belongs to that other in-flight task; not touched by this one).

This task's request answers that question: banner, richer than either option that
doc sketched — must include a clear indication, a link/reminder to the access ledger,
config-vs-system-failure guidance, and actionable next steps; must appear on home
page load, disappear on recovery, and not spam (one-time visibility until dismissed
or resolved).

Scope is narrower than the other doc: **only** the home-page warning banner. Issues
1 (FDA false negative), 2 (config lost on update), and 4 (Browser Lane re-verify) are
explicitly out of scope — they belong to the other task/branch.

The access ledger path in the request (`~/brain/hive/playbooks/projects/...`) doesn't
exist; the real file is `~/_GD/brain/hive/playbooks/projects/solo-founder-os-access.md`
(confirmed by reading it). It's a running status/accountability log (mixes system
status rows with unrelated business-commitment tracking for a "Weaver" persona), not
a step-by-step fix guide — so the banner should treat it as a "here's the operational
history" pointer, not a source of live health data. Its most recent Message Lane rows
(2026-07-14) already describe a state that today's `git log` shows partially fixed
(`ec03eb06 fix(messagebee): one iMessage per (runId, recipient)`, released as 0.1.202)
— confirming the banner must be driven by live checks, never by reading this file.

## Non-Goals

- No release/build/publish step — operator releases (per task instructions).
- No changes to Issues 1/2/4 from the sibling design doc — this is Issue-3-equivalent
  only, as its own scoped topic/branch.
- No new persistent store (DECISIONS.md Q14) — dismiss-state is client-side
  (localStorage), health is computed from existing columns, nothing new is written.
- No new Tauri plugin/capability (e.g. `tauri-plugin-shell` for Finder-reveal) and no
  new "restart the whole daemon" console button — both are real new surface with real
  scope (a daemon restart affects every lane, not just Message Lane); flagged below as
  a considered-and-deferred option pending explicit operator sign-off, not silently
  built.
- No cross-channel arbitration engine (comparing telegram/email liveness) — see Open
  Question 4.

## Investigation

Prior research (this session, 4 parallel passes) confirmed, with file:line citations:

**Home page render path.** `renderOverview()` (`console.ts:2039-2061`) fills `#session`
or center column; called from the dominant `refresh()` loop (`console.ts:5518-5547`),
which runs once at boot and every 5s (`setInterval(refresh, 5000)`, `console.ts:9855`).
`refresh()` already does one `Promise.all` of ~7 endpoint calls, then invokes a battery
of `render*()` functions — the established pattern for hooking a new live indicator into
the home page is: add one more endpoint call to that `Promise.all`, add one more
`render*()` call alongside the others.

**Health signal, currently scattered and partly write-only.**
- `getMessagebeeStatus()` (`messagebee/status.ts:22-46`) returns
  `{enabled, chatDbReadable, chatDbDetail, chatDbProbeSkipped, chatDbProbeReason?,
  identities, selfHandles}`. `chatDbProbeReason` is only ever set to `"channel_disabled"`
  today — the broken-but-enabled case has a reason internally
  (`imessage.ts:25-29`: `"missing" | "open_failed" | "schema_failed"`, from
  `probeChatDbAccess()`, `imessage.ts:96-127`) that `status.ts` computes but drops
  before returning it (`status.ts:40-41` keeps only `probe.detail`, not `probe.reason`).
  The code's own comment at `imessage.ts:97-98` says the open/schema split exists
  specifically "so the UI can avoid blaming Full Disk Access for schema/drift
  failures" — i.e. this **is** the codebase's existing config-vs-system distinction,
  just not surfaced yet.
- `message_channels.lastError`/`lastInboundAt`/`lastOutboundAt`
  (`db/index.ts:159-174`, written by `messagebee/store.ts:109-120`) are **confirmed
  write-only** — grepped the whole repo, nothing reads them back anywhere. This is
  the literal mechanism behind "not a silent failure": the poller
  (`poller.ts:176-191`, ticking every 3s per `POLL_INTERVAL_MS`, `poller.ts:38`)
  already writes real error text here on every failed tick (e.g. the self-handle
  loop-guard block, or an osascript send failure) even while `chatDbReadable` stays
  `true` — so `chatDbReadable` alone is insufficient; a channel can read as "healthy"
  while every send is silently failing. `selfHandles` emptiness is likewise never
  evaluated as a health condition anywhere (confirmed via grep) — it's a known real
  failure mode (the `weaver-message-lane-fix` skill exists specifically to correct it
  manually) but invisible to any status check today.
- `channelStatus()`/`healthy` flag (`service-manager.ts:583-594`,`:507`) and
  `system-readiness`'s 6 checks (`system-readiness/index.ts`) both exist but are
  **Settings-modal-only** today (`GET /lanes` → `renderSettingsLanes()`;
  `GET /system/readiness` → `renderSystemReadiness()`, both scoped to Settings →
  Lanes tab, not the home page).

**"Configured out-of-chat method."** No single-channel-selector concept exists
(`notify.ts` fans out to every channel in `notify.channels: string[]`
simultaneously — a multi-select set, not a "pick one" field). The one real, existing
gate that matches the request's intent: `notify()`'s iMessage leg is itself gated on
`isChannelEnabled()` from `messagebee/store.ts` (`notify.ts:88`) — so
`notify.channels.includes("imessage") && isChannelEnabled()` is a precise, reuse-only
way to express "the operator has opted into iMessage as an out-of-chat method AND
it's actually switched on," with no new concept invented. Android push isn't live yet
(no Firebase project — `docs/companion-ports/MASTER-PLAN.md:22`) and the Android app
is a separate UI entirely, so "Android users may have other methods" doesn't need
in-app detection logic — seeAlso Open Question 4.

**Remediation actions.** Only one relevant action is both real and already
console-reachable: `openFullDiskAccess()` → `POST /system/open-pane` →
`openSystemSettingsPane()` (`onboarding/actions.ts:127-139`) — opens the FDA System
Settings pane directly, allowlisted to fixed TCC deep links, explicitly documented as
never opening arbitrary URLs/files. Nothing else qualifies as reuse:
- **Reveal-in-Finder / open-local-file:** does not exist anywhere in the repo. No
  `tauri-plugin-shell`/`opener`, no capability grant for one. Building it is a new
  Tauri dependency + capability change, not a wire-up.
- **"Restart Message Lane":** Message Lane has no dedicated launchd process — it's an
  in-daemon poller (`service-manager.ts:70-78`, `manageable: false`, explicit
  comment: "no launchctl toggle"). The only thing restartable is the *entire* daemon
  (`restartViaLaunchd()`, `daemon-update.ts:72-79`), and that function's one live
  caller today is an automatic 60s self-heal loop — it is not exposed as a console
  button anywhere. Wiring "Restart Message Lane" as a button would really mean
  "restart the whole daemon, all lanes," a blunter and riskier action than the label
  implies.

**Complexity budget (Q14 / scope-wall).** A banner that reads existing state and
calls the one existing open-pane action is a pure adapter — zero new tables, zero new
orchestration primitives, zero new Bee-branded concepts. Confirmed no scope-wall rule
is at risk. Dismiss-state as localStorage (new key, following the established
try/catch idiom at e.g. `console.ts:4711`) avoids a new DB column entirely.

## Approaches

**A. Standalone health-summary function + new lightweight endpoint.** Add a
`getMessageLaneHealthSummary()` (new small function, `messagebee/status.ts` or a new
sibling module) combining `enabled`, `chatDbReadable`/reason, and — for the first time
— `lastError`/`updatedAt` read back from the DB row, classified into
`ok | configuration | system`. New route `GET /messagebee/health-summary`. console.ts
adds this to the `refresh()` `Promise.all`, adds `renderMessageLaneBanner()` alongside
the other `render*()` calls, injects markup into `renderOverview()`'s template.
Dismiss via a new localStorage key, auto-cleared the instant health flips back to `ok`.

**B. Fold into `system-readiness` as a 7th check.** Same classification logic as A,
but expressed as a `messageLaneCheck()` added to the existing
`{id, label, severity, summary, nextAction, repairActions}` shape
(`system-readiness/index.ts:12-20`) and assembled into `getSystemReadinessReport()`
(`index.ts:269-285`). console.ts's home-page banner becomes a thin renderer: call the
already-existing `/system/readiness` endpoint from `refresh()`, filter to the one
`id === "message-lane"` entry (not all critical items — stays scoped to this
request, doesn't surface unrelated criticals like `lane-apps` on the home page as a
side effect), render if `severity` is `warn`/`critical`. Same dismiss/localStorage
mechanics as A. Bonus: Settings → Lanes' existing readiness panel picks up the same
check for free, with zero extra work.

**C. Extend `/connectivity`'s `posture.capabilities`.** Considered, not proposed as a
real option: this is already home-page-live (`renderConn()`, right rail, 5s loop) with
zero new plumbing, but (1) it renders as small inline pills, not a banner — can't hold
the required link/guidance/next-steps content, so it under-delivers what was asked;
and (2) `/connectivity`'s posture is a different domain concept (model/provider
reachability), and Q14 explicitly warns against forcing unrelated decisions together
("verified NOT to unify... collapsing them would ADD complexity"). Rejected.

## Recommendation

**B.** Same shape as the "reuse the shared scaffolding, don't re-roll it" rule in
AGENTS.md's complexity-budget section — `system-readiness` is the existing primitive
built precisely for "severity + summary + nextAction," so extending it is the adapter
move, not a new one. The cost over A is marginal (one more check function, same
classification logic either way); the benefit is real (Settings → Lanes gets the same
signal for free, one health-check module instead of two).

## Open Questions for the operator

1. **Placement scope.** The request says "home page" / "home page load" — I'm reading
   this literally: the banner renders inside `renderOverview()`'s own template, so
   it's visible when Overview is showing but not while a task is selected. Alternative:
   make it globally persistent (visible regardless of selection, e.g. in the page
   header). Defaulting to **home-page-only** (literal reading) unless told otherwise.

2. **Config-vs-system classification.** Proposed mapping, using the reason codes that
   already exist in the code but aren't surfaced yet:
   - `chatDbReadable === false`, reason `open_failed`/`missing` → **configuration**
     ("Full Disk Access likely isn't granted to the daemon process").
   - `chatDbReadable === false`, reason `schema_failed` → **system** (DB
     schema/drift issue, not a permissions problem).
   - `chatDbReadable === true` but `lastError` is recent → **system** (e.g. the
     poller's send/receive path is failing even though the DB read itself works) —
     the actual stored error text is shown verbatim regardless of bucket.
   - Channel disabled (`!enabled`) → banner does not fire at all (that's an
     intentional off-state, not a degradation).
   Defaulting to **this mapping** unless corrected.

3. **Actionable next steps — text vs. live buttons.** Proposing **text-only**
   guidance for v1, reusing only the one action that's already real
   (`openFullDiskAccess()`, one click, opens the actual System Settings pane) —
   "restart Message Lane" and "reveal the ledger file in Finder" would be new Tauri
   surface / a whole-daemon restart button, which I'm not building without an explicit
   yes given the blast radius (restarts every lane, not just this one). Defaulting to
   **text steps + the one real button** unless you want the live actions built too.

4. **"No alternative channel" gate.** Proposing to gate purely on
   `notify.channels.includes("imessage") && isChannelEnabled()`, without attempting to
   check whether telegram/email are also configured-and-healthy (no live health signal
   exists for either, and the access ledger documents iMessage as the sole real-time
   out-of-chat path today). Reading "Android users may have other methods" as
   explaining why this desktop-only banner needs no Android-awareness (it's a
   different app/UI entirely), not as a request for cross-channel arbitration.
   Defaulting to **this simpler gate** unless told otherwise.

Leaning toward proceeding with all four defaults above (B + the 4 defaults) unless
told otherwise, to keep this moving — happy to adjust any one of them individually.

## Verification

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

`qwen-readiness.mts` not required — no local-model paths touched. No release/build/
publish step; operator releases.
