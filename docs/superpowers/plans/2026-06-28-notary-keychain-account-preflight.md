# Notary Keychain Account Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-28-notary-keychain-account-preflight-design.md`

- [x] RED: Update `scripts/notary-identity.test.mjs` to require exact Keychain service/account checks in `scripts/release.mjs`, `scripts/setup-notary.sh`, and `scripts/autodeploy-main.sh`.
- [x] GREEN: Update `scripts/release.mjs` to check `security find-generic-password -s com.apple.gke.notary.tool -a com.apple.gke.notary.tool.saved-creds.hivematrix` before the notarytool profile validation.
- [x] GREEN: Update `scripts/setup-notary.sh` and `scripts/autodeploy-main.sh` so operator-facing output names the exact profile/service/account.
- [x] VERIFY: Run focused tests, `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs`.
