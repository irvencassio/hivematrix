# Notary Keychain Name Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] RED: Update `scripts/notary-identity.test.mjs` to expect `keychainName`, both `security find-generic-password -s "$KEYCHAIN_NAME" -a "$KEYCHAIN_ACCOUNT"` and `security find-generic-password -l "$KEYCHAIN_NAME" -a "$KEYCHAIN_ACCOUNT"`, and autodeploy banner `Name`.
- [x] GREEN: Update `scripts/release.mjs` to use `notaryKeychainName` and both name lookup forms, with error text using `name` and `account`.
- [x] GREEN: Update `scripts/setup-notary.sh` comments, variables, output, and validation command to use `KEYCHAIN_NAME` and both name lookup forms.
- [x] GREEN: Update `scripts/autodeploy-main.sh` banner to print `Name`.
- [x] GREEN: Pin `scripts/setup-notary.sh`, `scripts/release.mjs`, `scripts/build-app.sh`, and `scripts/build-dmg.sh` to `~/Library/Keychains/login.keychain-db`.
- [x] Verify: run `node --import tsx/esm --test scripts/notary-identity.test.mjs`.
