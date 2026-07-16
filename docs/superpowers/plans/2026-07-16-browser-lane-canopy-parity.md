# Browser Lane — Canopy-Parity UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **STATUS (2026-07-16):** Tasks 1-4 (backend: accessMode column/gating, audit filters, actorKind) are DONE — implemented, all tests green (3062 pass), typecheck clean, scope-wall clean, committed. Tasks 5-11 (Swift/AppKit UI: site picker, history panel, permission badges, logout) are NOT STARTED — the session ran out of budget before reaching them. A fresh session should pick up at Task 5, reading the design doc + this plan first. The backend is fully usable headlessly in the meantime (permission gating and richer audit filtering both work via the daemon API even with no UI on top yet).

Design: `docs/superpowers/specs/2026-07-16-browser-lane-canopy-parity-design.md`. Read it first — it has the full rationale, the rejected alternatives, and the three points flagged as open for operator override.

Backend paths under `src/lib/browser-lane/`, `src/lib/audit/`, `src/lib/orchestrator/`, `src/lib/db/`, `src/daemon/` unless noted. Backend tests: `node --import tsx/esm --test 'src/**/*.test.ts'`. Native app paths under `browser-lane-app/Sources/BrowserLaneApp/`. App tests (source-text assertions, not compiled): `scripts/browser-lane-app.test.mjs`, run via `node --import tsx/esm --test scripts/browser-lane-app.test.mjs`. Full gate: `npm test` runs both.

**Hard invariant, do not violate in any task below:** `SitesViewController.swift`, `ReadinessViewController.swift`, `TracesViewController.swift`, `BrowserLaneModels.swift`, `BrowserLaneDaemonClient.swift`, `BrowserLaneSettings.swift` must never contain the bare (word-boundary) strings `password`, `token`, `cookie`, `secret` — camelCase identifiers like `keychainPassword` are fine, but no standalone occurrences. An existing test enforces this; do not weaken it.

---

## Task 1 — RED: backend tests for accessMode, audit filters, actorKind, and dispatch gating

- [ ] In `src/lib/browser-lane/store.test.ts`, add/extend cases asserting:
  - `upsertBrowserSite({...,  accessMode: "readonly"})` round-trips through `listBrowserSiteSummaries()` and `getBrowserSite()` with `accessMode === "readonly"`.
  - Omitting `accessMode` on create defaults to `"readwrite"`.
  - An invalid `accessMode` value throws `ContractValidationError` (mirror the existing `authStrategy` enum-validation test style).
