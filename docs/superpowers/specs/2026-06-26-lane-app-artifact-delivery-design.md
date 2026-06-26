# Lane App Artifact Delivery — Design

Date: 2026-06-26

## Problem

HiveMatrix 0.1.88 shipped the Lane Apps manager, but the manager still treats
lane app artifacts as dev-checkout build outputs. In the packaged daemon this is
not reliable:

- `artifactPathFor()` uses `import.meta.url`; esbuild bundles the daemon as CJS,
  so `import.meta` becomes empty.
- `src-tauri/tauri.conf.json` does not bundle `build/browser-lane/Browser Lane.app`
  or `build/terminal-lane/Terminal Lane.app`, so another Mac cannot install the
  lane apps from HiveMatrix after auto-update.

## Decision

HiveMatrix auto-update still only installs HiveMatrix itself. It should,
however, **deliver** signed Browser Lane and Terminal Lane artifacts inside
`HiveMatrix.app/Contents/Resources/lane-apps/`. The operator then installs or
updates each lane app explicitly from Settings -> Lanes.

Runtime artifact lookup should be:

1. Packaged app resource:
   `.../HiveMatrix.app/Contents/Resources/lane-apps/<App>.app`
2. Dev checkout fallback:
   `<repo>/build/<lane>/<App>.app`
3. Pinned expected version fallback when neither artifact exists.

No silent installs. No sudo. No automatic `/Applications` replacement.

## Implementation

- `src-tauri/tauri.conf.json`: add both lane app bundles as resources under
  `lane-apps/`.
- `scripts/build-app.sh`: package both lane apps before `cargo tauri build`, then
  sign their source bundles before Tauri copies them into the app.
- `src/lib/lane-apps/index.ts`: remove `import.meta.url` from artifact lookup.
  Resolve packaged resources from `process.execPath`; resolve dev artifacts from
  `process.cwd()`.
- Tests:
  - artifact candidates prefer packaged resources.
  - source/bundled daemon does not depend on `import.meta.url`.
  - Tauri resources and build script include both lane apps.

## Acceptance

- `node scripts/package-browser-lane-app.mjs`
- `node scripts/package-terminal-lane-app.mjs`
- focused lane app tests
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
- `npm run verify:portal`
- Release a new desktop version after the fix so auto-update delivers the
  corrected manager and resources.
