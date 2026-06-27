# Browser Lane — Site Management UX Modernization (Design)

> Status: approved-by-spec (detailed brief provided by operator). Scope: `browser-lane-app/` macOS app only.

## Problem

The Browser Lane Add Site screen reads like a 1980s admin form:

- It auto-loads HeyGen defaults, so "Add Site" never starts empty.
- "Site id" and "Display name" feel duplicated; both are primary.
- "Home URL" + "Login / auth URL" force the operator to think about two URLs.
- The layout is a giant 28pt title over a wide label-left grid with every technical field visible.
- There is no obvious Edit path and no Delete.
- The sidebar feels dated.

Goal: make site setup feel like a modern Mac settings panel — **simple first, advanced only when needed, editable, operator-friendly** — without changing credential storage (macOS Keychain) or adding automation.

## Constraints discovered in the code

- App is **AppKit** (NSViewControllers), not SwiftUI. Module `BrowserLaneApp`.
- Tests are **source-text assertions** in `scripts/browser-lane-app.test.mjs` (run via `npm test`). They do not compile Swift, so we additionally gate on `swift build`.
- Existing security invariants enforced by tests — **must stay green**:
  - `BrowserLaneModels.swift`, `BrowserLaneDaemonClient.swift`, `SitesViewController.swift`, `ReadinessViewController.swift`, `TracesViewController.swift`, `BrowserLaneSettings.swift` must **not** contain the bare words `password|token|cookie|secret`. (Word-boundary regex — camelCase/snake_case identifiers like `keychainPassword`/`keychain_password` are fine.)
  - Daemon payload never carries a password value.
- Enum raw values `keychain_password|google_sso|microsoft_sso|manual_session` must remain in `BrowserLaneModels.swift`.

## Key decisions

### 1. Friendly sign-in labels live in the view layer
The operator-facing picker titles ("Manual session", "Google sign-in", "Microsoft sign-in", **"Username + password"**) cannot live in `BrowserLaneModels.swift` because "Username + password" trips the model's no-secret-word guard. So:
- Keep `BrowserLaneAuthStrategy` (raw values + behavior flags) in the model.
- Add a presentation extension (`pickerTitle`, `displayOrder`) in `AddSiteViewController.swift`. Both Add Site and Sites use it. This keeps the model pure-data and the security test honest.

### 2. One primary `Website` field; derive the rest
- Visible primary fields: **Name** (required), **Website** (required), **Sign-in method**, **Account email** (optional). Username/Password show only for the username+password method.
- `homeUrl` ← normalized Website (bare host → `https://host`).
- `loginUrl` ← Advanced "Login URL override" if present, else Website. The operator never has to enter two URLs.
- `allowedDomains` ← Advanced field if the operator typed one, else auto-derived from `host(Website)` + the SSO provider's domains.
- `id` ← Advanced field if typed, else slug of Name (fallback Website host).
- `credentialRef` ← Advanced field if typed, else `hivematrix.browser.<id>.primary` (only meaningful for username+password).

### 3. Empty by default; HeyGen is an opt-in preset
`loadView` no longer calls `useHeyGenDefaults()`. Empty form defaults to **Manual session**. "Use HeyGen preset" is a secondary button; only after clicking does status mention HeyGen.

### 4. Edit + Delete from the Sites list
- Each site renders as a card. The whole card is click-to-edit (NSClickGestureRecognizer) **and** shows explicit **Edit** and **Delete** buttons for discoverability.
- Edit reuses the existing `BrowserLaneEditTarget` hand-off → Add/Edit prefills everything except the password (never read back from Keychain).
- Delete shows an `NSAlert` confirmation; on confirm it removes the local record (`store.delete`) and the Keychain secret (`keychain.deleteCredential`). No silent delete.

### 5. Modern layout
- Section header at 22pt (not 28), concise help text, grouped rows in a width-constrained column (~520pt), label-left rows built as toggleable row views (no fragile NSGridView row-index hiding).
- Primary button **Save Site** (default/return key, prominent). Secondary: **Open Sign-in**, **Use HeyGen preset**. Status sits next to the buttons.
- Remove all user-facing "metadata" wording.

### 6. Modern sidebar
- Keep the `NSTableView` source list but add a quiet section header, tighter spacing, and ensure the selection accent reads. Rename **Add Site → New Site**. Settings stays pinned last (already last in the enum). Also add a **+ New Site** button in the Sites header so Sites is the primary entry point — both paths kept (operator choice).

## Non-goals
Keychain stays the credential store. No CAPTCHA/2FA bypass. HeyGen preset kept (just optional). No new browser-automation features. No daemon delete endpoint in this slice (delete is local + Keychain).

## Verification
`swift build` (browser-lane-app) · `npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs`. Package via `scripts/package-browser-lane-app.mjs` if building an artifact. No HiveMatrix release unless asked.
