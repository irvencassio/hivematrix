# Claude Usage Left Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add failing tests in `src/lib/usage/subscription.test.ts` for:
  - Expired access token plus refresh token refreshes, persists, then returns usage windows.
  - Missing credentials returns null usage with a non-secret status reason.
- [x] Refactor `src/lib/usage/subscription.ts`:
  - Read Claude Code credentials into a typed envelope.
  - Refresh expired/nearly expired OAuth tokens with Claude Code's public OAuth client id.
  - Persist refreshed credentials with `security add-generic-password -U`.
  - Return detailed status alongside usage.
- [x] Update `src/lib/usage/frontier-usage.ts` to include `subscriptionStatus` while preserving `subscription`.
- [x] Update `src/daemon/console.ts` to show a useful status line when subscription usage is unavailable, without disturbing the existing Safe Senders work in the dirty file.
- [x] Verify with targeted tests first, then the repository gates.
