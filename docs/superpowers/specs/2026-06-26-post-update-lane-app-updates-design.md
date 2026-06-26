# Post-autoupdate Lane app update handling — Design

> Date: 2026-06-26
> Status: Approved (builds on the stale-detection foundation in b622b53)

## Problem

HiveMatrix auto-update replaces the main app and re-bundles fresh Browser Lane /
Terminal Lane artifacts, but the **standalone Lane apps are installed explicitly**
and are not auto-replaced. On another Mac, after HiveMatrix updates, a stale
`/Applications/Terminal Lane.app` (e.g. build 2, an old HMBuildId) keeps winning
LaunchServices, so the operator still sees the old Lane app. The plumbing to
*detect* this already exists (`stale_copy`, `shadowed`, build-identity comparison
via `HMBuildId`), but the operator has to notice a buried card badge and repair
each lane one at a time.

## What exists (b622b53)

- `getLaneSetup()` → per-lane `installState` (`not_installed|current|outdated|
  stale|broken`), `shadowed`, `activeIsStale`, `installedCopies[]`.
- `LaneAppState` carries `installedBuildId` / `expectedBuildId` (HMBuildId).
- `installLaneAppById(id)` (returns active path + shadow warning) and
  `repairApplicationsCopy(id)` (replace a writable stale `/Applications` copy,
  else exact instructions).
- Console `renderLaneSetup()` shows per-card stale badge + shadow warning + a
  per-lane "Update /Applications copy" repair button.

## Decisions

### 1. Surface the aggregate "needs update" state

- `LaneSetupEntry` gains `installedBuildId: string|null`, `bundledBuildId:
  string|null` (from `LaneAppState.installedBuildId/expectedBuildId`), and
  `needsUpdate: boolean`.
  - `needsUpdate = installState ∈ {outdated, stale} || shadowed`. (`broken` →
    Verify, `not_installed` → Install — those are separate, not "update".)
- `LaneSetup` gains `updateSummary: { needsUpdate: string[] /* displayNames */,
  count: number, anyShadowed: boolean }`, so one read tells the UI which Lane
  apps are stale.

### 2. Prominent post-update warning in Settings → Lanes

`renderLaneSetup()` renders, **above the cards**, a warning banner when
`updateSummary.count > 0`:

> ⚠ HiveMatrix updated. Lane apps need update: **Terminal Lane**.  [Update Lane Apps]

The banner names the stale lanes and offers one **Update Lane Apps** button
(`laneUpdateAll()`). When a stale copy is the active `/Applications` copy, the
banner adds "a stale /Applications copy is active" so the operator knows why.

### 3. Safe `Update Lane Apps` (update-all) action

`updateAllStaleLaneApps(deps?)` (lib) iterates the lanes needing update and, for
each: installs/updates from the bundled artifact (`installLaneAppById`), then —
if the active copy is the `/Applications` copy and still stale and **writable** —
replaces it (`repairApplicationsCopy`). It returns a structured, secret-free
result per lane:

```ts
{ id, displayName, updated, installedPath?, activePath?, replacedApplications?, shadowed, warning? }
```

- Reports **exactly which path** was updated.
- If `/Applications` is active+writable → replaces it; reports `replacedApplications`.
- If not writable → `warning` with exact remove/update instructions (never sudo).
- **Never leaves a silently-shadowed user copy**: if after install the user copy
  is still shadowed and the `/Applications` copy couldn't be replaced, the result
  flags `shadowed: true` + the instructions, and the banner/card keep showing it.
- Injectable deps (`getStates`, `install`, `repair`) so it is unit-testable
  without touching the filesystem.

Endpoint: `POST /lane-apps/update-all` (typed; no id needed; no shell, no
arbitrary path) → `{ ok, results }`.

### 4. Visible versioning (no confusing "build 2")

Each card shows the build identity next to the version so a same-version stale
copy is legible: `Installed 0.1.2 (3) · build 65fcc61 · Bundled 0.1.2 (3) · build
81c1434`. When the build ids differ, that line is the proof it's stale even
though the numbers match.

## Non-goals honored

No change to Browser/Terminal Lane feature behavior (only lane-app *status +
update* plumbing); no credentials outside Keychain; no arbitrary shell
execution; the readiness/status output stays secret-free.

## Tests (TDD)

1. lane-setup: a `current` lane → `needsUpdate:false`; `outdated`/`stale`/
   `shadowed` → `needsUpdate:true`; `updateSummary` lists the stale displayNames +
   `anyShadowed`; entries surface `installedBuildId`/`bundledBuildId`; the model
   is secret-free.
2. `updateAllStaleLaneApps` (stubbed deps): a stale shadowing lane → install then
   repair the writable `/Applications` copy → result reports `replacedApplications`;
   a current lane is skipped; a not-writable `/Applications` → `warning` +
   `shadowed:true`, no silent shadow.
3. endpoint `POST /lane-apps/update-all` declared + wired to the lib.
4. console: the post-update banner ("Lane apps need update") + `Update Lane Apps`
   button + `laneUpdateAll` + the `build <HMBuildId>` line are present.
5. no-secrets regression on the lane-setup serialized output.

## Gates

- `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
- Build/package both lane apps.
- Manual: simulate a stale active copy (write an old HMBuildId into the active
  Info.plist) and confirm Settings → Lanes shows the banner + a one-click fix.
