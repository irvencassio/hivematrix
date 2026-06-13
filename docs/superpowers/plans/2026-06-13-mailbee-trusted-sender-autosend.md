# MailBee Trusted Sender Auto-Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Update `src/lib/mailbee/contracts.test.ts` so a known sender without authenticated domain is trusted and `mayAutoSend` returns true.
- [x] Update `src/lib/mailbee/handoff.test.ts` so a known sender without authenticated domain creates a trusted, auto-send-eligible task.
- [x] Update `src/lib/mailbee/contracts.ts` trust logic and comments to trust explicit known senders while preserving suspicious overrides.
- [x] Run focused MailBee tests, then full verification gates.
- [x] Update `src/lib/mailbee/handoff.test.ts` so trusted descriptions treat non-risky attachments as readable trusted content.
- [x] Add `src/lib/mailbee/delivery.test.ts` for trusted completion send, skipped needs-input send, and non-trusted no-send.
- [x] Add `src/lib/mailbee/delivery.ts` and wire it into `src/lib/orchestrator/agent-manager.ts` after successful task completion.
- [x] Bump HiveMatrix to 0.1.16, run focused MailBee/orchestrator tests, then full verification gates.
