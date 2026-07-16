# Browser Lane — Canopy-Parity UX (Site Picker, Status, History, Permissions, Sessions)

> Status: brainstormed autonomously (self-improvement task, unattended run — see note at bottom). Scope: `browser-lane-app/` macOS app (AppKit) + `src/lib/browser-lane/`, `src/lib/audit/`, `src/lib/orchestrator/lane-tools.ts`, `src/lib/db/index.ts`. Do NOT release.

## Problem

The operator's ask: bring Browser Lane to UX/functionality parity with **Canopy** (a separate, standalone SwiftUI macOS app at `/Users/irvcassio/Canopy` — not part of this repo) across five features: site picker with status dots, an activity/history panel, read/write permission display, Canopy-style visual indicators, and session management (refresh/logout/expiry).

**Canopy is not integrated into HiveMatrix and never was in the current codebase** — `DECISIONS.md:157-160` records that `src/lib/canopy/` (a Canopy *bridge client*) was built and then removed 2026-06-25. What HiveMatrix has today is *parity infrastructure that already cites Canopy by name* but has no UI built on it yet (see below). "Parity" here means: match Canopy's design language (status-dot conventions, JSONL-style append-only activity logs, filter chips, toggleable panel) — not share code with it.

## Current state (verified by direct read, not just agent report)

Browser Lane already has far more backend plumbing than the ask assumes. Concretely:

- **Site config** — `browser_sites` / `browser_credentials` tables (`src/lib/db/index.ts`, v18/v24), `BrowserSite` contract (`src/lib/browser-lane/contracts.ts:18-31`): id, displayName, homeUrl, loginUrl, allowedDomains, credentialRef, authStrategy (`manual_session|keychain_password|google_sso|microsoft_sso`), providerAccount, notes. `rejectInlineSecrets()` structurally prevents secrets from landing in this table.
- **Status/color model already exists and is richer than 3 states** — `normalizeBrowserReadinessState()` (`contracts.ts:170-186`) maps 7 statuses → 5 colors: `ready`→green, `maintenance`/`probe_failed`→yellow, `needs_reauth`/`human_required`→orange, `blocked`→red, `unknown`→gray. `getBrowserLaneReadinessDashboard()` (`store.ts`) computes staleness (default 24h) and never fabricates green when there's no probe data.
- **Manual override already exists** — `recordManualReadiness()` / `POST /browser-lane/readiness/mark` (`server.ts:2685`) lets the operator assert a status with a note. This is the "logout" and "mark needs reauth" primitive, already shipped.
- **Activity logging already exists, with an `actor` field explicitly commented "Canopy parity"** — `src/lib/audit/audit.ts`, `AuditEntry.actor` (line 28-32): *"Canopy's 'every action logged with your identity' guarantee."* Live call sites already fire on every Browser Lane action: `executeBrowserLaneRead()` and `executeBrowserBeeRun()` in `src/lib/orchestrator/lane-tools.ts` (lines 1064-1065, ~1198) call `recordAudit({event:"browser:read"|"browser:job_created", actor: ctx.requestedBy, target, status, ...})` on every read/dispatch. `GET /audit` and `GET /audit/export` (`server.ts:3586,3601`) already serve this. **The only missing piece is a UI that renders it** — no panel anywhere reads `/audit` today.
- **Native app is the real product surface**, not the web console — `browser-lane-app/Sources/BrowserLaneApp/*.swift` (AppKit, ~2,541 lines): `SitesViewController.swift` (card list, no status dot), `ReadinessViewController.swift` (has the color dot + refresh/mark-reauth buttons, but as a *separate* "Readiness" screen from Sites), `TracesViewController.swift` (raw JSON dump in an `NSTextView`, not a structured/filterable list). The web console's Browser Lane panel (`renderBrowserReadiness`, `console.ts:9214`) is an intentional read-only summary — a prior design doc (`docs/superpowers/specs/2026-06-27-browser-lane-site-management-ux-design.md`) confirms full CRUD/management was deliberately kept out of the web console. This work respects that boundary: **native app only**.
- **No read/write permission concept exists yet** for sites. Closest precedent: `terminal_profiles.accessMode` (`db/index.ts:730`, v32) — `TEXT NOT NULL DEFAULT 'readwrite'`, values `readwrite|readonly`, already shipped for Terminal Lane. A second, unused candidate exists: `lane_capabilities` table (v18) with a `permission` column — schema-only, zero code reads or writes it anywhere in the tree.
- **Session/auth state has two overlapping mechanisms**: (a) `browser_credentials.status`/`lastVerifiedAt` + `browser_readiness_runs`, live and wired; (b) `AuthBeeSessionRecord` (`src/lib/session/contracts.ts`, 371 lines) — richer (explicit `expiresAt`, provider-agnostic) but only partially wired: `jobs.ts` imports `buildAuthBeeSessionPlaneSummary` for a read-only summary, nothing gates on it.
- **Test conventions**: TS backend uses `node:test` + `node:assert/strict` against a temp SQLite DB (`HIVEMATRIX_DB_PATH` override, `_resetDbForTests()`) — see `store.test.ts`. The Swift app has **no compiled unit tests**; it's verified by **source-text assertions** in `scripts/browser-lane-app.test.mjs` (`assert.match(readFileSync(...), /pattern/)`) plus `swift build`. A hard invariant: `SitesViewController.swift`, `ReadinessViewController.swift`, `TracesViewController.swift`, `BrowserLaneModels.swift`, `BrowserLaneDaemonClient.swift`, `BrowserLaneSettings.swift` must never contain the bare words `password|token|cookie|secret` (word-boundary; camelCase identifiers are fine) — enforced by an existing test. Any new code in these files must respect that.
- **Kernel/complexity budget** (`DECISIONS.md` Q14, `AGENTS.md` "Complexity Budget"): five concepts — Event, Task, Directive, Policy, Persona/Memory — everything else is an adapter. No new persistent store or product concept without a DECISIONS.md entry naming what it replaces. `scope-wall.mjs`'s `CREATE TABLE` check is warn-only and only fires outside `db/index.ts`/`brain/index-db.ts` — additive columns inside `db/index.ts` trigger nothing, but the convention (write a DECISIONS.md line) still applies.

