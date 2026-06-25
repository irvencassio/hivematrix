# Browser Lane Hardening Design

Date: 2026-06-25
Status: Approved by follow-up direction: work through remaining review items

## Context

The first Browser Lane pass created the right product direction: Browser Lane is the canonical browser surface, `hivematrix_browser` is the model-facing tool, and BrowserBee/WebBee/Weaver stop being product concepts.

The review found that the implementation is still partly scaffold:

- iOS calls `/lanes`, but the daemon still serves only `/bees`.
- Browser Lane Keychain writes pass secret values on the `security` command line.
- BrowserBee and WebBee names remain active as callable tool aliases and service status entries.
- `hive browser read <url> <question>` drops the URL.
- readiness `selector` and `visual` assertions are text checks.
- `/browser-lane/probe` is still an explicit stub.
- the Mac app is a Swift executable scaffold, not a bundled signed app.
- desktop console still renders Bees language and calls `/bees`.

## Design Direction

This hardening slice should make the renamed lane boundary operational without trying to finish the entire app/browser engine.

The priority order is:

1. Keep clients working by adding first-class `/lanes` daemon endpoints while preserving `/bees` as a private compatibility alias.
2. Stop putting Browser Lane secrets in process arguments.
3. Remove BrowserBee/WebBee from active model/CLI dispatch, except where a deliberately named compatibility layer is still needed for old persisted data.
4. Fix deterministic CLI semantics so read mode preserves both URL and question.
5. Make readiness assertions honest: selector checks use structured snapshot data, visual assertions are unsupported until a visual backend is connected.
6. Rename visible desktop console wording to Lanes.
7. Leave packaged Browser Lane app, real visual perception, and CAPTCHA/human-auth workflows as explicit next slices.

## Compatibility Posture

`/bees` may remain as a compatibility endpoint for old desktop clients and old scripts, but new first-party clients must use `/lanes`.

The daemon may keep internal `bee` type names where the wider codebase still depends on them, but:

- model-advertised tools must not include `webbee_search` or `browserbee_run`;
- direct execution of old browser aliases should return an explicit migration error;
- service status exposed through `/lanes` should present Browser Lane, not BrowserBee/WebBee;
- docs and UI should prefer Lane language.

## Secret Boundary

Browser Lane can temporarily use the macOS `security` CLI for reads, but writes must not put secret values in argv. The first safe implementation uses `security add-generic-password -w` without a value and supplies the secret over stdin. If this proves unreliable in production, the next step is a native Swift Security.framework helper.

Tests must prove:

- no write command contains the secret in its args;
- diagnostics remain redacted;
- unsupported secret kinds are rejected.

## Readiness Semantics

Readiness assertions should mean what they say:

- `text`: substring in page text.
- `account_text`: substring in page text, intended for account identity checks.
- `url_contains`: substring in URL.
- `selector`: match against a structured selector field in actions, forms, and form fields.
- `visual`: fail closed with maintenance/probe failure until screenshot/OCR/vision support is wired.

CAPTCHA and 2FA remain human-required states, not automation failures.

## Deferred Work

- Build a real signed Browser Lane `.app` bundle with entitlements and app identifier.
- Add dashboard persistence and the Browser Lane site maintenance UI.
- Implement `/browser-lane/probe` against DB-backed sites/probes.
- Add OCR/local vision/frontier vision escalation.
- Add human-auth check-in flow for 2FA/CAPTCHA.
- Rename wider legacy Bee architecture only after scope-wall and component-map decisions are made.
