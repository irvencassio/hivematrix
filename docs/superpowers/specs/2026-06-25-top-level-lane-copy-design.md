# Top-Level Lane Copy Design

HiveMatrix has already moved the Settings surface, model-facing prompts, daemon runtime copy, onboarding API copy, operator docs, and service/build output toward lane names. The remaining high-signal public entry points still expose old capability brands:

- `README.md` presents DesktopBee as the desktop-control capability.
- `ONBOARDING.md` uses `DesktopBee` as the section title and proof surface.
- `src-tauri/Info.plist` says microphone access is for VoiceBee.
- `desktopbee-helper/Resources/Info.plist` displays the helper as HiveMatrix DesktopBee Helper.
- `voice-sidecar/*` and `video/package.json` still describe VoiceBee as the product name.

## Decision

Update these top-level and packaged human-facing strings to lane wording:

- `DesktopBee` public capability copy -> `Desktop Lane`
- `DesktopBee helper` public helper copy -> `Desktop Lane helper`
- `VoiceBee` public voice copy -> `Voice Lane`

## Compatibility Boundaries

Do not rename the compatibility artifacts in this slice:

- `desktopbee-helper/`
- `DesktopBeeHelper.app`
- `DesktopBeeHelper` executable / `CFBundleName`
- `com.hivematrix.desktopbee.helper`
- `scripts/desktopbee-proof.mts`

Those can be handled later with a deeper compatibility plan if needed. For now, docs can mention `DesktopBeeHelper.app` only as the legacy bundle/file name after introducing it as the Desktop Lane helper.

## Acceptance Criteria

1. README top-level copy says `Desktop Lane` and no longer contains capitalized `DesktopBee`.
2. Onboarding names the setup section `Desktop Lane` and describes `DesktopBeeHelper.app` as a compatibility bundle name.
3. macOS permission descriptions say `Voice Lane` and `Desktop Lane`.
4. Voice sidecar CLI/docs/package copy says `Voice Lane` instead of `VoiceBee`.
5. Existing compatibility file names, executable names, and bundle identifiers remain unchanged.
