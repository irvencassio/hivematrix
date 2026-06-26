# Lane App Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-lane-app-manager-design.md`

Conventions followed: contracts/normalize style from `src/lib/terminal-lane/contracts.ts`;
injectable command runner from `src/lib/terminal-lane/readiness.ts`; lazy-import route blocks and
`parseBody`/`json` helpers in `src/daemon/server.ts`; source-string console tests as in
`scripts/coo-dispatch-console.test.mjs`.

All facts (paths, versions, bundle ids) come from the brief and were verified on this machine.

---

## Task 1 — Catalog + plist parse (pure) — RED then GREEN

- [ ] `src/lib/lane-apps/contracts.ts`: define `LaneAppId = "browser-lane" | "terminal-lane"`,
      `LaneAppStatus = "missing"|"installed"|"update_available"|"launch_failed"|"invalid_signature"`,
      `LaneAppVersion = { short: string; build: string }`, and `LaneAppDescriptor`
      (`id`, `displayName`, `bundleId`, `executable`, `installDirName`).
- [ ] `src/lib/lane-apps/plist.ts`: `parseInfoPlist(xml: string): { short, build, bundleId }` —
      regex pull of `CFBundleShortVersionString`, `CFBundleVersion`, `CFBundleIdentifier`. Pure.
- [ ] `src/lib/lane-apps/plist.test.ts`: parses the Browser Lane plist shape (0.1.86 / 2 /
      com.irvcassio.hivematrix.browserlane); tolerates whitespace/newlines between key and string.
- [ ] `src/lib/lane-apps/catalog.ts`: `LANE_APPS: LaneAppDescriptor[]` for the two apps; bundle ids
      and executables verified (`BrowserLane`, `TerminalLane`). `getLaneApp(id)`.
- [ ] `src/lib/lane-apps/catalog.test.ts`: both apps present; ids/bundleIds correct; **assert no
      descriptor or this module mentions `keychain-access-groups`**.

## Task 2 — Status comparison (pure) — RED then GREEN

- [ ] `src/lib/lane-apps/status.ts`: `compareVersions(installed, expected)` (semver-ish on `short`,
      then numeric `build`) and `resolveStatus({ installed?, expected, signatureOk?, launchOk? })`:
      - no `installed` → `missing`
      - `signatureOk === false` → `invalid_signature` (dominates)
      - `launchOk === false` → `launch_failed` (dominates version)
      - expected newer than installed → `update_available`
      - else → `installed`
- [ ] `src/lib/lane-apps/status.test.ts`: missing; equal→installed; expected-newer→update_available;
      newer build only→update_available; **signature failure dominates even when up to date**;
      **launch failure is its own status, distinct from signature** (the LaunchServices lesson).

## Task 3 — Install-target resolution (fs, injectable) — RED then GREEN

- [ ] `src/lib/lane-apps/install-target.ts`:
      `resolveInstallTarget(descriptor, { home, exists })` returning `{ preferredPath, applicationsPath,
      userPath, activePath|null, installedPaths[], duplicated }`. `exists` is an injected predicate.
      Preferred/user path = `~/Applications/HiveMatrix Lanes/<App>.app`; applicationsPath =
      `/Applications/<App>.app`. active = `/Applications` copy if it exists, else user copy; duplicated
      = both exist.
- [ ] `src/lib/lane-apps/install-target.test.ts`: four presence combinations (neither/user/apps/both),
      asserting `activePath`, `duplicated`, and that `preferredPath` is always the user path.

## Task 4 — Verify (injectable runner) — RED then GREEN

- [ ] `src/lib/lane-apps/verify.ts`: `LaneAppCommandRunner` type (file,args,{timeoutMs}) →
      `{exitCode, stdout, stderr}` (mirror terminal-lane). `verifyLaneApp({ appPath, executable,
      run, launchProbe?, timeoutMs? })`:
      - `codesign --verify --deep --strict <appPath>` → signatureOk on exit 0
      - `spctl -a -vvv -t exec <appPath>` → gatekeeperOk on exit 0
      - if `launchProbe`: `open -g <appPath>`, then `pgrep -f <executable>` within timeout →
        launchOk; best-effort `pkill`/quit afterward.
      - returns `{ signatureOk, gatekeeperOk, launchOk|null, details }`. `signatureOk = codesign &&
        spctl`. Default runner via `node:child_process` spawn with timeout (not exported-tested).
- [ ] `src/lib/lane-apps/verify.test.ts`: mock runner — all-pass; codesign-fail→signatureOk false;
      spctl-fail→signatureOk false; launch probe pgrep-miss→launchOk false while signatureOk true
      (proves launch is independent of signature).

## Task 5 — State assembly + install (fs/runner, injectable) — RED then GREEN

- [ ] `src/lib/lane-apps/index.ts`: `getLaneAppState(descriptor, deps)` ties catalog+target+plist+
      (optional verify) into one `LaneAppState` ({ id, displayName, installed:{short,build}|null,
      expected:{short,build}, installPath, activePath, status, duplicated, signatureOk?, launchOk? }).
      `getAllLaneAppStates(deps)`. `installLaneApp(descriptor, { artifactPath, target, copyTree,
      exists, mkdirp, rename })` — atomic copy into preferred target; refuses missing artifact;
      never targets `/Applications`. Default deps wrap fs; pure-injectable for tests.
- [ ] `src/lib/lane-apps/index.test.ts`: state assembly for installed/update_available/missing using
      injected plist+exists; install copies artifact to user path and refuses when artifact absent.

## Task 6 — Daemon endpoints — RED then GREEN

- [ ] `scripts/lane-apps-endpoints.test.mjs` (source test, like browser-lane route tests): assert
      `server.ts` contains `GET /lane-apps`, `POST /lane-apps/<id>/install`, `/launch`, `/verify`
      route matchers and the `@/lib/lane-apps` import; assert `getAllLaneAppStates` used for GET.
- [ ] `src/daemon/server.ts`: add the four routes (lazy `await import("@/lib/lane-apps")`), id regex
      `^/lane-apps/(browser-lane|terminal-lane)/(install|launch|verify)$`, GET `/lane-apps`. Use
      `parseBody`/`json`. Launch = `open` active path; verify reruns verify w/ launch probe.

## Task 7 — Console Lane Apps card — RED then GREEN

- [ ] `scripts/lane-apps-console.test.mjs`: assert console contains a "Lane Apps" card, the explicit
      copy `HiveMatrix updates itself automatically; lane apps are installed explicitly`, the four
      buttons (Install/Update, Verify, Launch, Reveal), `api("/lane-apps")`, and **no
      `keychain-access-groups`** in the card; assert the launch-vs-signature lesson copy
      (status badge handles `launch_failed` separately from `invalid_signature`).
- [ ] `src/daemon/console.ts`: add the card markup in `settingsLanes` + a `renderLaneApps()` JS
      function and `laneAppAction(id, action)` handlers; wire `renderLaneApps()` into
      `switchSettingsTab("lanes")`.

## Task 8 — Gates + live verify + commit

- [ ] `npm run typecheck` (zero errors)
- [ ] `npm test` (all green)
- [ ] `node scripts/scope-wall.mjs` (zero violations)
- [ ] `npm run verify:portal`
- [ ] Live: start daemon, `GET /lane-apps` reports both installed; `POST .../verify` passes
      signature/Gatekeeper/launch on the installed `/Applications` copies.
- [ ] Commit + push to main (branch first if needed per repo policy; main is the working branch here).
