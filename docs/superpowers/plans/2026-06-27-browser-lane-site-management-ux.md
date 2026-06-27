# Browser Lane Site Management UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-27-browser-lane-site-management-ux-design.md`.
All paths under `browser-lane-app/Sources/BrowserLaneApp/` unless noted. Tests in `scripts/browser-lane-app.test.mjs`.

## Task 1 — RED: extend the test suite
- [ ] Update the existing "auto-generates ids…" test and add a new test block "Browser Lane Add Site is empty by default, derives from one Website field, and is editable/deletable" asserting:
  - `AddSiteViewController.swift`: `loadView` does **not** auto-call `useHeyGenDefaults()` (assert the empty-default helper `resetToEmpty`/`startEmpty` exists and is called; assert no `else { useHeyGenDefaults() }`).
  - Friendly picker titles present: `Username + password`, `Google sign-in`, `Microsoft sign-in`, `Manual session`; `pickerTitle` + `displayOrder` defined.
  - One primary `Website` field (`websiteField`, label "Website"); `homeUrl` derived (`normalizedWebsite`/`deriveHome`).
  - Advanced still hides Site ID, allowed domains, credential ref, **and** a "Login URL override" row (`loginOverride`/"Login URL override").
  - Auto-derive helpers: `deriveAllowedDomains` (host + provider), slug for id.
  - Buttons: `Save Site`, `Open Sign-in`, `Use HeyGen preset`.
  - Status copy does not say HeyGen unless preset path (assert `HeyGen preset` string only, and that empty default status has no HeyGen).
  - No user-facing "metadata": `doesNotMatch(addSite, /metadata/i)`, same for `Screens.swift` and `SitesViewController.swift`.
  - `SitesViewController.swift`: `NSClickGestureRecognizer`, `Edit`, `Delete`, `NSAlert` (confirmed delete), `New Site` button; still no bare secret words.
  - `BrowserLaneSiteStore.swift`: `func delete`.
  - `BrowserLaneKeychain.swift`: `deleteCredential` + `SecItemDelete`.
  - `SidebarViewController.swift`/`Screens.swift`: `New Site` label.
  - Keep existing assertions that still hold (Cmd-C/V menu, NSSecureTextField, usesKeychainPassword, daemon no-password).
- [ ] Run `node --import tsx/esm --test scripts/browser-lane-app.test.mjs` → watch it FAIL.

## Task 2 — GREEN: model + presentation
- [ ] `BrowserLaneModels.swift`: keep enum raw values + `usesKeychainPassword`/`providerDomains`/`defaultAuthURL`. Remove the secret-word-risky `label` if unused. Add `func browserLaneHost(_ url:)` helper (host extraction) if useful. Keep models free of bare secret words.

## Task 3 — GREEN: AddSiteViewController rewrite
- [ ] Presentation extension: `displayOrder` + `pickerTitle`.
- [ ] Fields: `nameField`, `websiteField`, sign-in `strategyPicker` (titles from displayOrder), `accountEmailField`, `usernameField`, `passwordField` (gated). Advanced stack: `idField`, `domainsField`, `loginOverrideField`, `credentialRefField`.
- [ ] Toggleable row views (no NSGridView index hiding); `advancedShown` toggles the advanced stack; strategy toggles the credentials rows.
- [ ] Derivations: `normalizedWebsite()`, `deriveAllowedDomains()`, `suggestedId()` (name → website host), `syncCredentialRef()`.
- [ ] `startEmpty()` called from `loadView` when not editing; `useHeyGenDefaults()` only via button. Edit path unchanged (BrowserLaneEditTarget) but maps new fields.
- [ ] `buildSite()`: required Name + Website; derive home/login/domains/id/credentialRef; validate Website is http(s); keep Keychain save semantics (blank password preserves existing secret).
- [ ] Buttons: Save Site (return key default), Open Sign-in (`openAuthFlow` selector kept), Use HeyGen preset. Status near buttons; no "metadata".

## Task 4 — GREEN: Sites list (edit/delete/new)
- [ ] Card per site with click-to-edit (`NSClickGestureRecognizer`) + Edit + Delete buttons; friendly summary using `pickerTitle`, no "metadata", no bare secret words.
- [ ] `New Site` button in header → navigate to addSite.
- [ ] Delete → `NSAlert` confirm → `store.delete` + `keychain.deleteCredential` + re-render.

## Task 5 — GREEN: store, keychain, sidebar, screens
- [ ] `BrowserLaneSiteStore.delete(id:)`.
- [ ] `BrowserLaneKeychain.deleteCredential(siteId:)` via `SecItemDelete` for `:username`/`:password` accounts.
- [ ] `Screens.swift`: rename addSite title to "New Site"; scrub "metadata" from subtitle/placeholder; keep enum cases unchanged.
- [ ] `SidebarViewController.swift`: section header, tighter spacing/selection; uses Screen.title.

## Task 6 — Verify
- [ ] `swift build` in `browser-lane-app/` compiles clean.
- [ ] `npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` all green.
- [ ] Commit + push to main. No HiveMatrix release.