- [ ] In `src/lib/browser-lane/contracts.test.ts` (create if it doesn't exist — check first), add a case asserting `normalizeBrowserSite` accepts `accessMode: "readonly" | "readwrite"`, defaults to `"readwrite"`, and rejects other values via `normalizeEnum`.
- [ ] In `src/lib/audit/audit.test.ts` (create if it doesn't exist — check first), add cases asserting:
  - `recordAudit({..., actorKind: "agent"})` then `readAudit()` returns the entry with `actorKind` intact.
  - `readAudit({ actorKind: "human" })` filters to only human entries.
  - `readAudit({ target: "linkedin" })` does a substring match against `target`.
  - `readAudit({ eventPrefix: "browser:" })` matches both `"browser:read"` and `"browser:job_created"` but not `"task_completed"`.
  - `readAudit({ since: "2026-07-16T00:00:00.000Z", until: "2026-07-16T23:59:59.999Z" })` bounds by `ts`.
- [ ] In `src/lib/orchestrator/lane-tools.test.ts` (locate the existing Browser Lane test block), add cases asserting:
  - `executeBrowserBeeRun()` against a site with `accessMode: "readonly"` and `jobType: "form_fill"` returns an `Error:` string naming the site as read-only, and does **not** dispatch a task.
  - The same call with `jobType: "authenticated_research"` against a `readonly` site still succeeds (read-shaped jobs are always allowed).
  - A `readwrite` site allows `form_fill`.
  - `recordAudit` calls from `executeBrowserLaneRead`/`executeBrowserBeeRun` now include `actorKind`.
- [ ] Run `node --import tsx/esm --test 'src/lib/browser-lane/*.test.ts' 'src/lib/audit/*.test.ts' 'src/lib/orchestrator/lane-tools.test.ts'` → confirm the new assertions FAIL (feature not yet implemented) and nothing else breaks.

## Task 2 — GREEN: `accessMode` column + contract + store plumbing

- [ ] `src/lib/db/index.ts`: add migration `m("v40", \`ALTER TABLE browser_sites ADD COLUMN accessMode TEXT NOT NULL DEFAULT 'readwrite';\`)`, following the exact style of the `v32` `terminal_profiles.accessMode` migration at line 730.
- [ ] `src/lib/browser-lane/contracts.ts`: add `accessMode: "readwrite" | "readonly";` to the `BrowserSite` interface (after `authStrategy`), and in `normalizeBrowserSite()` add `accessMode: normalizeEnum(record.accessMode, ["readwrite", "readonly"] as const, "readwrite", "accessMode"),`.
- [ ] `src/lib/browser-lane/store.ts`:
  - `upsertBrowserSite()` (~line 123): add `accessMode` to the `INSERT`/`ON CONFLICT DO UPDATE` column list and bound params.
  - `rowToSite()` (~line 605): add `accessMode: row.accessMode,` to the object passed into `normalizeBrowserSite`.
  - `listBrowserSiteSummaries()` (~line 215-225): add `accessMode: site.accessMode,` to the returned summary object.
  - Check `BrowserSiteRow` type definition and add `accessMode: string;` if it's an explicit interface rather than inferred.
- [ ] Add a DECISIONS.md entry, `## Q20 — Browser Lane read/write permission + Canopy-parity activity log (2026-07-16)`, following the exact format of Q14/Q19 (Decision paragraph, Code paragraph naming files touched, a "Complexity accounting (Q14 budget)" block stating: new product concepts 0, new persistent stores 0 (one `ALTER TABLE` inside the sanctioned `db/index.ts`, mirrors `terminal_profiles.accessMode` v32 verbatim), new modules 0 (all edits to existing files), reused adapters named (audit.ts, browser_sites, existing readiness/mark endpoint)). Reference the design doc path.
- [ ] Run the Task 1 store/contracts tests → confirm GREEN. Do not touch other tasks' failing tests yet.

## Task 3 — GREEN: audit filters (`actorKind`, `target`, `eventPrefix`, `since`/`until`) + `/audit` route

- [ ] `src/lib/audit/audit.ts`:
  - Add `actorKind?: "agent" | "human";` to `AuditEntry` (after `actor`), matching the existing doc-comment style (one line explaining it drives the History Panel's Agent/Human filter).
  - Extend `ReadAuditOptions` with `actorKind?: "agent" | "human"; target?: string; eventPrefix?: string; since?: string; until?: string;`.
  - In `readAudit()`'s filter loop, add: `actorKind` exact match, `target` case-insensitive substring match (`e.target?.toLowerCase().includes(opts.target.toLowerCase())`), `eventPrefix` via `e.event.startsWith(opts.eventPrefix)`, `since`/`until` via ISO string comparison on `e.ts` (strings compare correctly since both are ISO-8601 with the same format).
- [ ] `src/daemon/server.ts` (~line 3586, `GET /audit`): read the new query params (`q.actorKind`, `q.target`, `q.eventPrefix`, `q.since`, `q.until`) and pass them through to `readAudit()`, same pattern as the existing `taskId`/`status`/`event` params.
- [ ] Add a new route `GET /browser-lane/history` right after the existing `/browser-lane/dashboard` route (~line 2671): a thin wrapper that calls `readAudit({ eventPrefix: "browser:", ...other params from query string, limit })` — gives the Swift client one purpose-built endpoint instead of hand-building the `browser:` prefix filter itself. Mirror the existing route's structure (parse query, call lib function, `json(res, 200, {...})`).
- [ ] Run the Task 1 audit tests → confirm GREEN.

## Task 4 — GREEN: `accessMode` enforcement + `actorKind` stamping in dispatch

- [ ] `src/lib/orchestrator/lane-tools.ts`:
  - In `executeBrowserBeeRun()` (~line 1112), after `payload` is parsed successfully and before building the envelope: look up the target site via its existing site-resolution helper (find how the function currently resolves `payload.startUrl`/`allowedDomains` to a site — likely via `matchBrowserSiteReadiness` or a sibling lookup already imported elsewhere in this file; reuse it, don't add a second lookup path). If the matched site's `accessMode === "readonly"` and `payload.jobType` is `"form_fill"` or `"site_ops"`, return `` `Error: ${site.displayName} is configured read-only — form_fill/site_ops jobs are blocked. Change the site's access mode in the Browser Lane app to allow this.` `` without dispatching.
  - Determine `actorKind` at the two `recordAudit(...)` call sites (`executeBrowserLaneRead` ~line 1065, `executeBrowserBeeRun` ~line 1199). First locate every call site that constructs a `LaneToolContext` (grep the codebase for `LaneToolContext = {` or wherever `requestedBy` is assigned) and classify each as human-interactive (voice/chat/CLI) or agent-autonomous (directive/task dispatch). Add `actorKind` to `LaneToolContext` itself (simplest: the context builder already knows which caller it is) and thread it into both `recordAudit` calls as `actorKind: ctx.actorKind`. If a call site's origin is ambiguous, default to `"agent"` (fail toward "needs review," not toward false confidence that a human is accountable) and note the ambiguous site in the task's completion comment for operator review.
- [ ] Run the Task 1 lane-tools tests → confirm GREEN.
- [ ] Run the full backend suite so far: `node --import tsx/esm --test 'src/lib/browser-lane/*.test.ts' 'src/lib/audit/*.test.ts' 'src/lib/orchestrator/*.test.ts' 'src/lib/db/*.test.ts'` → all green, nothing else broken.

## Task 5 — RED: Swift source-text assertions for the new UI

- [ ] In `scripts/browser-lane-app.test.mjs`, add new `test(...)` blocks (do not remove existing ones) asserting:
  - `BrowserLaneModels.swift`: `BrowserLaneSite` struct has `var accessMode: String`; a `BrowserLaneHistoryEntry` (or similarly named) `Codable` struct exists with fields for actor/actorKind/target/ts/status/event.
  - `BrowserLaneDaemonClient.swift`: a `func fetchHistory(` method exists calling `/browser-lane/history`; existing `fetchDashboard` untouched; a `func logout(siteId:` or reuse of the existing readiness-mark POST helper for logout is present.
  - `SitesViewController.swift`: contains a status-dot rendering call (reuse whatever color/status symbol convention `ReadinessViewController.swift` already uses — assert the same helper/pattern is referenced, not reinvented), a `Launch` button/selector, a favorite/star toggle (`NSUserDefaults`/`UserDefaults` reference for local-only persistence — assert no new daemon POST for favorites), and an access-mode badge (assert both `"Read-only"` and `"Read/write"`-style copy present, or the exact copy chosen in Task 7).
  - A new `HistoryPanelViewController.swift` is asserted to exist (`existsSync`) once Task 9 lands — for Task 5, only add the assertion; it will fail until Task 9. Assert it references `fetchHistory`, has filter state for actor kind (Agent/Human toggle), and a search/site filter field (`NSSearchField` or `NSTextField`).
  - `ContentViewController.swift` (or wherever the toolbar lives — confirm by reading the file first): a toolbar button toggling the history panel's visibility, mirroring the existing screen-switch pattern already used for other toolbar buttons in this file.
  - Still-no-bare-secret-words assertions extended to cover any newly touched files from this task's list (see the Hard Invariant above) — do not remove the existing `doesNotMatch` checks, add to them if a new file needs the same guard.
- [ ] Run `node --import tsx/esm --test scripts/browser-lane-app.test.mjs` → confirm the new assertions FAIL and the pre-existing ones still PASS.

## Task 6 — GREEN: Swift models + daemon client

- [ ] `BrowserLaneModels.swift`: add `var accessMode: String` to `BrowserLaneSite` (default `"readwrite"` in any local-construction helper, e.g. `.heyGen` preset). Add `BrowserLaneHistoryEntry: Codable, Equatable` mirroring the backend `AuditEntry` shape (ts, event, actor, actorKind, target, status). Keep no bare secret words.
- [ ] `BrowserLaneDaemonClient.swift`: add `func fetchHistory(actorKind: String?, target: String?, completion: @escaping (Result<[BrowserLaneHistoryEntry], Error>) -> Void)` calling `GET /browser-lane/history` with query params, following the exact pattern of the existing `fetchDashboard` (~line 68). Add a `logout(siteId:)` (or reuse the existing readiness-mark POST helper directly from the caller — check whether a generic `postReadinessMark`-style method already exists before adding a new one; if it exists, Task 10 calls it directly and this task only needs `fetchHistory`).
- [ ] Run Task 5's model/client assertions → confirm GREEN; panel/toolbar assertions still fail (expected, later tasks).

## Task 7 — GREEN: enhanced Site Picker (status dot, Launch, favorite, access badge)

- [ ] `SitesViewController.swift`: on load, call `client.fetchDashboard()` (already exists, already used by `ReadinessViewController` — reuse the same color/status-to-`NSColor`/SF-Symbol mapping that file already has; extract it to a shared helper if it's currently private to `ReadinessViewController`, rather than duplicating the switch statement) and merge dashboard status into each site card alongside the existing site data.
- [ ] Add to each card: the status dot (small filled circle, colors per the existing 5-state mapping collapsed for the picker: green stays green, `maintenance`/`probe_failed` yellow, `needs_reauth`/`human_required` yellow (folded per design doc's "orange folds into yellow" call), `blocked` red, `unknown` gray), a **Launch** button that navigates to `Screen.browser` and opens `BrowserViewController` at `site.homeUrl` (check how screen navigation + passing a target URL is currently done elsewhere, e.g. "Open Sign-in" in `AddSiteViewController` — reuse that navigation mechanism), a **★** favorite toggle backed by `UserDefaults.standard` (array of site IDs, no daemon call), and an access-mode badge (🔒 for `readonly`, 📝 for `readwrite`, or the SF Symbol equivalents already used elsewhere in this file for consistency — check `AddSiteViewController`'s icon conventions first).
- [ ] `AddSiteViewController.swift`: add an access-mode picker (`readwrite`/`readonly`) to the existing form, defaulting to `readwrite`, included in `buildSite()`'s output.
- [ ] Run Task 5's `SitesViewController`/`AddSiteViewController` assertions → confirm GREEN.
- [ ] `swift build` in `browser-lane-app/` → confirm it still compiles (Swift has no separate unit-test target; a clean build is the correctness gate beyond the source-text assertions).

## Task 8 — GREEN: last-checked tooltip + status color single-source

- [ ] Confirm (grep, don't assume) whether `ReadinessViewController.swift`'s color/status mapping was extracted to a shared helper in Task 7. If not yet shared, extract it now into a small file-level function or a new tiny `BrowserLaneStatus.swift` helper, and make both `SitesViewController` and `ReadinessViewController` call the same function — one source of truth, per the design doc's Feature 4.
- [ ] Add a hover tooltip (`NSView.toolTip` or the AppKit equivalent already used elsewhere in this codebase — check for a precedent before introducing a new tooltip mechanism) on each site card's status dot showing last-checked time, sourced from the dashboard payload's existing `lastRunAt`/`ageMs` fields (already returned by `fetchDashboard` — no new backend call).
- [ ] Run the full `scripts/browser-lane-app.test.mjs` suite → confirm no regressions.

## Task 9 — GREEN: History Panel

- [ ] Create `HistoryPanelViewController.swift`: a list (`NSTableView` or stacked rows, matching whatever list pattern `SitesViewController` already uses for consistency) rendering `BrowserLaneHistoryEntry` rows — actor icon (agent vs human, distinct SF Symbols), timestamp, target/site, event/activity type, status (success/fail color-coded). Filter controls: Agent/Human toggle chips, a site text filter, calling `client.fetchHistory(actorKind:target:)` on change (client-side debounce or a simple "Apply" button — keep it simple, match `ReadinessViewController`'s existing refresh-button pattern rather than inventing live-search).
- [ ] Wire a toolbar button in `ContentViewController.swift` (or wherever confirmed in Task 5) that toggles the panel's visibility, following this codebase's existing toolbar-button/screen-toggle pattern exactly (check how other toolbar toggles are wired before adding a new mechanism).
- [ ] Run Task 5's `HistoryPanelViewController`/toolbar assertions → confirm GREEN.
- [ ] `swift build` → confirm clean compile.

## Task 10 — GREEN: Logout + session timeout indicator

- [ ] Add a **Logout** button to each site card (`SitesViewController`) or the site detail/readiness view (pick whichever existing screen already has the most per-site action buttons, for discoverability consistency — check Task 7's card layout first). On click: clear that site's `WKWebsiteDataStore` cookies/local storage for its `allowedDomains` (new, scoped Swift code — do not clear the entire shared data store, only the target site's domains), then call the existing readiness-mark POST (reused from Task 6, `status: "needs_reauth"`, note `"Logged out by operator"`) and refresh the card.
- [ ] Add a session-timeout label to each card, computed client-side from the dashboard payload's `lastRunAt`/`ageMs` against the known 24h staleness window (no new backend field — if the staleness threshold isn't already in the dashboard payload, hardcode the 24h default client-side and note it as a follow-up to expose server-side if it ever becomes configurable).
- [ ] Run the full `scripts/browser-lane-app.test.mjs` suite → confirm GREEN, no regressions.

## Task 11 — Verify and finish

- [ ] `swift build` in `browser-lane-app/` compiles clean.
- [ ] `npm run typecheck` — zero errors.
- [ ] `npm test` — full suite (`src/**/*.test.ts` + `scripts/**/*.test.mjs`) green.
- [ ] `node scripts/scope-wall.mjs` — zero hard-fail violations (warn-only `CREATE TABLE`/`Bee` hits are expected to be none, since this plan only does `ALTER TABLE` inside `db/index.ts`).
- [ ] Manually sanity-check with the `/verify` skill's spirit even though full UI driving isn't possible here: re-read the diff for the three operator-override points flagged in the design doc (5-color-to-picker collapse, job-type-level gating, deferred AuthBee) and confirm the implementation matches what the design doc actually says, not a drifted version of it.
- [ ] Commit with a message describing the feature (site picker + status/permission/history/session parity with Canopy's design language). Do **not** run any release/packaging script (`scripts/package-browser-lane-app.mjs`, `developer-id-release`, etc.) — operator releases. Push the branch/commit to main per the repo's normal flow (check current branch — if this work happened directly on `main` per this repo's usual pattern for Superpowers tasks, a plain commit is enough; if a feature branch was used, note that a PR is needed and leave it for the operator rather than merging).
