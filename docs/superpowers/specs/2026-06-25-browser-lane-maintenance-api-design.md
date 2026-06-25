# Browser Lane Maintenance API Design

Date: 2026-06-25
Status: Follow-up implementation slice

## Context

Browser Lane now has DB-backed sites, probes, runs, and trace events. `/browser-lane/probe` can execute configured probes, but there is no first-party way to configure the site/probe registry without direct SQL or future native app UI.

This slice adds a minimal metadata-only maintenance surface for the daemon and CLI.

## Scope

Add:

- `GET /browser-lane/sites`
- `POST /browser-lane/sites`
- `POST /browser-lane/probes`
- `hive browser sites list`
- `hive browser sites add <site-id> --name <name> --home-url <url> [--login-url <url>] [--domain <domain>] [--credential-ref <ref>]`
- `hive browser probes add <site-id> <probe-id> --name <name> --url <url> --text <expected-text>`

The CLI and API must remain secret-safe:

- Accept `credentialRef`, not passwords.
- Keep rejecting password/cookie/token/TOTP flags.
- Store only Browser Lane metadata and Keychain references.

## Deferred

- Native Browser Lane app maintenance UI.
- Actual Keychain password entry flow.
- Probe editing/deleting.
- Multiple assertions per CLI command beyond a simple first text assertion.
- Browser profile/session management.
