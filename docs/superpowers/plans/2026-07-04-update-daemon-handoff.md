# Update Daemon Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] RED: Add `src/lib/updater/feed-check.test.ts` coverage for a stale apply marker where the daemon still reports an older current version and the same latest version remains available; assert status exposes a daemon-restart/repair-needed state instead of only generic `applying`.
- [x] RED: Add tests for a pure daemon-owner classifier: known HiveMatrix source daemon commands are replaceable, bundled daemon commands are replaceable only when stale, and unknown port owners are not replaceable.
- [x] GREEN: Update `src/lib/updater/feed-check.ts` to classify stale apply markers and return an explicit `needsDaemonRestart`/detail field for the UI and About panel.
- [x] GREEN: Add a small daemon handoff helper with pure command classification plus side-effect wrappers for launchd bootstrap/kickstart and safe stale-process termination.
- [x] GREEN: Wire the Tauri updater post-install path to use the handoff helper: bootstrap if needed, evict known stale source daemon if needed, start/kickstart bundled daemon, and verify `/health.version === app.package_info().version`.
- [x] REFACTOR: Keep process-kill behavior narrowly scoped and logged; do not kill arbitrary `:3747` owners.
- [x] Verify focused tests, then `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