## Approaches considered

**A. Resurrect `lane_capabilities` as a general capability/permission engine.** More "correct" long-term (per-action-type granularity: click/fill/type/upload/wait/credential_fill, not just per-site), and the table already exists in schema. Rejected for this pass: it's dormant, unvalidated scaffolding with no established read/write path anywhere in the codebase — building the UI on top of an unproven table risks discovering its shape is wrong mid-implementation, and it's a bigger concept to validate than the ask requires. Worth a future DECISIONS.md-blessed pass if per-action-type permissions become a real need.

**B. Build a new unified "site session registry" merging `AuthBeeSessionRecord` into Browser Lane's live path.** Would give real `expiresAt`-based session timeout instead of a staleness heuristic. Rejected for this pass: `AuthBeeSessionRecord` is unwired outside its own tests and one summary call; fully wiring it (session creation, renewal, cross-lane semantics) is a separate initiative with its own risk surface, not something this UX-focused ask should absorb as a side effect.

**C. (Chosen) Extend the existing adapters — `browser_sites` (+1 column), `audit.ts` (richer filters, +1 field), the existing readiness-mark endpoint (reused as-is for logout) — and build new UI in the native app on top of data that mostly already exists.** Matches Q14's "everything else is an adapter" rule directly: one schema column, zero new tables, zero new kernel concepts, one DECISIONS.md line. This is the plan below.

## Design, feature by feature

