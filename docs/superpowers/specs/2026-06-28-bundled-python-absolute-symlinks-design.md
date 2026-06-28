# Bundled Python Absolute Symlinks Design

## Problem

Updating the local installed HiveMatrix daemon bundle from `dist/daemon` revealed that `python-build-standalone` leaves several absolute symlinks in the staged Python tree, such as `python/bin/idle3` and `python/lib/pkgconfig/python3.pc`. Inside a signed macOS app bundle, absolute symlinks back into the repo cache make `codesign --verify --deep --strict` report invalid bundle resources.

`scripts/build-daemon.mjs` already replaces the `python` and `python3` interpreter symlinks with real files, but it does not handle every absolute symlink in the bundled Python tree.

## Approach

After copying the standalone Python runtime into `dist/daemon/python`, walk that tree and replace any absolute symlink with a real copy of its target. Keep relative symlinks untouched.

This keeps future local installs and official builds sealable by codesign without depending on the developer cache path.

## Acceptance

- `scripts/build-daemon.mjs` contains a helper that replaces absolute symlinks.
- The helper runs on `dist/daemon/python` before signing/build packaging.
- Focused source test guards the behavior.
- Gates pass.
