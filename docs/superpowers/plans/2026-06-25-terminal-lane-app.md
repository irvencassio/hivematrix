# Terminal Lane App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-25-terminal-lane-app-design.md`. Template: Browser Lane (`browser-lane-app/`, `src/lib/browser-lane/`, `/browser-lane/*` endpoints).

## Phase 0 — Remove Canopy dependency ✅ (2026-06-25)

- [x] RED test: `src/lib/termbee/provider.test.ts` asserts the provider uses only the local engine (no Canopy import / no agent-bridge call).
- [x] Strip the Canopy-first branch from `src/lib/termbee/provider.ts`; delegate to the local session engine.
- [x] Delete `src/lib/canopy/client.ts` and `src/lib/canopy/client.test.ts`; remove remaining `canopy` references in `outbound-routing.ts` / `lane-tools.ts` / `desktopbee` / `brain/memory-bundle` that pertain to the terminal provider.
- [x] Re-close DECISIONS Q10 as "HiveMatrix-owned terminal lane, no external provider."
- [x] Green: termbee + lane-tools + outbound-routing + memory-bundle suites (46 tests pass); `tsc --noEmit` clean.

## Phase 1 — TS subsystem, DB, daemon endpoints

- [x] RED tests for `src/lib/terminal-lane/` (contracts/store/keychain/readiness/dashboard) and new daemon routes.
  - Assert the profile model declares no password/passphrase/privateKey/token/secret fields.
  - Assert daemon sync payload carries only `credentialRef`.
- [x] DB migration: add `terminal_profiles`, `terminal_credentials`, `terminal_readiness_probes`, `terminal_readiness_runs`, `terminal_session_audit` to `src/lib/db/index.ts` (mirror the `browser_*` tables).
- [x] `src/lib/terminal-lane/contracts.ts` — `TerminalProfile` (id, displayName, kind `local|ssh`, host, user, port, shell, cwd, credentialRef, openCommand) + `rejectInlineSecrets()` (mirror browser-lane).
- [x] `src/lib/terminal-lane/store.ts` — `upsertTerminalProfile`, `listTerminalProfiles`, `listTerminalProfileSummaries`, probe + readiness-run CRUD, `getTerminalLaneReadinessDashboard`.
- [x] `src/lib/terminal-lane/keychain.ts` — `security` CLI wrapper, service `HiveMatrix Terminal Lane`, ref format `hivematrix.terminal.*`.
- [x] `src/lib/terminal-lane/readiness.ts` — run a profile probe (`ssh -o BatchMode=yes -o ConnectTimeout=8 user@host true` / local `true`), map to status+color.
- [x] Daemon endpoints in `src/daemon/server.ts`: `POST/GET /terminal-lane/profiles`, `GET /terminal-lane/dashboard`, `POST /terminal-lane/probes`, `POST /terminal-lane/readiness/run`, `GET /terminal-lane/traces`.
- [x] Green: `node --test`.

## Phase 2 — Session contract + COO setup db

- [x] RED tests: session can bind to a host; COO routes terminal → executable work item.
- [x] Extend `src/lib/termbee/contracts.ts` + `session.ts`: optional host binding (`openCommand`/profile id); default stays local bash. Remote = PTY-less marker engine over an `ssh user@host` shell, or local bash that execs `ssh` — keep state persistence.
- [x] `src/lib/coo/dispatch.ts`: add `buildTerminalWorkItem()` executable bridge (parallel to `buildBrowserWorkItem`); record dispatch audit.
- [x] Update the default `default.terminal` COO rule to the executable path (capability `terminal.run`, risk tier `normal`).
- [x] Green: `node --test`.

## Phase 3 — Native app shell (clone Browser Lane)

- [x] RED static tests: `scripts/terminal-lane-app.test.mjs` asserts the Swift sources exist, Security.framework is used, SwiftTerm is a declared SwiftPM dependency, and the profile model has no secret fields.
- [x] `terminal-lane-app/Package.swift` (bundle id `com.irvcassio.hivematrix.terminallane`, macOS 14+, SwiftTerm dependency).
- [x] Sources `terminal-lane-app/Sources/TerminalLaneApp/`: `main.swift`, `AppDelegate.swift`, `RootSplitViewController`, `SidebarViewController`, `ContentViewController`, `Screens` (Terminal · Profiles · AddProfile · Readiness · Traces).
- [x] `TerminalLaneModels.swift`, `TerminalLaneProfileStore.swift` (JSON under `~/Library/Application Support/Terminal Lane/profiles.json`), `TerminalLaneKeychain.swift` (Security.framework, service `HiveMatrix Terminal Lane`), `TerminalLaneDaemonClient.swift` (`POST 127.0.0.1:3747/terminal-lane/*` + `~/.hivematrix/auth-token`).
- [x] `ProfilesViewController.swift` + `AddProfileViewController.swift` (form + Save profile + key + Test connection).
- [x] Green: `node --test scripts/terminal-lane-app.test.mjs`; `swift build`.

## Phase 4 — SwiftTerm interactive terminal

- [x] `TerminalViewController.swift`: embed SwiftTerm `LocalProcessTerminalView`; open a persistent PTY per profile — local `$SHELL`, or `ssh user@host` for ssh profiles. Open/focus by profile; sessions persist for the app lifetime.
- [ ] Wire session open/focus from the Profiles list; surface session id so the agent can share/target it.
- [ ] Verify human flow: add key → test login (readiness) → open host session → run commands interactively with persistent state.

## Phase 5 — Package, icon, ship

- [x] `scripts/package-terminal-lane-app.mjs` + icon generator (mirror `package-browser-lane-app.mjs` / `generate-browser-lane-icon.mjs`).
- [x] Build, package, copy to `/Applications/Terminal Lane.app`, sign (Developer ID Application: Irven Cassio, 8B3CHTY93V), notarize, staple, Gatekeeper assess, launch and verify.
- [x] Operator runbook `docs/runbooks/terminal-lane-macos-app.md`.
