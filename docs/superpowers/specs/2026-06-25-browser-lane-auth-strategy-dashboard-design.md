# Browser Lane — Auth Strategy + Session Readiness Dashboard (Design)

> Superpowers: brainstorming output. Implementation plan lives at
> `docs/superpowers/plans/2026-06-25-browser-lane-auth-strategy-dashboard.md`.

Date: 2026-06-25
Status: approved-for-implementation (detailed spec supplied by operator)

## Problem

Browser Lane's Add Site form assumes every site authenticates with a Keychain
username/password. That is false for an increasing set of target sites:

- **HeyGen** signs in with **Google** ("Continue with Google").
- Others use **Microsoft / Entra ID**.
- Some are genuinely username/password (Keychain).
- Some are pure manual sessions with no recoverable credential at all.

Two gaps follow:

1. **Capture gap.** We cannot honestly record how a site authenticates, and we
   wrongly prompt for (and would store) passwords that don't exist for SSO sites.
2. **Visibility gap.** The operator has no per-site readiness view answering "is
   this site signed in right now, stale, or blocked, and what do I do next?"

## Brutally honest framing

This slice does **not** promise autonomous Google/Microsoft login. That is the
wrong goal and a fragile one (2FA, CAPTCHA, risk challenges, ToS). The honest
goal is **maintained authenticated sessions**:

- The **human** completes SSO / 2FA / CAPTCHA in Browser Lane's WebKit view.
- Browser Lane **persists** that session (WebKit website data store) so it can be
  reused without re-login.
- Browser Lane **monitors and reports** readiness honestly — including a manual
  "mark verified / needs reauth" state when no automated probe is feasible.
- The **COO** only routes automation to a site when it is **green and fresh**.
  Stale or non-green authenticated sites are held, not bypassed.

No fake green. A site with no real signal is **gray/unknown**, not "ready".

## Auth strategies

`authStrategy` becomes a four-value enum (default stays `manual_session`):

| Strategy            | Secret captured?        | UI password fields | Readiness model |
|---------------------|-------------------------|--------------------|-----------------|
| `keychain_password` | username+password → macOS Keychain | shown | probe + manual |
| `google_sso`        | none (manual handoff)   | hidden             | manual handoff / probe |
| `microsoft_sso`     | none (manual handoff)   | hidden             | manual handoff / probe |
| `manual_session`    | none                    | hidden             | manual handoff / probe |

Google/Microsoft are treated as **manual session handoff**: Browser Lane opens
the login/auth URL and the operator finishes login. We **never** automate or
store Google/Microsoft passwords.

### Provider account metadata (non-secret)

A new optional `providerAccount` field stores the **non-secret** account label /
email used to sign in (e.g. `cassio.irv@gmail.com`). It is a human label for
"which account is this site logged in as", never a credential. It is stored
locally, in the daemon, and synced — but never a password/cookie/token.

### Provider domain defaults

When the operator picks an SSO strategy, the Add Site form seeds allowed domains
with the provider's auth domains so readiness/popup matching recognises them:

- **Google:** `accounts.google.com`, `google.com`
- **Microsoft:** `login.microsoftonline.com`, `login.live.com`

These merge into the site's own allowed domains (the site domain is always
included by the daemon contract).

## Data model changes

### Daemon contract (`src/lib/browser-lane/contracts.ts`)

- `BrowserSite.authStrategy` enum →
  `"manual_session" | "keychain_password" | "google_sso" | "microsoft_sso"`.
  Default remains `manual_session`.
- Add `BrowserSite.providerAccount: string | null` (non-secret label).
  Rejected as a secret only by the existing `password|secret|token|cookie|totp`
  guard — `providerAccount` is allowed (it is none of those).
- `credentialRef` stays optional and is only meaningful (and only validated as a
  Keychain ref) for `keychain_password`. For SSO/manual it is an optional
  **session label** (non-secret), not a Keychain pointer.

### SQLite (`src/lib/db/index.ts`, new migration v24)

`browser_sites` already has `metadata TEXT`. We add a first-class column rather
than overloading JSON, to keep it queryable and schema-testable:

```sql
ALTER TABLE browser_sites ADD COLUMN providerAccount TEXT;
```

`browser_credentials` already has `accountLabel`, `status`, `lastVerifiedAt`,
`kind`. The store keeps writing a credential row **only** when a real
`keychain_password` `credentialRef` is present — SSO/manual sites create no
credential row (nothing to reference).

### Manual readiness ("honest mark")

New store function + endpoint to record an operator-asserted readiness state when
no live probe is feasible:

