---
name: release-hivematrix
description: >-
  Deterministically release HiveMatrix — bump version, build signed app + DMG,
  notarize with Apple, publish update feed, verify. Uses the canonical
  scripts/developer-id-release.sh under the hood.
argument-hint: --release [--marketing-version X.Y.Z] [--note "text"] | --verify-only | --build-only [--skip-notarize]
options: |
  --release                  (mode) Full: bump → build → notarize → staple → publish → verify
  --verify-only              (mode) Gates + prereqs only; no build, no publish
  --build-only               (mode) Local signed build (notarized); no publish/commit
  --marketing-version=X.Y.Z  Set the marketing version (else auto patch-bump on --release)
  --skip-notarize            Local dry run only; refused with --release
  --note=text                Release note (changelog + commit message)
---

# HiveMatrix Release

Deterministically release HiveMatrix using the canonical script:

```bash
scripts/developer-id-release.sh --release                    # Full: bump→build→notarize→staple→publish→verify
scripts/developer-id-release.sh --verify-only                # Gates + prereqs only
scripts/developer-id-release.sh --build-only                 # Local signed build (notarized)
scripts/developer-id-release.sh --release --marketing-version 0.2.0 --note "Fix login bug"
```

This wraps `scripts/developer-id-release.sh`, the one canonical HiveMatrix macOS release command. Developer ID signing + Apple notarization for the public website DMG and external auto-update feed (NOT Mac App Store).

See `docs/agent-commands/developer-id-release.md` for full reference and setup.
