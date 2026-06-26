# Pre-release operator-path hardening — Design

> Date: 2026-06-26
> Status: Approved (pre-release polish; focuses on bugs + reliability, no new workflows)

## Context

Before the next HiveMatrix build, harden the real operator paths. A review of the
priority areas shows most are **already shipped** by recent slices and only need
regression coverage; the genuine remaining bugs are concentrated in **Browser
Lane Add Site** plus two gaps (a missing video-approval regression test and a
pre-release smoke script).

### Already done (verified — no code change, keep tests green)
- **Terminal Lane profile management + honest auth** (commit 59f08fa): editable
  table, edit/delete/duplicate, `authMethod`, password profiles marked not
  auto-connectable, no autotype, daemon sync failure shown distinctly.
- **Settings → Lanes clarity** (581e0fa): one Lane Apps section, polished cards,
  consistent `.create`/`.copybtn` buttons, disabled buttons carry reasons,
  "Browser Lane Sites & Auth" + "Terminal Lane Profiles & Readiness" as
  subordinate detail sections.
- **Overview navigation** (520f142), **Usage in the right rail** (3e6bf33),
  **AI-news board button removed** (b412743), **standardized ON/OFF
  `settingsSwitch`** (earlier).
- **Video approval is portal-only**: `resolveVideoDraft` → `createHeyGenPortalTaskForDraft`
  → Browser Lane task; `heygen.mjs`/`make-avatar.mjs` are quarantined to the
  agent `/video/make` factory and never called on approve. Behavioral tests exist
  in `news-review.test.ts`/`publish-draft.test.ts`; a *direct* regression guard is
  missing.

### Genuine remaining bugs
1. **Both Swift lane apps have no Edit menu** → Cmd-C/V/X/A do not work in any text
   field (`AppDelegate` sets up a window but never builds `NSApp.mainMenu`).
2. **Browser Lane Add Site** exposes raw `Site id` + `Credential ref` fields,
   auto-generates neither, has only a single generic status label for errors, and
   has **no edit/prefill flow** (you can't load an existing site to edit; the
   only prefill is "Use HeyGen defaults").

## Decisions

### 1. Standard macOS Edit menu in both lane apps

Build `NSApp.mainMenu` with an **Edit** submenu wiring the first-responder
selectors — Undo/Redo, Cut (`cut:` ⌘X), Copy (`copy:` ⌘C), Paste (`paste:` ⌘V),
Select All (`selectAll:` ⌘A) — in each app's `AppDelegate.applicationDidFinishLaunching`
(plus a minimal App menu with Quit ⌘Q). This restores clipboard shortcuts in
every `NSTextField`/`NSSecureTextField`. Applies to **Browser Lane** and
**Terminal Lane**. (Shared code isn't possible — separate SPM packages — so each
AppDelegate gets the same small `installMainMenu()`.)

### 2. Browser Lane Add Site overhaul

- **Auto-generate Site id** from the display name (slug: lowercase, non
  `[a-z0-9._:-]`→`-`, collapse/trim dashes); falls back to the primary domain.
  Generated on save when the (hidden) id field is empty.
- **Auto-generate credentialRef** = `hivematrix.browser.<id>.primary` for the
  Keychain strategy when the field is empty.
- **Advanced disclosure**: hide `Site id` + `Credential ref` rows behind an
  `▸ Advanced` toggle (default collapsed). Power users can still override.
- **Edit existing site**: the Sites screen gets a per-site **Edit** button that
  hands off the site id (via a `BrowserLaneEditTarget` + a navigate notification,
  mirroring Terminal Lane). Add Site loads that site and prefills every field
  except the password (which can't be read back).
- **Preserve the Keychain secret on blank password**: on edit, leaving the
  password blank keeps the existing Keychain credential (no overwrite, no clear);
  a hint says so. Only a non-empty password updates it.
- **Field-specific, human-readable errors**: each validation failure focuses the
  offending field (`makeFirstResponder`) and shows a red, field-named message.
- **No secrets** in the daemon payload / store / logs (already true; keep tests).
  No CAPTCHA/2FA bypass copy; secrets stay in macOS Keychain only.

### 3. Video approval regression guard

Add a test asserting the approval path (`resolveVideoDraft` → portal) **never**
imports or spawns `heygen.mjs` / `make-avatar.mjs`, and that `news-review.ts`
source contains no API-render call on approve — a durable guard against a future
refactor wiring the API renderer back into approval.

### 4. Pre-release smoke script

`scripts/release-smoke.mjs` (runnable: `node --import tsx/esm scripts/release-smoke.mjs`)
runs against a throwaway temp DB and verifies, printing a ✓/✗ checklist and
exiting non-zero on any failure:
1. DB opens + migrations apply (daemon-start proxy).
2. `getAllLaneAppStates()` returns **Browser Lane + Terminal Lane**.
3. `getLaneSetup()` returns both lanes with install/launch/daemon/readiness state.
4. Browser Lane app bundled/installable + Terminal Lane bundled/installable
   (reported honestly from lane-app state; "installed/launchable if bundled").
5. Browser Lane site dashboard serializes with **no secret** field values.
6. Terminal Lane profile dashboard serializes with **no secret** field values.
7. Workflow inbox loads (`getWorkflowInbox()`).
8. Video approval path is portal-only (no `make-avatar`/API renderer reference on
   approve).
9. The daemon server source declares the Settings → Lanes endpoints.

A companion `scripts/release-smoke.test.mjs` runs the script in-process and
asserts it passes, so the checklist is part of `npm test`.

## Non-goals honored

No new workflows; no HeyGen API rendering reintroduced; no CAPTCHA/2FA bypass; no
credentials outside macOS Keychain; no arbitrary shell endpoints; iOS untouched
(no backend contract change — the Browser Lane site payload is unchanged).

## Tests (TDD, failing first)

- Swift source: both AppDelegates install an Edit menu with cut/copy/paste/selectAll.
- Swift source: Add Site has an Advanced disclosure, auto-generates site id +
  credentialRef, supports editing (`BrowserLaneEditTarget`/prefill), preserves the
  secret on blank password, focuses the offending field on error; Sites screen has
  an Edit affordance. No `password` value in the daemon payload.
- TS: approval never imports/spawns `heygen.mjs`/`make-avatar.mjs`.
- Smoke: `release-smoke` checklist passes; dashboards leak no secrets.

## Gates

- `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
- Browser Lane + Terminal Lane Swift changed → rebuild/package both.
- No version/build metadata change in the hardening pass → no `release:verify` yet
  (that belongs to the separate release-candidate step).
