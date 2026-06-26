# Browser Lane App Icon Design

Date: 2026-06-25

## Context

Browser Lane is now a separate macOS app, installed at `/Applications/Browser Lane.app`, but it does not have a themed app icon. macOS currently falls back to generic/default app presentation, which makes Browser Lane feel detached from HiveMatrix.

HiveMatrix already has a deterministic icon system under `assets/icon/`:

- dark green rounded-square/squircle tile
- bright green matrix accent
- hex/flower geometry
- transparent macOS margins so the icon does not render too large in Dock/Finder

## Decision

Create a Browser Lane icon that stays on theme:

- Same dark green HiveMatrix squircle/tile language.
- Same green accent family.
- Distinct Browser Lane signal: a browser-window frame plus a flowing lane/path and a small hex node.
- Reproducible from source, not a one-off opaque generated image.
- Packaged as `BrowserLane.icns` inside `browser-lane-app/Resources`.
- Declared through `CFBundleIconFile` in Browser Lane's `Info.plist`.
- Also ship `BrowserLaneWhite.icns` as a white icon state that matches HiveMatrix's white alternate icon posture.

Add a native Settings screen so icon state and app-level customization have a home:

- Icon state: dark green / white.
- Browser customization: default/start URL.
- Daemon connection: local daemon URL and token path metadata.
- Storage information: local site metadata and Keychain service names.
- About: app name, bundle id, version/build when present.

The default Finder bundle icon remains `BrowserLane.icns`; macOS does not provide a simple iOS-style alternate app icon API for Finder. The selected icon state can be applied at runtime to the Dock/window app icon and persisted for future app launches.

## Non-Goals

- Do not change the primary HiveMatrix app icon.
- Do not add a new public brand mark unrelated to HiveMatrix.
- Do not use an external stock icon.
- Do not rely on runtime icon selection.

## Acceptance Criteria

- Browser Lane has a deterministic icon source and generated `.icns`.
- Browser Lane has deterministic dark and white icon states, both with transparent outside corners.
- The `.icns` is copied into the packaged app bundle.
- `Info.plist` declares `CFBundleIconFile`.
- Browser Lane has a Settings screen for icon state, browser default URL, daemon connection, storage/security, and About/version.
- Tests verify the icon exists, is non-empty, is wired through the packager, and the source uses HiveMatrix colors.
- `/Applications/Browser Lane.app` is rebuilt, Developer ID signed, notarized, stapled, Gatekeeper accepted, and launches with the icon metadata present.
