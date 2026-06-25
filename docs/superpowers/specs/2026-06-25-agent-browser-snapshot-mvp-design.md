# Agent-Browser Snapshot MVP — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: agent-browser-snapshot-mvp
> Builds on commit `9df038b` (Browser Lane readiness maintenance).

## Problem

`createAgentBrowserAdapter()` returns the *unavailable* stub, so every readiness
probe on the default path records `blocked` — readiness can never go green from a
real page. We replace the stub with a real, conservative, **read-only** adapter so
basic public/readable probes produce honest green/red/orange results, while the
Codex Computer Use and Desktop-fallback execution paths are untouched.

## Backend choice — fetch + static HTML snapshot (no new dependency)

We deliberately **avoid adding Playwright** for this MVP:
- Readiness probes only need to *open a URL and read a deterministic snapshot* (title,
  text, forms, links). A headless engine is unnecessary for that and adds a heavy,
  platform-specific native dependency + notarization/signing surface.
- A `fetch` + small deterministic HTML extractor is read-only by construction: Node
  `fetch` sends **no cookies/credentials**, so this can never masquerade as an
  authenticated session — exactly the honesty the design wants.
- Trade-off (documented): no JavaScript rendering. SPA pages that render entirely
  client-side will yield a thin snapshot → readiness reports `probe_failed`/`unknown`
  rather than a false green. Authenticated/workflow execution stays on Codex Computer
  Use / Desktop fallback (unchanged). Playwright can be added later behind the same
  `BrowserLaneAdapter` interface if JS rendering is needed.

## Design

### Adapter (`src/lib/browser-lane/adapters/agent-browser.ts`)
- `createAgentBrowserAdapter(opts?: { fetchPage?: FetchPage }): BrowserLaneAdapter`.
  Default `fetchPage` = real `fetch` (GET, follow redirects, 15s timeout, a static UA,
  **no credentials/cookies**). Tests inject a fake `fetchPage` (deterministic, offline).
- `open`: validate http(s); fetch; store `{ finalUrl, html, status }` under a `pageId`.
  Network/HTTP failure → `{ ok:false, error }` (honest), never a fake success.
- `snapshot`: build a `PageSnapshot` from the stored HTML (pure
  `buildAgentBrowserSnapshot(url, html)`, exported for direct unit tests).
- `act`: read-only MVP — returns `{ ok:false, error }`. `credential_fill` is explicitly
  unsupported (no Keychain-backed fill exists yet). Interactive/authenticated steps need
  a human; we never bypass them.
- `screenshot`: unsupported (`ok:false`). `close`: drops the page.

### Snapshot contract (pure extractor)
`buildAgentBrowserSnapshot(url, html)` →
- `url`, `title` (from `<title>`, entity-decoded).
- `text`: scripts/styles/comments stripped, tags removed, entities decoded, whitespace
  collapsed, **secrets redacted**, length-capped.
- `forms[]`: each `<form>` → `fields[]` (`input`/`select`/`textarea`) with `kind` (input
  type) + best `label` (`<label for>` → aria-label → placeholder → name). `purpose`:
  `login` if a password field is present, else `search`/`form`. **No field values.**
- `actions[]`: links (`<a href>`) and buttons (`<button>`, `submit`/`button` inputs) with
  `text`. Counts capped.
- `state`: `unauthenticated` when a password field is present (a login wall); otherwise
  `unknown`. **Never `authenticated`** — a cookieless fetch cannot prove a session.

### Redaction / no-leak guarantee
- `text` is run through a redactor covering `password|secret|token|api-key|<…>key`
  `key=value` / `key: value` and `Bearer <token>` and cookie-ish blobs.
- Snapshots never carry input **values**, cookies, storage, headers, or Keychain
  material — those are never extracted in the first place.

### Readiness integration
- The default path now uses the real adapter, so `runBrowserLaneReadiness` /
  `POST /browser-lane/readiness/run` produce real green/red/orange. `backendReady` becomes
  `true` (a real backend is wired).
- Login detected (password field → `state:unauthenticated`) → `readiness.ts`
  `detectHumanRequirement` returns `login` → `human_required` (orange), never fake green.
  CAPTCHA/2FA text → `captcha`/`two_factor`. The `probe.snapshot` trace event carries safe
  metadata (url, state, title, form/action counts) — no secrets.

## Tests (RED first)
- `buildAgentBrowserSnapshot`: plain page (title + expected text); login form
  (password field → `unauthenticated`, `purpose:login`, labeled fields); link/button
  actions; password/token text redacted; never `authenticated`.
- adapter `open`+`snapshot` with an injected `fetchPage`; invalid/non-http URL → error;
  fetch failure → `ok:false` (not a stub).
- probe-service: replace the "not wired yet" default test with a real-adapter (injected
  fetch) run → `ready` on matching text, `human_required` on a login page; `backendReady:true`.
- existing injected-fake probe-service test still passes.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — all green.
