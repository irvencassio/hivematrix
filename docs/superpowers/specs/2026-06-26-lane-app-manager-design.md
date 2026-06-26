# Lane App Manager — Design

> Status: approved-by-brief (the operator's task brief fixed the product decisions; this
> doc records them and is brutally honest about the trade-offs).
> Date: 2026-06-26

## Problem

Browser Lane and Terminal Lane are now separate signed/notarized macOS apps:

- `/Applications/Browser Lane.app` — standalone **0.1.86 (2)**, bundle id `com.irvcassio.hivematrix.browserlane`
- `/Applications/Terminal Lane.app` — standalone **0.1.1 (2)**, bundle id `com.irvcassio.hivematrix.terminallane`

Installing and updating them is still manual. HiveMatrix's own auto-update updates **only**
`HiveMatrix.app`. There is no operator-facing surface that answers the simplest questions:

- Is the lane app installed? Where?
- What version is installed vs. what HiveMatrix has on hand?
- Is the installed copy actually launchable (signed, Gatekeeper-accepted, and able to start)?

## Brutally honest framing

- **Auto-update is a delivery mechanism, not a general installer for sibling apps.** The Tauri
  updater knows how to swap one app bundle (`HiveMatrix.app`) atomically. Teaching it to also
  reach into `/Applications` and overwrite *other* apps the user may be running is a category
  error — different code-sign identity to validate, different running-process to quit, different
  failure surface, and no user consent in the loop.
- **Silent install into `/Applications` is fragile.** It can need admin rights, it races a running
  app, and when it goes wrong the failure is opaque ("the app just won't open"). We already paid
  for that lesson once: the previous launch blocker was a restricted `keychain-access-groups`
  entitlement that passed `codesign`/`spctl` but still failed to launch under LaunchServices.
- **Explicit operator install/update is safer and easier to debug.** A button the operator presses,
  with a visible status badge and a Verify action, makes every step observable. When something
  fails you can see *which* check failed (signature vs. Gatekeeper vs. launch) instead of guessing.

So: **HiveMatrix updates itself automatically; lane apps are installed explicitly.** Auto-update
*may* deliver newer lane app artifacts (future work), but turning an artifact into an installed app
is always an operator action through Settings → Lanes.

## The LaunchServices lesson (load-bearing)

`codesign --verify --deep --strict` passing and `spctl -a -t exec` accepting the bundle is **not
sufficient** to prove the app will run. The keychain-access-groups regression was signed and
Gatekeeper-clean yet died on launch. Therefore launch verification is a **separate status**, not a
corollary of signature validity. Our status model treats `launch_failed` as distinct from
`invalid_signature`, and the launch probe is its own optional verification step.

## MVP scope (what we build now)

### 1. Pure module — `src/lib/lane-apps/`

- **`catalog.ts`** — the two known lane apps with their identity and *bundled/expected* version.
  Expected version/build is read from the dev artifact's `Info.plist`
  (`build/<lane>/<App>.app`) when present, falling back to a pinned constant so the module is
  pure/testable without the build tree.
- **`plist.ts`** — parse `CFBundleShortVersionString` / `CFBundleVersion` / `CFBundleIdentifier`
  out of an `Info.plist` *string* (pure; no fs). A thin reader wraps `readFileSync`.
- **`status.ts`** — pure status comparison:
  - `missing` — no installed bundle found.
  - `installed` — installed and version ≥ expected.
  - `update_available` — installed but expected version/build is newer.
  - `launch_failed` — present but the launch probe failed.
  - `invalid_signature` — present but `codesign`/`spctl` rejected it.
  - Status precedence: signature/launch failures dominate version comparison (a broken bundle is
    not merely "update available").
- **`install-target.ts`** — resolve install/detection paths. Detection scans **both**
  `/Applications/<App>.app` and `~/Applications/HiveMatrix Lanes/<App>.app`. The **preferred
  install target** is the user-writable `~/Applications/HiveMatrix Lanes/` location. If both exist,
  report the active one and make the choice explicit (active = the one that exists; if both exist,
  `/Applications` is treated as the active installed copy since macOS launches it by id, and we flag
  the duplication).
