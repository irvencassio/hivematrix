# Browser Lane Auth Strategy + Readiness Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-browser-lane-auth-strategy-dashboard-design.md`

RED-GREEN-REFACTOR throughout. Write/extend the failing test, watch it fail, then
implement the minimum to make it pass.

## Phase 1 — Daemon contract: auth strategies + providerAccount

- [ ] **1.1 (RED)** In `src/lib/browser-lane/contracts.test.ts`, add a test that
  `normalizeBrowserSite` accepts `authStrategy: "google_sso"` and
  `"microsoft_sso"` and returns them unchanged, and accepts a `providerAccount`
  string and returns it. Add a test that `providerAccount` is **not** rejected by
  the secret guard, but `password`/`cookie` still are.
- [ ] **1.2 (GREEN)** In `src/lib/browser-lane/contracts.ts`:
  - Extend `BrowserSite.authStrategy` union to include `google_sso | microsoft_sso`.
  - Extend `normalizeEnum` allow-list in `normalizeBrowserSite` to the four values.
  - Add `providerAccount: string | null` to `BrowserSite` and read it via
    `readString(record, "providerAccount", { required: false })`.
- [ ] **1.3** Run `node --import tsx/esm --test src/lib/browser-lane/contracts.test.ts`.

## Phase 2 — SQLite schema: providerAccount column

- [ ] **2.1 (RED)** In `src/lib/db/browser-lane-schema.test.ts`, add a test that
  `browser_sites` has a `providerAccount` column.
- [ ] **2.2 (GREEN)** In `src/lib/db/index.ts`, append migration **v24**:
  `ALTER TABLE browser_sites ADD COLUMN providerAccount TEXT;`
- [ ] **2.3** Run the schema test.

## Phase 3 — Store: persist + surface providerAccount; manual readiness

- [ ] **3.1 (RED)** In `src/lib/browser-lane/store.test.ts`:
  - Assert `upsertBrowserSite` round-trips `providerAccount` and `authStrategy:
    "google_sso"` with **no** credential row written (no credentialRef).
  - Assert `listBrowserSiteSummaries`/dashboard expose `providerAccount` and never
    a `password`/`secret`/`token` key.
  - Add a test for a new `recordManualReadiness({ siteId, state: "needs_reauth" })`
    that makes the dashboard report orange with `metadata.source = "manual"`.
- [ ] **3.2 (GREEN)** In `src/lib/browser-lane/store.ts`:
  - `BrowserSiteRow` + INSERT/UPDATE include `providerAccount`.
  - `rowToSite`, `BrowserSiteSummary`, `BrowserLaneDashboardSite` carry
    `providerAccount`.
  - Add `recordManualReadiness({ siteId, state, note? })` mapping
    `ready|needs_reauth|blocked` → status/color via `normalizeBrowserReadinessState`,
    writing a `browser_readiness_runs` row with `metadata: { source: "manual", note }`.
- [ ] **3.3** Run the store test.

## Phase 4 — Daemon endpoint: POST /browser-lane/readiness/mark

- [ ] **4.1 (RED)** Extend a daemon/server test (or store-level test if no server
  harness) to cover the manual-mark path validation (rejects unknown state).
- [ ] **4.2 (GREEN)** In `src/daemon/server.ts`, add
  `POST /browser-lane/readiness/mark` → validate `siteId` + `state` allow-list,
  call `recordManualReadiness`, return the updated dashboard row. Keep `POST
  /browser-lane/sites` accepting `providerAccount` (already passes `body.site`
  through `upsertBrowserSite`).
- [ ] **4.3** Confirm COO gating unchanged — re-run `src/lib/coo/dispatch.test.ts`
  and `src/lib/orchestrator/lane-tools.coo.test.ts`.

## Phase 5 — App model + Add Site auth picker (Swift)

- [ ] **5.1 (RED)** In `scripts/browser-lane-app.test.mjs`, extend the Add Site
  test: assert an `NSPopUpButton` auth strategy picker exists with the four
  strategy identifiers; assert provider domain default strings
  (`accounts.google.com`, `login.microsoftonline.com`); assert SSO copy that does
  **not** ask for a password; assert `providerAccount` in the model; assert the
  model file still has no `password|token|cookie|secret` field.
- [ ] **5.2 (GREEN)** `BrowserLaneModels.swift`: add `providerAccount: String?`;
  keep metadata-only. `AddSiteViewController.swift`: add the picker, a provider
  account field, conditional show/hide of username/password, provider-domain
  default seeding, and strategy-aware `buildSite()` (no Keychain ref required for
  SSO/manual). Daemon client payload includes `authStrategy` + `providerAccount`,
  never a secret.
- [ ] **5.3** Run the app test (the Swift-source assertions are string checks).

## Phase 6 — App readiness dashboard + WKUIDelegate + Sites view (Swift)

- [ ] **6.1 (RED)** In `scripts/browser-lane-app.test.mjs`:
  - Assert a `ReadinessViewController.swift` exists with status colors
    (`green|orange|yellow|red`), a "Last checked" label, "Next action", and the
    three buttons (`Open auth flow`, `Run readiness`, `Refresh`).
  - Assert `BrowserViewController.swift` declares `WKUIDelegate` and
    `createWebViewWith` and uses a persistent `WKWebsiteDataStore`.
  - Assert `SitesViewController.swift` renders `authStrategy` + session label.
- [ ] **6.2 (GREEN)**
  - Add `ReadinessViewController.swift`; wire it in `ContentViewController.show`.
  - Add `BrowserLaneDaemonClient.fetchDashboard` (GET) + a
    `markReadiness`/`runReadiness` POST.
  - `BrowserViewController.swift`: persistent data store + `WKUIDelegate`.
  - `SitesViewController.swift`: show auth strategy + session label + provider
    account.
- [ ] **6.3** `swift build` in `browser-lane-app`; run the app test.

## Phase 7 — Gates

- [ ] **7.1** `node --test scripts/browser-lane-app.test.mjs`
- [ ] **7.2** `swift build` (browser-lane-app)
- [ ] **7.3** `npm run typecheck`
- [ ] **7.4** `npm test`
- [ ] **7.5** `node scripts/scope-wall.mjs`

## Phase 8 — Package / sign / notarize / verify

- [ ] **8.1** `node scripts/package-browser-lane-app.mjs`
- [ ] **8.2** `codesign --force --options runtime --sign "Developer ID
  Application: Irven Cassio (8B3CHTY93V)"` the bundle (with entitlements).
- [ ] **8.3** `notarytool submit --keychain-profile hivematrix --wait`,
  `stapler staple`, `spctl -a -vv`.
- [ ] **8.4** Copy to `/Applications/Browser Lane.app`.
- [ ] **8.5** Computer Use: launch, confirm picker present, Google SSO hides
  password, dashboard shows per-site status + actions.
