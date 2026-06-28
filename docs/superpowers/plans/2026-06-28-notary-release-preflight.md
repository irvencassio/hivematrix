# Notary Release Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add failing tests in `scripts/notary-identity.test.mjs` requiring `scripts/release.mjs` to validate `xcrun notarytool history` before the version bump and requiring `scripts/setup-notary.sh` to document the real notarytool Keychain service/account.

- [x] Update `scripts/release.mjs` so release preconditions validate `xcrun notarytool history --apple-id cassio.irv@gmail.com --team-id 8B3CHTY93V --keychain-profile hivematrix` before editing release files.

- [x] Update `scripts/setup-notary.sh` to display/document service `com.apple.gke.notary.tool` and account `com.apple.gke.notary.tool.saved-creds.hivematrix`, and validate with explicit Apple ID/team/profile arguments.

- [x] Verify with `node --test scripts/notary-identity.test.mjs` and a live `xcrun notarytool history --apple-id cassio.irv@gmail.com --team-id 8B3CHTY93V --keychain-profile hivematrix` check.