- **`verify.ts`** — verification with an **injectable command runner** (same pattern as
  `terminal-lane/readiness.ts`) so tests never shell out:
  - `codesign --verify --deep --strict "<app>"`
  - `spctl -a -vvv -t exec "<app>"`
  - optional launch probe: `open -g "<app>"` then `pgrep` for the executable, with a timeout, then
    best-effort quit. Launch probe is opt-in per call.
- **`install.ts`** — copy a packaged artifact bundle into the preferred target atomically
  (copy to temp dir beside target, then rename), creating `~/Applications/HiveMatrix Lanes/` if
  needed. No sudo, no admin prompt. Refuses to install into `/Applications` in MVP (advanced/manual
  only). Injectable fs/runner for tests.
- **No secrets** anywhere in this module. **No `keychain-access-groups`** is required, referenced,
  or reintroduced — these apps use normal generic Keychain service/account access. A test asserts
  the module/entitlements never demand that entitlement.

### 2. Daemon endpoints (`src/daemon/server.ts`)

- `GET /lane-apps` → `{ ok, apps: [browserLane, terminalLane] }`, each with installed
  version/build, expected version/build, install path, active path, status, and the duplication
  flag.
- `POST /lane-apps/:id/install` → install/update one lane app from its packaged artifact into the
  preferred target. Returns the new state.
- `POST /lane-apps/:id/launch` → `open` the active installed app.
- `POST /lane-apps/:id/verify` → rerun signature + Gatekeeper + launch verification and return the
  refreshed status. `:id` ∈ `{ browser-lane, terminal-lane }`.

### 3. Install target policy

- Preferred: `~/Applications/HiveMatrix Lanes/<App>.app` (user-writable, no admin).
- `/Applications/<App>.app` is detected (the machine already has copies there) and may be *launched*
  and *verified*, but MVP **install** writes only to the user-writable target. If `/Applications`
  copy exists it is reported as the active one and the UI states the duplication explicitly.

### 4. Packaging / artifact approach

- MVP source artifacts: the dev `build/browser-lane/Browser Lane.app` and
  `build/terminal-lane/Terminal Lane.app` (present on this machine). The catalog points install at
  these when present.
- **TODO (release readiness, not MVP):** bundle zipped signed lane apps as HiveMatrix resources or
  GitHub release assets and have auto-update *deliver* (not install) them; the manager then installs
  from the delivered artifact. We do **not** pretend the updater installs them today.

### 5. Console UI — Settings → Lanes "Lane Apps" card

- New card above the existing "Embedded capability lanes" content (or directly under it), with one
  row per lane app showing: installed version/build, bundled/available version/build, install path,
  status badge, and buttons **Install/Update**, **Verify**, **Launch**, **Reveal**.
- Explicit copy: *"HiveMatrix updates itself automatically; lane apps are installed explicitly."*
- No hidden auto-install — every install is a button press.

### 6. Tests

- Pure: version/build comparison and status precedence (incl. signature/launch dominate version).
- Pure: install-target resolution across the four presence combinations.
- Pure: verify classifier maps runner exit codes to `installed` / `invalid_signature` /
  `launch_failed`.
- Endpoint: `/lane-apps` routes exist in `server.ts` source.
- Console: Lane Apps card, the four buttons, and the explicit-install copy exist.
- Guard: **no `keychain-access-groups`** is required/reintroduced for the standalone lane apps.
- Lesson: launch verification is asserted to be a separate state from `spctl`/`codesign`.

### 7. Verification gates

`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` · `npm run verify:portal`, then a
live check on this machine (`GET /lane-apps` reports both installed; Verify passes
signature/Gatekeeper/launch), then commit + push to main.

## Out of scope (named, not silently dropped)

- Auto-update *delivery* of lane artifacts (design TODO above).
- Installing into `/Applications` from the manager (advanced/manual only).
- Uninstall / rollback / multi-version retention.
- Quitting a running lane app before update (MVP installs to the user-writable target; the active
  `/Applications` copy, if running, is untouched).
