# Lane Setup & Reliability Center — Design

> Date: 2026-06-26
> Status: Approved (recommendation pre-approved; this design reflects code inspection)

## Problem

Browser Lane and Terminal Lane are standalone signed apps the operator installs
explicitly, but their operational truth is scattered across three Settings →
Lanes sections (Lane Apps, Browser Lane Sites & Auth, Terminal Lane Profiles &
Readiness) plus the underlying `/lane-apps` + `/browser-lane/*` +
`/terminal-lane/*` endpoints. There is no single surface that answers, at a
glance, for each Lane: bundled? installed? current? signed/launchable? daemon
reachable? readiness green/fresh? and — the key one — *what exact button do I
click to fix it?*

## What already exists (code inspection)

- `src/lib/lane-apps/index.ts` → `getAllLaneAppStates({verify?})` returns, per
  app: `installed`/`expected` `{short,build}`, `installPath`/`activePath`/
  `preferredPath`, `duplicated`, `status` (`missing|installed|update_available|
  launch_failed|invalid_signature`), and optional `signatureOk`/`launchOk` when
  `verify:true` (which **launches** the app via `open -g`).
- `verifyLaneAppById(id)` runs codesign + spctl + a launch probe and returns
  `{state, verification:{signatureOk,launchOk,...}}`.
- `getBrowserLaneReadinessDashboard()` → `{totals:{sites,byColor,needsAttention,
  stale}, sites:[{...authStrategy, readiness:{status,color,label,stale,...}}]}`.
  Browser readiness statuses: `ready|maintenance|needs_reauth|human_required|
  probe_failed|blocked|unknown`; authStrategy: `manual_session|keychain_password|
  google_sso|microsoft_sso`.
- `getTerminalLaneReadinessDashboard()` → `{totals:{profiles,byColor,
  needsAttention}, profiles:[{...readiness:{status,color,lastRunAt}}]}`.
  Terminal statuses: `ready|needs_auth|probe_failed|blocked|unknown`.
- Endpoints already present and id-constrained (`^(browser-lane|terminal-lane)$`):
  - `POST /lane-apps/:id/install`, `/verify`, `/launch`, `/reveal`
  - `GET /browser-lane/dashboard`, `POST /browser-lane/readiness/run`
  - `GET /terminal-lane/dashboard`, `POST /terminal-lane/readiness/run`
  - **No arbitrary shell endpoint exists** and none will be added.
- Console renders `renderLaneApps()` (basic cards), `renderBrowserReadiness()`,
  `renderTerminalReadiness()`.

**Conclusion:** every repair action endpoint already exists and is typed/safe.
This slice is (a) a unified *read model* that composes existing signals, (b) a
GET endpoint for it, (c) a polished console that consumes it, and (d) honesty +
copy polish. No new shell surface, no credential storage changes, no Swift app
changes (the apps already gate local-vs-SSH and store secrets only in Keychain).

## Decision

### 1. Unified read model: `src/lib/lane-setup/index.ts`

`getLaneSetup(deps?): { lanes: LaneSetupEntry[] }`, one entry per lane:

```ts
interface LaneSetupEntry {
  id: "browser-lane" | "terminal-lane";
  displayName: string;
  bundledVersion: { short: string; build: string };       // = expected (bundled artifact)
  installedVersion: { short: string; build: string } | null;
  installedPath: string;                                    // activePath || preferredPath
  installState: "not_installed" | "current" | "outdated" | "broken";
  launchState: "unknown" | "running" | "not_running" | "failed";
  signingState: "unknown" | "valid" | "invalid";
  daemonState: "reachable" | "unavailable";                 // lane readiness store queryable
  readiness: BrowserReadinessSummary | TerminalReadinessSummary;
  nextAction: { action: "install"|"update"|"verify"|"launch"|"run_readiness"|"open"; label: string };
  disabledReasons: Record<string, string>;                  // why a given action is unavailable
}
```

Readiness summaries are **counts only** (no per-site/per-profile detail, so no
secrets ever enter this model):

```ts
type BrowserReadinessSummary = { lane:"browser"; configuredSites:number; ready:number; stale:number; needsAttention:number };
type TerminalReadinessSummary = { lane:"terminal"; configuredProfiles:number; ready:number; failed:number; needsAttention:number };
```

**Field derivation (honest, no fabrication):**
- `installState`: `missing→not_installed`, `installed→current`,
  `update_available→outdated`, `launch_failed|invalid_signature→broken`.
- `launchState`: a cheap, read-only `pgrep -f <executable>` (fixed catalog
  executable name — no injection, no app launch) → `running`/`not_running`. If a
  cached verification recorded `launchOk:false` → `failed`. If pgrep can't run →
  `unknown`. **Never launches the app to compute this.**
- `signingState`: from the **last verification recorded this session** (in-memory
  cache updated by the existing `/verify` endpoint): `signatureOk true→valid,
  false→invalid`. No verification yet → `unknown`. The model never spawns
  codesign on a plain read; only the operator's explicit Verify does.
- `daemonState`: `reachable` unless reading the lane's readiness dashboard throws
  (then `unavailable`). A daemon/store failure surfaces as `unavailable` — it
  must never silently read as success.
- `nextAction` (single most useful step, priority order): not_installed→Install;
  outdated→Update; broken→Verify; current & signingState unknown→Verify; current
  & launchState not running→Launch; current & readiness needsAttention>0→Run
  readiness; otherwise→Open app.
