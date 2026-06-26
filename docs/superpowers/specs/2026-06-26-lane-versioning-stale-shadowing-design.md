# Lane app versioning + stale /Applications shadowing — Design

> Date: 2026-06-26
> Status: Approved (pre-release reliability fix)

## Problem

HiveMatrix 0.1.90 bundled a newer Terminal Lane (profile edit/delete), but the
Terminal Lane bundle still declares `CFBundleShortVersionString 0.1.1 (2)`, so the
Lane Apps surface reports it as "current" even though it is the old binary. Two
compounding bugs:

1. **Version never bumped on code change.** `terminal-lane-app/Resources/Info.plist`
   and `PINNED_EXPECTED["terminal-lane"]` in `src/lib/lane-apps/index.ts` are both
   `0.1.1 (2)`. Version is the only freshness signal, so a same-version rebuild is
   indistinguishable from the old one.
2. **Stale `/Applications` shadowing.** `resolveInstallTarget` correctly makes the
   `/Applications/<App>.app` copy "active" (LaunchServices resolves a bundle id
   there first), but `getLaneAppState` only reads the *active* copy's version. If a
   stale `/Applications` copy shadows a freshly-installed user copy, status still
   reads `installed`, the installer silently writes a user copy that will never be
   launched, and the operator has no signal or repair.

## What exists

- `LaneAppVersion {short, build}`; `compareVersions` (dotted short, numeric build).
- `resolveStatus` → `missing | invalid_signature | launch_failed | update_available | installed`.
- `resolveInstallTarget` → `{userPath, applicationsPath, activePath, installedPaths, duplicated}`
  (`/Applications` wins `activePath`).
- `parseInfoPlist` reads `CFBundleShortVersionString`/`CFBundleVersion`/`CFBundleIdentifier`.
- Packagers copy `Resources/Info.plist` verbatim (no build identity).
- `lane-setup` maps status → `LaneInstallState (not_installed|current|outdated|broken)`.

## Decisions

### 1. Bump Terminal Lane + pin

- `terminal-lane-app/Resources/Info.plist` → **`0.1.2 (3)`** (clearly newer than
  `0.1.1 (2)`).
- `PINNED_EXPECTED["terminal-lane"]` → `{ short: "0.1.2", build: "3" }`.
- Test: the resolved expected Terminal version is **strictly newer** than `0.1.1 (2)`.

### 2. Build/source identity in bundle metadata

- Add a custom Info.plist key **`HMBuildId`** to both lane apps' `Resources/Info.plist`
  (placeholder `"dev"`). The packagers **inject the current `git rev-parse --short HEAD`**
  into the bundled `HMBuildId` at package time, so two builds of the same version
  string still differ by build identity.
- `parseInfoPlist` reads `HMBuildId` (nullable).
- The bundle metadata read becomes `{ version, buildId }`. Lane status compares
  version **and** build identity: same version but a *different* build identity is
  **not current** → `stale_copy`. When either side lacks a build id, fall back to
  version-only (back-compat).

### 3. Per-copy reads + stale `/Applications` shadow detection

- `getLaneAppState` reads **every** installed copy (`installedPaths`), producing
  `installedCopies: { path, location: "applications"|"user", version, buildId,
  active, current }[]` (`current` = version ≥ expected AND build id matches when both
  known).
- New `LaneAppStatus` value **`stale_copy`**.
- Status precedence (active copy): missing → invalid_signature → launch_failed →
  `update_available` (active version < expected) → `stale_copy` (active version ==
  expected but build id differs) → `installed`.
- **Shadow override:** if the active copy is the `/Applications` copy, it is *not*
  current, and a **current user copy exists**, the status is forced to `stale_copy`
  and `shadowed: true` — the good user copy is being shadowed by a stale
  `/Applications` copy.
- New state fields: `installedCopies`, `shadowed`, `activeIsStale`, `expectedBuildId`.

### 4. lane-setup `stale` state + honest next action

- `LaneInstallState` gains **`stale`**; `installStateFor(stale_copy) → "stale"`.
- New `LaneActionId` **`repair`**. `nextAction` for `stale`:
  - active copy is in `/Applications` → `{ action: "repair", label: "Update
    /Applications copy" }` (installing a user copy would just be shadowed again).
  - otherwise → `{ action: "update", label: "Update" }`.
- `LaneSetupEntry` exposes `installedCopies` (path + location + active + current),
  `shadowed`, and `activeIsStale`, so the card can list every copy and explain why.
- A `stale` install state must **never** render as "current".

### 5. Install result messaging

- `installLaneAppById` returns `{ state, installedPath, activePath, shadowed,
  warning? }`. When `installedPath !== activePath` (the freshly written user copy is
  shadowed by an `/Applications` copy), `warning` explains it and points at the
  repair action. The console shows the **actual active path** after install, and
  never claims "installed/current" when the active path is stale.

### 6. Safe `/Applications` repair

- `repairApplicationsCopy(id)`: if the `/Applications` copy is the stale active copy
  **and is user-writable** (`fs.accessSync(W_OK)`), atomically replace it with the
  bundled artifact (stage + rename, no sudo). If not writable, return **exact
  instructions** (the path + that admin rights / a manual drag are required) — never
  a silent partial fix.
- Endpoint `POST /lane-apps/:id/repair-applications` (typed, id-constrained,
  `^(browser-lane|terminal-lane)$`). No arbitrary path, no shell.

## Tests (TDD, failing first)

1. Terminal Lane expected version is newer than `0.1.1 (2)`.
2. `parseInfoPlist` reads `HMBuildId`; both `Resources/Info.plist` contain it; the
   Terminal plist is `0.1.2 (3)`; a build marker proves the profile-management build
   (Profiles screen `deleteProfile`/`editProfile`) is what's bundled.
3. `resolveStatus`: same version + different build id → `stale_copy`, not `installed`.
4. `getLaneAppState`: `/Applications` copy wins `activePath`; stale `/Applications`
   + current user copy → `shadowed` + `stale_copy` (not `installed`/`current`);
   `installedCopies` lists both with correct `active`/`current`.
5. `installLaneApp*`/messaging: install returns the active path; warns when the user
   copy is shadowed; lane-setup maps `stale_copy → "stale"` (never `current`) with
   the "Update /Applications copy" action.
6. `repairApplicationsCopy`: replaces a writable stale `/Applications` copy; returns
   instructions when not writable. Endpoint is declared + id-constrained.
7. Existing install/verify/launch + install-target + lane-setup tests stay green.

## Non-goals honored

No Browser Lane auth change (only shared lane-app status code is touched, additively);
no password autotyping; no credential storage outside Keychain; no arbitrary shell
endpoint. iOS untouched (the lane-app status model is daemon/console only).

## Gates

- `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
- Rebuild/package both lane apps (Info.plist + packager changed).
- Install Terminal Lane locally; confirm the bumped `0.1.2 (3)` shows and Profiles
  supports edit/delete.
- If release metadata changes → none here (lane app versions are independent of the
  HiveMatrix app version), so no `release:verify` in this slice.
