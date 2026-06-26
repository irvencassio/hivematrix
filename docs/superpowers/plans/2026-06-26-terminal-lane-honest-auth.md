# Terminal Lane Honest Auth + Profile Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-26-terminal-lane-honest-auth-design.md`

## Task 1 — RED: contract + open + capability tests

- [ ] Extend `src/lib/terminal-lane/contracts.test.ts`: authMethod parse/infer;
  per-method field rules; password_keychain requires credentialRef;
  ssh_key_agent/manual_password reject credentialRef; ssh_key_file requires keyPath;
  `terminalAuthCapability` autoConnect matrix; `buildTerminalOpenCommand` adds `-i`
  for keyPath and never a password.
- [ ] New `src/lib/terminal-lane/open.test.ts`: `resolveTerminalOpenRequest({profileId})`
  profileID-only; no secret in output; password_keychain → autoConnect:false + reason;
  a password-bearing input is rejected.
- [ ] Run → fail.

## Task 2 — GREEN: contracts.ts + open.ts

- [ ] Add `TERMINAL_AUTH_METHODS`, `TerminalAuthMethod`, `authMethod`+`keyPath` on
  `TerminalProfile`; `normalizeTerminalProfile` infers/validates per method; add
  `terminalAuthCapability`; extend `buildTerminalOpenCommand` for keyPath.
- [ ] New `open.ts` `resolveTerminalOpenRequest({profileId}, deps?)`.
- [ ] Run → green.

## Task 3 — RED: readiness honesty

- [ ] Extend `readiness.test.ts`: password_keychain/manual_password do NOT call the
  runner (assert runner uninvoked); ssh_key_agent uses BatchMode; ssh_key_file adds
  `-i keyPath`; never a password in argv. Run → fail.

## Task 4 — GREEN: readiness.ts

- [ ] Branch on authMethod: local→true; key/agent→ssh probe; file→ssh -i probe;
  password_keychain/manual_password→synthesize `needs_auth` state without spawning.
  Run → green.

## Task 5 — RED→GREEN: store + migration + endpoints

- [ ] Extend `store.test.ts`: createdAt preserved on update; summaries include
  authMethod + credentialPresent; `deleteTerminalProfile` removes a profile and
  refuses `local`; no secret in summaries/dashboard.
- [ ] db migration v26 (ALTER add authMethod/keyPath); update rowToProfile, summary,
  upsert, dashboard; add `deleteTerminalProfile`.
- [ ] Extend `scripts/terminal-lane-daemon.test.mjs`: `DELETE /terminal-lane/profiles/:id`
  + `POST /terminal-lane/open`; add a no-secrets endpoint regression.
- [ ] server.ts: add the two routes (id-constrained, rejectInlineSecrets on open body).
- [ ] Run → green.

## Task 6 — RED→GREEN: Swift app + app tests

- [ ] Update `scripts/terminal-lane-app.test.mjs`: Profiles table (NSTableView) with
  Edit/Delete/Duplicate; auth-method popup + per-method copy; password_keychain
  "not auto-connectable" copy on terminal + add screens; secrets via
  NSSecureTextField → Keychain only (no secret in profile/daemon payload); sync
  failure shown distinctly. Keep identity/packaging assertions.
- [ ] Implement: TerminalLaneModels (authMethod + keyPath + capability), ProfilesViewController
  (table + edit/delete/duplicate), AddProfileViewController (authMethod-driven),
  TerminalViewController (connect mode + honest reason), TerminalLaneDaemonClient
  (distinct sync-failure result + delete call), a shared edit target.
- [ ] Run app tests → green.

## Task 7 — Rebuild + gates + push

- [ ] `node scripts/package-terminal-lane-app.mjs` (swift build -c release).
- [ ] `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
- [ ] Install/relaunch locally if packaging changed (copy build app to ~/Applications).
- [ ] Commit; push to main; report hash + rebuild/install status.