- `recordManualReadiness({ siteId, state, note })` where `state ∈
  { ready, needs_reauth, blocked }` (mapped to green/orange/red). It writes a
  normal `browser_readiness_runs` row with `metadata.source = "manual"`. This is
  the dashboard's honest fallback — the operator vouches for it; nothing fabricates
  green.
- `POST /browser-lane/readiness/mark` → `{ siteId, state, note? }`.

The existing `/browser-lane/dashboard`, `/browser-lane/readiness/run`,
`matchBrowserSiteReadiness`, and COO gating already consume readiness runs, so the
manual mark flows through them unchanged.

## macOS app changes (`browser-lane-app`)

### `BrowserLaneSite` (Swift model)

Add `providerAccount: String?`. `authStrategy` is already a `String`; the picker
now writes the four real values. No password/token/cookie/secret fields — the
model stays metadata-only (enforced by test).

### Add Site form

- **Auth Strategy picker** (`NSPopUpButton`) with the four strategies.
- `keychain_password`: show Username + Password (`NSSecureTextField`), save to
  macOS Keychain via `Security.framework` (unchanged path).
- `google_sso` / `microsoft_sso` / `manual_session`: **hide** username/password,
  show copy that explains the operator signs in manually; no secret captured.
- **Provider account / email** field (optional, non-secret) for all strategies.
- Picking Google/Microsoft seeds the provider domain defaults into Allowed
  domains and a sensible login URL hint.
- **Open auth flow** button — opens the login/auth URL in Browser Lane's
  persistent WebKit browser so the session is captured and reused.

### Sites view

Each site row shows: display name, auth strategy, credentialRef **or** session
label, provider account, allowed domains, and last sync/status.

### Readiness dashboard (`ReadinessViewController`, replaces placeholder)

Fetches `GET /browser-lane/dashboard` from the daemon and renders per-site:

- Color dot: **green** ready · **orange** needs reauth · **yellow** stale/unknown
  (probe_failed/maintenance) · **red** blocked/error · **gray** unknown/no-run.
- Last checked (relative) and the readiness summary.
- **Next action** text derived from the status.
- Buttons: **Open auth flow**, **Run readiness**, **Refresh**.

If the daemon is unreachable, the view says so honestly (no fabricated rows).

### Persistent session + OAuth popups

- `BrowserViewController` uses a **persistent** `WKWebsiteDataStore` shared via a
  single `WKWebViewConfiguration`, so a completed SSO login survives relaunch and
  is reused.
- Implements **`WKUIDelegate`** `createWebViewWith` so Google/Microsoft OAuth
  popups / `target="_blank"` new-window flows load in the same session instead of
  being dropped.

## Security invariants (unchanged, reinforced)

- **No** password / cookie / token / session secret in any JSON, SQLite column,
  log line, test fixture, or API payload. Only metadata: `authStrategy`,
  `providerAccount`, `allowedDomains`, `credentialRef`/session label.
- Keychain remains the **only** store for username/password, and only for
  `keychain_password` sites.
- Trace/audit redaction (`password|secret|token|cookie|totp`) stays in force.
- COO dispatch keeps gating browser automation on green+fresh readiness; SSO and
  manual sites are not special-cased into a bypass.

## Approaches considered

1. **Per-strategy subtables / polymorphic credential records.** Rejected —
   overkill for this slice; `browser_credentials` already models the only
   strategy that has a secret (keychain).
2. **Store providerAccount in `browser_sites.metadata` JSON.** Rejected — a
   first-class column is queryable and matches the existing schema-test pattern.
3. **Live OAuth session probing in this slice.** Deferred — honest manual
   mark + existing probe sweep is the truthful MVP; a live "is the SSO cookie
   still valid" probe is a later slice. We ship the dashboard model now and do
   not fake the signal.

## Out of scope

- Autonomous Google/Microsoft login or password entry (explicitly never).
- Live OAuth-cookie validity probing (later slice).
- Multi-account-per-site credential rotation.

## Verification

- `node --test scripts/browser-lane-app.test.mjs`
- `swift build` in `browser-lane-app`
- `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`
- Package → codesign (Developer ID Application: Irven Cassio, 8B3CHTY93V,
  hardened runtime) → notarize (notarytool profile `hivematrix`) → staple →
  `spctl` → install to `/Applications/Browser Lane.app`.
- Computer Use: launch the app, confirm the auth picker exists, that selecting
  Google SSO hides the password field, and that the Readiness dashboard renders
  per-site status + actions.
