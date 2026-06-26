# Terminal Lane: honest auth model + profile management — Design

> Date: 2026-06-26
> Status: Approved (recommendation pre-approved; reflects review of Canopy + Terminal Lane)

## Problem

Terminal Lane lets the operator save an SSH "credential" (a Keychain secret) for
a profile, but it connects by spawning a raw `/bin/bash -lc "exec ssh user@host"`
in a SwiftTerm PTY. Raw `ssh` **cannot consume that stored secret** — so a saved
password silently can never auto-connect; the user just gets an interactive
prompt (or a `publickey` failure under the readiness probe's `BatchMode`). The UI
implies the credential is usable. That is dishonest.

Two more gaps: the Profiles screen is a **read-only text dump** (no edit / delete
/ duplicate), and the daemon sync result is reported as success-ish text even
when the daemon sync failed.

## What Canopy does (reference, /Users/irvencassio/Canopy)

- `ServerProfile.authMethod: AuthMethod { password | sshKey }`; passwords/passphrases
  are **never** stored in the profile — only in Keychain (`KeychainService`,
  `kSecClassInternetPassword`, returns only the value, never to the agent).
- `SSHService` uses **Citadel** (a native Swift SSH library), not `/usr/bin/ssh`.
  Password auth → `.passwordBased(...)`; key auth → load key file (+ optional
  passphrase) → `.ed25519/.rsa`. The credential is handed to the library once and
  never re-read.
- `TerminalAgentExecutor.openSSH(payload)` takes **`profileID` only**; `AppState`
  fetches the password from Keychain and hands it to the session. The agent never
  sees a secret. → the "credential-owned runtime" pattern: Keychain owns secrets,
  a trusted layer mediates, only IDs cross the agent boundary.

Terminal Lane has no native SSH runtime. Building/embedding one (or a live Canopy
IPC bridge) is out of scope for this slice.

## MVP decision

Per the brief's allowed fallback: **mark `password_keychain` profiles as "saved
but not auto-connectable yet"** and steer the operator to key/agent auth or an
explicit `manual_password` profile, until a native SSH runtime (or Canopy bridge)
lands. We adopt Canopy's **profileID-only open contract** now so a future bridge
can slot in without changing callers. We never autotype a password into a PTY,
and never spawn raw `ssh` expecting a stored password.

## Decision

### 1. `authMethod` on the profile (honest per-method behavior)

Add `authMethod` and `keyPath` to `TerminalProfile`. `kind` (local|ssh) stays for
back-compat and is derived (local→local, else→ssh).

| authMethod | fields | auto-connect | readiness probe | secret |
|---|---|---|---|---|
| `local` | shell/cwd only | yes | `/usr/bin/true` → ready | none |
| `ssh_key_agent` | host/user/port | yes | `ssh -o BatchMode=yes … true` | none (ssh-agent / default keys) |
| `ssh_key_file` | host/user/port/**keyPath** | yes | `ssh -i <keyPath> -o BatchMode=yes … true` | key file on disk; passphrase may be Keychain-backed later (metadata: keyPath only) |
| `password_keychain` | host/user/port/**credentialRef** | **no (not yet)** | **does not spawn ssh** → `needs_auth` + honest "not auto-connectable yet" message | Keychain secret (stored, currently unusable for auto-connect) |
| `manual_password` | host/user/port | no (prompts) | **does not spawn ssh** → `needs_auth` + "you'll be prompted on open" | none stored |

Back-compat inference when `authMethod` is absent: `kind=local`→`local`;
`kind=ssh` + `credentialRef`→`password_keychain` (legacy dishonest case, now
honestly flagged); `kind=ssh` + no credential→`ssh_key_agent`.

Validation (`normalizeTerminalProfile`):
- `local`: no host/user/port/credentialRef/keyPath.
- `ssh_key_agent` / `manual_password`: host+user required; **reject** credentialRef
  (no Keychain secret for these).
- `ssh_key_file`: host+user+**keyPath required** (absolute path, no spaces);
  credentialRef optional.
- `password_keychain`: host+user+**credentialRef required**.
- `rejectInlineSecrets` stays (no `password`/`passphrase`/`private_key`/… fields).

`terminalAuthCapability(profile)` → `{ autoConnect, needsKeychain, reason }`
describes connectability honestly (used by UI + readiness + open).

`buildTerminalOpenCommand` extended for `keyPath` (`ssh -i …`) — **never** includes
a password.

### 2. Canopy-style open contract (profileID only)

New `src/lib/terminal-lane/open.ts`:
`resolveTerminalOpenRequest({ profileId })` — input is **profileID only** (typed;
`rejectInlineSecrets` on the input). Returns
`{ profileId, openCommand, autoConnect, connectMode, reason }` — **never a
password or any secret**. For `password_keychain` → `autoConnect:false` with a
reason; the daemon never executes it. This mirrors Canopy's agent contract and is
ready for a future credential-owned runtime/bridge.

### 3. Honest readiness (`readiness.ts`)

- `local` → `/usr/bin/true`.
- `ssh_key_agent` / `ssh_key_file` → `ssh -o BatchMode=yes …` (key/agent only; add
  `-i keyPath` for file). Never a password.
- `password_keychain` / `manual_password` → **no ssh spawn**; return `needs_auth`
  with an actionable summary. This guarantees password profiles never spawn raw
  ssh "expecting a password".
- Improve failure messages: `needs_auth`/`blocked`/`probe_failed` get clearer,
  actionable summaries.

### 4. Store + endpoints

- DB migration **v26**: `ALTER TABLE terminal_profiles ADD COLUMN authMethod TEXT
  NOT NULL DEFAULT 'local'`, `ADD COLUMN keyPath TEXT`.
- `upsertTerminalProfile`: persist authMethod/keyPath; **createdAt preserved** on
  update (ON CONFLICT leaves it), `updatedAt` bumped.
- `deleteTerminalProfile(id)`: remove profile + its credential metadata rows +
  probes/runs; **refuses id `local`** (preserve the local default).
- Summaries/dashboard: add `authMethod`, `keyPath`, `autoConnect`,
  `credentialPresent` (boolean) — **no secret values**.
- Endpoints (typed, id-constrained, no arbitrary shell):
  - `DELETE /terminal-lane/profiles/:id` → deleteTerminalProfile.
  - `POST /terminal-lane/open` → body `{ profileId }` only (rejectInlineSecrets);
    returns the resolved open request. Resolves only; **does not execute**.
  - existing profiles/dashboard/probes/readiness-run/traces unchanged.

### 5. Terminal Lane app (Swift)

- **Models**: `TerminalLaneAuthMethod { local, ssh_key_agent, ssh_key_file,
  password_keychain, manual_password }` + `keyPath`; computed `autoConnect`,
  `connectModeLabel`, `connectReason`. `localDefault()` uses `.local`.
- **Profiles screen**: real `NSTableView` — columns name / auth method / sync /
  readiness / credential present (✓/—, never the secret). Buttons: **Edit**
  (prefill the editor, preserve createdAt), **Delete** (NSAlert confirm; refuses
  the local default), **Duplicate** (clone with a new id).
- **Add/Edit screen**: auth-method popup drives which fields show; per-method copy
  including the honest `password_keychain` "saved but NOT auto-connectable yet"
  note and `manual_password` "you'll be prompted; nothing stored". Secrets entered
  via `NSSecureTextField` → Keychain only, never into the profile/daemon payload.
- **Terminal screen**: show connect mode + whether auto-connect is supported; for
  `password_keychain` show the inline reason instead of silently prompting; never
  autotype a password.
- **Daemon sync result**: failures are shown **distinctly** ("Saved locally —
  daemon sync FAILED: …"), never as plain success.
- **Settings**: keeps Keychain service + profile path (already present).

## Security / non-goals honored

- No secrets in any profile JSON, daemon payload, trace, log, or Swift source
  string — regression tests assert this; `redact()` + `rejectInlineSecrets` stay.
- Credentials stay in macOS Keychain only. `keyPath` is a path (metadata), not a
  secret.
- No arbitrary shell execution endpoint: `/terminal-lane/open` resolves a typed,
  profile-derived command and returns it; the app runs it locally as today.
- No new business workflows; no HeyGen; Browser Lane untouched except a possible
  tiny shared-copy/test tweak (none needed here).
- iOS unchanged: it does not consume terminal-lane; the additions are additive and
  backward-compatible, so no iOS handoff is required.

## Tests (TDD)

1. Contract: authMethod parsing/inference; per-method field rules; `password_keychain`
   requires credentialRef; `ssh_key_agent`/`manual_password` reject credentialRef;
   `ssh_key_file` requires keyPath; `terminalAuthCapability` autoConnect matrix.
2. Open contract: `resolveTerminalOpenRequest({profileId})` takes profileID only,
   returns no secret, and reports `password_keychain` not auto-connectable; passing
   a password-bearing input is rejected.
3. Readiness: `password_keychain`/`manual_password` do **not** invoke the ssh
   runner; key/agent/file do; never a password in argv.
4. Store/endpoints: delete removes a profile and refuses `local`; createdAt
   preserved on update; summaries expose authMethod + credentialPresent, no secret;
   server declares `DELETE /terminal-lane/profiles/:id` and `POST /terminal-lane/open`.
5. No-leak regression: profile JSON, dashboard, open response, traces contain none
   of `password|passphrase|private_key|secret|token|cookie` **values**.
6. Swift app source tests: Profiles table supports edit/delete/duplicate; auth-method
   popup + per-method copy; password profiles aren't auto-connected (terminal screen
   shows reason); secrets via NSSecureTextField→Keychain only; sync failure shown
   distinctly. Existing packaging/identity tests stay green.

## Gates

- `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
- Swift changed → rebuild/package Terminal Lane (`scripts/package-terminal-lane-app.mjs`).
- No release metadata change → no `release:verify` needed.
