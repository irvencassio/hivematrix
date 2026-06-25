# Release Notes Lane Copy Design

HiveMatrix release notes are user-visible in two places:

- `src/lib/version/changelog.ts`, returned by `GET /releases` and rendered in Settings Release notes.
- `CHANGELOG.md`, the repo/GitHub-facing generated copy.

The rest of the product is moving to lane names, but older release-note entries still say `VoiceBee` and `MailBee`. Because these notes are browsable from the app, they are not merely historical internals; they can keep teaching the old voice-hostile names.

## Decision

Update release-note prose to use lane names while preserving version/date history:

- `VoiceBee` -> `Voice Lane`
- `MailBee` -> `Mail Lane`

Do not alter version numbers, dates, or release ordering.

## Acceptance Criteria

1. `src/lib/version/changelog.ts` contains no `VoiceBee` or `MailBee`.
2. `CHANGELOG.md` contains no `VoiceBee` or `MailBee`.
3. Replacement copy includes `Voice Lane` and `Mail Lane`.
4. Tests lock both files so future release-note copy uses lane names.