- `disabledReasons`: e.g. `{launch:"Install the app first", verify:"Install the
  app first"}` when not installed — so the console can show every button with a
  visible reason instead of hiding it.

`getLaneSetup` takes injectable deps (`appStates`, `browserDashboard`,
`terminalDashboard`, `isRunning`, `verification`) so it is unit-testable with
stubs — no spawning, no real DB, in tests.

### 2. Endpoint: `GET /lane-setup`

Returns `{ ok: true, lanes: [...] }`. Read-only; composes the model above.
No new mutating endpoint is added — install/verify/launch/readiness all reuse
the existing typed, id-constrained routes. The existing `/lane-apps/:id/verify`
handler additionally calls `recordLaneVerification(id, verification)` so the
session signing/launch truth flows into `/lane-setup`.

### 3. Console: one Lane Apps section with two polished cards

`renderLaneSetup()` (replacing `renderLaneApps()`'s body, same `#lane_apps`
mount) renders a card per lane with:
- title + a clear install-state badge (Current / Update available / Not
  installed / Broken),
- `Installed X (b) · Bundled Y (b)` and the install path,
- a state line: `Signing · Launch · Daemon` chips,
- a readiness summary line (sites/profiles · ready · needs attention · stale),
- a **primary action button** matching `nextAction.label`,
- secondary buttons (Verify / Launch / Run readiness / Reveal) using the same
  `.create`/`.copybtn` styles as the rest of HiveMatrix. Buttons that can't run
  are rendered **disabled with the `disabledReasons` text shown** — no dead,
  silent buttons.

The "Browser Lane Sites & Auth" and "Terminal Lane Profiles & Readiness"
sections remain **below** as subordinate drill-downs (smaller header, framed as
"detail for the card above"), not competing top-level inventories.

### 4. Browser Lane polish (console copy + dashboard)

- Surface `authStrategy` per site in the readiness dashboard (Manual session /
  Password (Keychain) / Google SSO / Microsoft SSO) — strategy only, not the
  provider account, not the credential ref.
- Render honest session states: `ready`→"Logged-in session observed",
  `needs_reauth|human_required`→"Manual sign-in required", `stale`→"Stale —
  re-check", plus the existing color.
- Add a one-line future-use hint: *"After you sign in, you can close Browser
  Lane — the session persists in its WebKit data store, and the readiness check
  confirms it. CAPTCHA / 2FA still need you; HiveMatrix never bypasses human
  verification."*

### 5. Terminal Lane polish (console copy)

- Card/section copy explains local vs SSH plainly: *"Local profiles run a shell
  on this Mac (localhost) — no key or password needed. SSH profiles connect to a
  remote host; their secret lives only in the macOS Keychain."*
- Map readiness statuses to actionable text: `needs_auth`→"Add the SSH key/
  passphrase in Keychain, then re-run", `blocked`→"Host unreachable — check
  network/host", `probe_failed`→"Probe failed — open the run for details".
- `daemonState: unavailable` is shown as an explicit error chip so a sync
  failure never looks like success.

The Swift app source is **not** changed (it already gates local-vs-SSH inputs
and stores secrets only in Keychain — covered by `scripts/terminal-lane-app.test.mjs`),
so no Lane app rebuild/repackage is required by this slice.

## Security / non-goals honored

- No secrets in `/lane-setup` output: readiness is counts-only; a regression test
  asserts the serialized model contains no `credentialRef`/`password`/
  `private_key`/`passphrase`/`host`/`user`/`providerAccount`.
- No arbitrary shell endpoint; all actions are the existing typed, id-constrained
  routes. `pgrep` uses a fixed catalog executable name (no user input).
- Credentials remain in macOS Keychain only; no new storage.
- No compatibility-ID renames; no new workflows; no HeyGen API rendering; no iOS
  changes (the `/lane-setup` read model is additive and does not alter an
  existing iOS contract).

## Tests (TDD)

1. **lane-setup model** (`src/lib/lane-setup/index.test.ts`): with stubbed deps,
   assert every field derives correctly across cases — not_installed, current,
   outdated, broken; launch running/not_running/failed/unknown; signing
   valid/invalid/unknown; daemon reachable vs unavailable (dashboard throws);
   nextAction priority; disabledReasons when not installed; readiness summary
   counts for both lanes.
2. **no-secrets regression** (same file): `JSON.stringify(getLaneSetup(...))`
   with secret-bearing stub dashboards contains none of the secret field names.
3. **endpoint wiring** (`scripts/lane-setup-endpoints.test.mjs`): daemon exposes
   `GET /lane-setup` calling `getLaneSetup`; the `/verify` handler records
   verification; the four install/verify/launch/reveal + two readiness-run routes
   remain id-constrained and typed; no `/exec`-style shell route exists.
4. **console layout & button consistency** (`src/daemon/console.test.ts`):
   `renderLaneSetup` is wired into the Lanes tab and the `#lane_apps` mount;
   cards render install-state, signing/launch/daemon, readiness summary, a primary
   action, and disabled buttons carry reason text; Browser dashboard surfaces auth
   strategy + the no-bypass hint; Terminal copy explains local-vs-SSH; subordinate
   sections still present.
5. Existing Browser Lane / Terminal Lane app tests and lane-apps tests stay green.

## Gates

- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
- Lane apps are **not** repackaged (no Swift/packaging change) → no rebuild and no
  `release:verify` needed (no release metadata change).