### Feature 1 — Site Picker (quick launch)
Merge `SitesViewController`'s card list with `ReadinessViewController`'s status computation (today they're two separate screens). Each card gets: the existing 5-color dot (via `normalizeBrowserReadinessState`, collapsed to a simple green/yellow/red/gray legend for scannability — orange folds into yellow, since both mean "action needed but not blocked"), a **Launch** button that opens `BrowserViewController` at the site's `homeUrl` (reuses the existing browse surface — no new browsing code), and a **★ favorite** toggle. Favorites are **client-local only** — a `Set<String>` of site IDs in `UserDefaults` (mirrors how `BrowserLaneSiteStore` already persists locally before best-effort daemon sync) — no schema change, no sync concept.

### Feature 2 — Logging & History Panel
Built on the **existing** `/audit` endpoint and `AuditEntry`, not on `browser_trace_events` (that family is lower-level automation-trace debugging — screenshots/DOM state — a different audience; leave `TracesViewController` as-is). New toolbar toggle button in the native app (mirrors Canopy's `Cmd+Shift+L` panel-toggle pattern) opens a new `HistoryPanelViewController`: a list of recent Browser Lane audit entries (`event` starting with `browser:`), each row showing actor (Agent/Human — see Feature 3's `actorKind`), target (site/URL), timestamp, and status (success/fail, derived from `status` field). `readAudit()` currently filters only on `{limit, taskId, status, event}` — add `actor`/`actorKind` and `target` (substring) and `since`/`until` (ISO timestamp bounds) filter params, purely additive to `ReadAuditOptions`. Filter UI: chip-style toggles (Agent/Human) + a site dropdown + a date range, following Canopy's `SessionLogPanel` chip convention. Duration is **not** reliably available for point-in-time audit events (no end-timestamp pairing) — show it only where derivable (job-shaped entries can look up their linked `browser_trace_run.startedAt/completedAt` by matching `taskId`), otherwise omit rather than fake it.

### Feature 3 — Read/Write Permissions Display
Add `browser_sites.accessMode TEXT NOT NULL DEFAULT 'readwrite'` (values `readwrite|readonly`), migration `v40`, mirroring `terminal_profiles.accessMode` verbatim (same name, same values, same default) — the established precedent, approach C above. Displayed as a badge on each site card (🔒 Read-only / 📝 Read-write) and set via a picker in `AddSiteViewController`. **Real enforcement, not just display**: `executeBrowserBeeRun()` (`lane-tools.ts`) checks the target site's `accessMode` before dispatch; if `readonly` and `jobType` ∈ `{form_fill, site_ops}` (the two write-shaped job types — `authenticated_research`/`capture`/`triage` stay always-allowed), reject with a clear error naming the site's read-only mode. `credential_fill` stays unconditionally refused regardless of `accessMode` (existing MVP behavior, unchanged). Also add `actorKind: "agent" | "human"` to `AuditEntry` — an explicit field set at `LaneToolContext`-construction call sites (not inferred from the free-text `requestedBy` string, which is fragile) — so the History Panel's Agent/Human filter has a real signal instead of guessing from an identity string. Exact call sites to enumerate and classify during plan execution (voice/chat = human-interactive, directive/task dispatch = agent-autonomous).

### Feature 4 — Visual Indicators (Canopy-style)
No new state model — reuse `normalizeBrowserReadinessState()`'s color output everywhere (picker cards, history log rows, permission context) so there is exactly one source of truth for status color, matching Canopy's own single-`AgentSessionStatus`-enum discipline. Add a hover tooltip on each site card showing last-checked time, computed from the existing `completedAt` on the latest `browser_readiness_runs` row — no new data.

### Feature 5 — Session Management
- **Refresh**: already exists (`ReadinessViewController`'s "Run readiness" button) — surface it on the merged Site Picker card too.
- **Logout**: new button, reuses the **existing** `POST /browser-lane/readiness/mark` (`recordManualReadiness`) with `status: "needs_reauth"`, `note: "Logged out by operator"` — zero new backend endpoint. Additionally clears the site's cached `WKWebsiteDataStore` cookies/local storage in the native app (new Swift-only code, no backend concept).
- **Timeout indicator**: derived from the existing staleness heuristic (`completedAt` + `staleAfterHours`, default 24h) — "fresh for ~Nh" / "stale, needs recheck." **Explicitly deferred**: true `expiresAt`-based expiry via `AuthBeeSessionRecord` (approach B) — the staleness heuristic is good enough for V1 and avoids taking on unwired scaffolding.

## Schema change (the only one)

```sql
-- v40 in src/lib/db/index.ts, mirrors v32's terminal_profiles.accessMode verbatim
ALTER TABLE browser_sites ADD COLUMN accessMode TEXT NOT NULL DEFAULT 'readwrite';
```

Plus one additive, non-breaking field on an existing interface:
```ts
// src/lib/audit/audit.ts — AuditEntry
actorKind?: "agent" | "human";
```

Both a DECISIONS.md entry will name explicitly (per AGENTS.md convention, even though scope-wall won't hard-fail either — both live inside `db/index.ts`/an already-sanctioned file).

## Explicitly deferred (not in this pass)

- Resurrecting `lane_capabilities` as a general per-action-type permission engine (approach A).
- Wiring `AuthBeeSessionRecord` for true session-expiry tracking (approach B).
- A web-console mirror of the History Panel — native app is the canonical surface; the web console's existing summary panel (`renderBrowserReadiness`) is untouched.
- Per-action (click/fill/type/...) granular permission enforcement — V1 gates at the job-type level only.

## Verification gates (per AGENTS.md + prior Browser Lane design doc precedent)

`npm run typecheck` · `npm test` (covers both `src/**/*.test.ts` and `scripts/**/*.test.mjs`, including the new source-text assertions for Swift changes) · `swift build` (browser-lane-app) · `node scripts/scope-wall.mjs`. No packaging/release step — operator releases.

## Note on process

This design was produced in a single unattended pass (no live back-and-forth question/answer) because the task was flagged as a self-improvement task with an explicit "do not release, operator releases" boundary, consistent with prior autonomous/overnight work in this repo. Every architectural call above is grounded in direct file reads (cited with paths/line numbers), not assumption. Three points are flagged above as genuinely open for operator override if this doesn't match intent: (1) collapsing 5 readiness colors to a 3-4 dot legend on the picker rather than showing all 5, (2) gating write-shaped jobs at the `jobType` level rather than the finer `BrowserActionType` level, (3) deferring `AuthBeeSessionRecord` wiring rather than using it for "real" expiry now.
