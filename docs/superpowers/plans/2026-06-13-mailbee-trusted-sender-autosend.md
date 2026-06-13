# MailBee Trusted Sender Auto-Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Update `src/lib/mailbee/contracts.test.ts` so a known sender without authenticated domain is trusted and `mayAutoSend` returns true.
- [x] Update `src/lib/mailbee/handoff.test.ts` so a known sender without authenticated domain creates a trusted, auto-send-eligible task.
- [x] Update `src/lib/mailbee/contracts.ts` trust logic and comments to trust explicit known senders while preserving suspicious overrides.
- [x] Run focused MailBee tests, then full verification gates.
