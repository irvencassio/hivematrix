# Desktop Artifact Lane Copy Design

Most Desktop Lane task descriptions and proof output already use lane wording, but the desktop trace path still leaks the old public name in two places:

- `writeVisionTrace` registers artifacts titled `DesktopBee action trace: ...`.
- Desktop helper launchd/Swift comments still describe the helper as `DesktopBee`.

The artifact title is user-visible in task artifacts. The comments are not runtime UI, but they are active operator/developer guidance for the helper and launchd template, so they should teach the current lane naming strategy.

## Decision

Update visible and guidance copy to `Desktop Lane` while preserving compatibility identifiers:

- Artifact title: `Desktop Lane action trace: ...`
- Launchd/template comments: `Desktop Lane helper`
- Swift comments: `Desktop Lane helper`, `Desktop Lane action contract`, `Desktop Lane needs permission`

## Compatibility Boundaries

Do not rename:

- `desktopbee-trace-*.json`
- `desktopbee-trace` artifact stem
- `DesktopBeeHelper` executable/package names
- `DESKTOPBEE_PORT`
- TypeScript/Swift API symbols such as `DesktopBeeRequest`

## Acceptance Criteria

1. `writeVisionTrace` stores artifact titles with `Desktop Lane action trace`.
2. `src/lib/desktopbee/trace.ts` no longer contains the public title `DesktopBee action trace`.
3. Active helper comments use `Desktop Lane` wording.
4. Compatibility names remain unchanged.
