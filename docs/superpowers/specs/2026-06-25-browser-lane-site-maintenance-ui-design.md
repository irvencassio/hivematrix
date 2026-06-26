# Browser Lane Site Maintenance UI Design

Date: 2026-06-25

## Context

The native Browser Lane app is installed and notarized, but the Add Site screen still says:

> Site registration is not wired yet.

That blocks the operator from using the app for its intended first job: set up authenticated sites before Browser Lane tasks need them.

HiveMatrix already exposes the safe daemon metadata endpoint:

- `POST /browser-lane/sites`
- `GET /browser-lane/sites`

Those endpoints store Browser Lane site metadata and `credentialRef` pointers in SQLite. They never accept or store password values. The existing daemon-side Keychain service name is `HiveMatrix Browser Lane`, with credential refs shaped as `hivematrix.browser.<site>.<account>`.

## Decision

Implement Add Site in the native Browser Lane app:

- Save site metadata locally in the app's Application Support directory.
- Save username/password in macOS Keychain only, under the `HiveMatrix Browser Lane` service.
- Sync site metadata to the local HiveMatrix daemon when available.
- Never write credentials to SQLite, logs, UserDefaults, JSON metadata, or the daemon API.

## UX

The Add Site screen should contain a dense maintenance form:

- Site id
- Display name
- Home URL
- Login URL
- Allowed domains
- Credential ref
- Username
- Password
- Buttons:
  - Save site + credentials
  - Open login URL

Sites should list saved local site metadata, including credential ref and sync status. Readiness and Traces can remain simple for this slice, but they should no longer imply that site setup is unavailable.

## Security

- Password values are passed directly to Security.framework Keychain APIs.
- Site metadata JSON must not include username, password, token, cookie, secret, or Keychain values.
- Daemon sync must send only `credentialRef`, never the credential value.
- The app should validate credential refs start with `hivematrix.browser.`.

## Non-Goals

- No automated credential fill.
- No CAPTCHA or 2FA bypass.
- No readiness probe execution inside the native app.
- No cloud sync.
- No new daemon schema.

## Acceptance Criteria

- Add Site no longer shows placeholder-only copy.
- Saving a site creates/updates local metadata and Keychain username/password entries.
- The saved site can be viewed in the Sites screen.
- The app attempts to sync metadata to `POST /browser-lane/sites` using the local daemon token when available.
- Tests/static checks verify the UI is wired, Security.framework is used, and password-like values are not persisted in the site metadata model.
- The app builds, packages, installs to `/Applications`, is Developer ID signed, notarized/stapled, and launches.
