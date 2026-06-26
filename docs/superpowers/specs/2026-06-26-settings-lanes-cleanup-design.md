# Settings → Lanes: reduce duplicate-feeling Lane sections — Design

> Date: 2026-06-26
> Status: Approved (recommendation pre-approved by founder; code inspection confirms it is implementable)

## Problem

Settings → Lanes currently stacks several sections whose headings read as
near-duplicates of each other. The two worst offenders both inventory things
called "…Lane":

- **Lane Apps** — standalone signed apps (Browser Lane, Terminal Lane) you
  install/update/verify/launch.
- **Embedded capability lanes** — capabilities running *inside* the daemon
  (Message Lane, Mail Lane, Browser, Terminal, Memory, Review, Desktop).

Both lists contain a "Browser" and a "Terminal" entry, so the second section
reads like a second copy of the first. The operator can't tell at a glance that
one is "apps I install" and the other is "capabilities the daemon runs".

A third source of confusion: **Browser Lane readiness** (per-site auth) lives
far down the page, separated from Lane Apps by COO Dispatch and COO routing
rules, so the operational readiness for the Browser Lane app reads as unrelated
to the app itself. There is no matching Terminal Lane readiness surface at all,
even though the daemon already exposes one.

## Current section order (src/daemon/console.ts, `#settingsLanes`)

1. System Readiness
2. Lane Apps
3. Embedded capability lanes (`s_lanes`, `/lanes`)
4. COO Dispatch
5. COO routing rules
6. Browser Lane readiness (`browser_readiness`, `/browser-lane/dashboard`)
7. HeyGen portal videos
8. Workflows
9. Safe senders

## Key code-inspection finding

The daemon **already** exposes a full Terminal Lane readiness API that mirrors
Browser Lane, but the console never renders it:

- `GET /terminal-lane/dashboard` → `{ ok, lane, laneDisplayName, totals:{profiles,byColor,needsAttention}, profiles:[{...summary, readiness:{status,color,summary,lastRunAt}}] }` (src/daemon/server.ts:1488, src/lib/terminal-lane/store.ts:217)
- `POST /terminal-lane/readiness/run` → runs real local/SSH probes now (server.ts:1506)
- `GET /terminal-lane/profiles` → list configured profiles (server.ts:1470)

Readiness states are real and honest: `ready/needs_auth/probe_failed/blocked/unknown`
mapped to `green/yellow/orange/red/gray`. When no probe has run, a profile is
`unknown`/gray with summary "No readiness run recorded." — no fabricated green.
Secrets are never returned: the store redacts metadata, and secret *values* live
in macOS Keychain, never in the dashboard payload.

**Conclusion:** we can build a *real* "Terminal Lane Profiles & Readiness" card
from existing endpoints. No placeholder, no invented readiness.

## Three buckets the redesign must make obvious

1. **Standalone lane apps** — install/update/verify/launch → the existing
   **Lane Apps** card (canonical, unchanged behavior).
2. **Browser/Terminal operational readiness** — site auth + profile readiness
   for those apps, placed directly under Lane Apps and visually grouped with it.
3. **Runtime/built-in lane capabilities** — the daemon-embedded capabilities,
   relabeled so it no longer reads as a second app inventory.

## Decision

### Relabels

- `Embedded capability lanes` → **`Runtime Capabilities`**. Dropping the word
  "Lanes" from the heading is the strongest disambiguator from "Lane Apps"; the
  body still lists "X Lane" items, which *are* the runtime capabilities. (The
  spec offered "Runtime Capabilities" or "Built-in Lanes"; we pick the former
  because it removes the "Lane(s)" collision entirely.)
- `Browser Lane readiness` → **`Browser Lane Sites & Auth`**. Names what it is
  (per-site authentication/readiness), not a vague "readiness".

### New section

- **`Terminal Lane Profiles & Readiness`** — a real card backed by
  `GET /terminal-lane/dashboard` with a "Run readiness check" action posting to
  `POST /terminal-lane/readiness/run` (mirrors the Browser Lane readiness card).
  Shows per-profile display name, kind (local/ssh) and readiness status/color.
  Does **not** render `credentialRef`, host/user secrets, or any keychain value.
  When no profiles are configured, shows an honest "No Terminal Lane profiles
  are configured." empty state — never a fake-green.

### New section order

1. System Readiness *(unchanged)*
2. **Lane Apps** — Browser Lane + Terminal Lane app install/update/verify/launch
3. **Browser Lane Sites & Auth** — moved up, directly under Lane Apps
4. **Terminal Lane Profiles & Readiness** — new, directly after Browser readiness
5. **Runtime Capabilities** — relabeled embedded lanes
6. COO Dispatch *(unchanged)*
7. COO routing rules *(unchanged)*
8. HeyGen portal videos *(unchanged)*
9. Workflows *(unchanged)*
10. Safe senders *(unchanged)*

Lane Apps + the two readiness cards form a visually connected "lane apps and
their operational readiness" block before the page moves on to COO/runtime.

## Constraints honored

- No "Bee" names in any new/edited user-facing copy.
- System Readiness, COO Dispatch, COO routing rules, Workflows, HeyGen portal,
  Safe senders and all existing endpoints are preserved.
- No silent installs, no auto-repair-all, no secrets/credential values in UI.
- Terminal readiness uses only existing daemon endpoints; no fabricated data.
- The Settings *tab* strip order (about…lanes…remote) is unchanged.

## Out of scope

- No daemon/server endpoint changes (all needed endpoints already exist).
- No changes to the Lane Apps install/verify flow itself.
- No new Terminal Lane profile *creation* UI (the section is read + run-probe
  only, matching the Browser Lane readiness card's scope).

## Tests (TDD)

Console source-level assertions (the console is a `String.raw` template; tests
parse `CONSOLE_HTML`):

1. Section labels present and unambiguous: `Lane Apps`, `Runtime Capabilities`,
   `Browser Lane Sites & Auth`, `Terminal Lane Profiles & Readiness`.
2. The old primary label `Embedded capability lanes` is gone.
3. Browser Lane and Terminal Lane both appear in Lane Apps (via catalog test
   already covering `browser-lane`/`terminal-lane`; console copy still names both).
4. Browser readiness/site-auth render remains wired (`renderBrowserReadiness`,
   `/browser-lane/dashboard`).
5. New Terminal readiness render uses the existing daemon endpoint
   (`/terminal-lane/dashboard`, `/terminal-lane/readiness/run`) and exposes no
   secrets (source must not reference `credentialRef`/`password`/`private_key`).
6. Browser Lane Sites & Auth appears before Runtime Capabilities (ordering proof).

## Gates

- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
- `npm run verify:portal`
