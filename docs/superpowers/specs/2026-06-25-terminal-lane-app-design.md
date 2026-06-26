# Terminal Lane App Design

Date: 2026-06-25

## Context

Terminal Lane (`terminal`, legacy kind `termbee`) exists today only as an
*execution engine*: the in-process shell manager in `src/lib/termbee/session.ts`
that the agent drives via `termbee_run`. It has no standalone app, no embedded
HiveMatrix subsystem, no daemon endpoints, no setup database, and no human UI.

Browser Lane is the established template for "a Lane as its own app + embedded
HiveMatrix logic": a native macOS app (`browser-lane-app/`), a TS subsystem
(`src/lib/browser-lane/`), daemon endpoints (`/browser-lane/*`), SQLite setup
tables, a COO routing rule, and a readiness dashboard. Terminal Lane should
reach the same shape.

A `termbee` provider currently prefers **Canopy** (a separate macOS app) when its
agent bridge is up (`src/lib/canopy/client.ts`, `src/lib/termbee/provider.ts`).
The Canopy name and app are a source of confusion with HiveMatrix, and an
external running dependency we do not want.

## Decision

Build Terminal Lane as a self-contained peer of Browser Lane, with **no Canopy
dependency** and a **human-usable interactive terminal**.

1. **Remove the Canopy provider.** Strip the Canopy-first branch from
   `src/lib/termbee/provider.ts`; the provider delegates only to the local
   in-process engine. Delete `src/lib/canopy/client.ts` and its test. Re-close
   DECISIONS Q10 as "HiveMatrix-owned, no external provider."

2. **New TS subsystem `src/lib/terminal-lane/`** mirroring `browser-lane/`:
   `contracts.ts`, `store.ts`, `keychain.ts`, `readiness.ts`, `dashboard.ts`.
   It layers profile registration / readiness / dashboard *on top of* the
   existing `termbee/` engine — the engine stays the agent execution path.

3. **New daemon endpoints `/terminal-lane/*`** mirroring `/browser-lane/*`.

4. **New SQLite setup tables** (one migration): `terminal_profiles`,
   `terminal_credentials`, `terminal_readiness_probes`, `terminal_readiness_runs`,
   `terminal_session_audit`.

5. **New native app `terminal-lane-app/`** mirroring `browser-lane-app/`, with a
   live PTY terminal rendered by the **SwiftTerm** SwiftPM library (MIT; vendored
   statically into the app, no running sidecar — analogous to Browser Lane's use
   of WKWebView).

6. **COO setup db:** add an executable dispatch bridge so Terminal Lane routes to
   a real work item, plus per-profile readiness in the dashboard.

## Session model (the core contract)

A **terminal session is a persistent window bound to one host.** It is opened
once; the connection stays live; commands run *inside* the window with full
state (cwd, env, history, running processes). It is **not** stateless
`ssh host "cmd"` one-shot execution.

| Session type | What the PTY runs | Result |
|---|---|---|
| Local host | `$SHELL` (e.g. `/bin/zsh`) | Live local terminal |
| Remote host | `ssh user@host` | Live remote shell *inside the window*; every later command runs on that host, state persists |

Connecting to a remote host = spawning a persistent PTY whose process is the
`ssh` session itself. After connect there is no per-command ssh — it is a live
remote shell, identical in feel to a local one. One session per host; sessions
stay open across the app's lifetime.

Sessions are **first-class, per-host, persistent, and shared between human and
agent.** A profile declares the open command (`$SHELL` vs `ssh user@host`). The
human opens/focuses sessions in the app; the agent's `termbee_run` targets a
session by id and writes into that same live session. The remote stack is just
the on-disk `ssh` binary plus the human's Keychain-stored key — no Node SSH
library, no Canopy.

### Contract changes

- `TermSessionInfo` / `createSession` gain an optional **host binding**: a
  profile id (or inline `{ openCommand }`) so a session can be a local shell or
  an `ssh user@host` session. Default stays local bash for backward
  compatibility.
- Human-facing sessions in the app run a **real PTY via SwiftTerm**
  (`LocalProcessTerminalView`), not the marker engine. The marker engine remains
  the agent's command-execution mechanism for sessions it owns.

## UX

The app mirrors Browser Lane's split-view chrome (sidebar + content). Screens:

- **Terminal** — the live SwiftTerm PTY view; open/focus a session per profile,
  type and run commands interactively.
- **Profiles** — list saved local/remote profiles (id, display name, host, user,
  port, shell, key/credential ref, last readiness status). Refresh.
- **Add Profile** — dense maintenance form: profile id, display name, kind
  (local/ssh), host, user, port, shell, working dir, credential ref, key
  passphrase / password. Buttons: **Save profile + key**, **Test connection**.
- **Readiness** — per-profile green/yellow/red from the latest probe.
- **Traces** — recent session audit entries.

"Test connection" runs a readiness probe (e.g. `ssh -o BatchMode=yes
-o ConnectTimeout=8 user@host true`) and records a readiness run.

## Security

- Keys, passphrases, and passwords are passed directly to Security.framework and
  stored in macOS Keychain only, under service `HiveMatrix Terminal Lane`, with
  credential refs shaped `hivematrix.terminal.<profile>.<account>`.
- Profile metadata JSON / SQLite must never include password, passphrase,
  private key, token, or secret values — only `credentialRef` pointers.
- Daemon sync sends only `credentialRef`, never the secret value.
- The app validates credential refs start with `hivematrix.terminal.`.
- Session audit records commands/metadata for transparency but never secrets.

## Non-Goals

- No Canopy, no node-pty in the daemon, no tmux, no Node SSH library.
- No cloud sync of profiles or keys.
- No automated credential entry beyond standard `ssh` key/agent auth.
- No multiplexing protocol beyond per-host persistent sessions.
- No web/iOS terminal in this slice (native macOS only).

## Acceptance Criteria

- Canopy provider removed; `termbee` provider delegates only to the local engine;
  `src/lib/canopy/` deleted; DECISIONS Q10 updated; existing termbee tests green.
- `src/lib/terminal-lane/` exposes profile store, keychain ref helpers, readiness,
  and dashboard, backed by the new SQLite tables, with no secrets persisted.
- Daemon serves `/terminal-lane/*` (profiles, dashboard, readiness/run, probes,
  traces) behind the local auth token.
- COO dispatch routes a terminal request to an executable work item and records
  the dispatch audit row.
- The native app opens persistent per-host SwiftTerm sessions (local + ssh),
  lets a human manage keys (Keychain), test login (readiness), and run commands
  interactively in the session window.
- `termbee_run` can target a session bound to a remote host and run commands in
  that live session.
- Tests/static checks verify: Security.framework usage, no password-like fields
  in the profile model, SwiftTerm linked, daemon sync sends only `credentialRef`.
- The app builds, packages, installs to `/Applications`, is Developer ID signed,
  notarized/stapled, and launches.
