# Jarvis V2 Voice Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Task 1: Add pure context, ordinal, briefing, and auto-approval policy tests.
  - Files:
    - `src/lib/voice/command-intent.test.ts`
    - `src/lib/voice/command-context.test.ts`
    - `src/lib/voice/briefing.test.ts`
    - `src/lib/voice/auto-approval-policy.test.ts`
  - Failing assertions first:
    - `"approve the second one"` detects `approve` with ordinal `2`.
    - `"good morning"` detects `briefing`.
    - A context with listed approvals resolves `"approve it"` to the focused item.
    - A briefing speaks pending approvals, failed tasks, active directives, and usage.
    - Auto-approval allows checkpoints only when explicitly enabled, and rejects content/external categories.

- [x] Task 2: Implement pure helpers.
  - Files:
    - `src/lib/voice/command-intent.ts`
    - `src/lib/voice/command-context.ts`
    - `src/lib/voice/briefing.ts`
    - `src/lib/voice/auto-approval-policy.ts`
  - Required behavior:
    - Parse ordinal words/numbers for approval resolution.
    - Parse `briefing`, `usage`, `analytics`, `retry failed task`, `set task model`, `start/pause directive`, and `trigger release verification` intents.
    - Keep all reply builders pure and deterministic.
    - Store only a short rolling context in memory.

- [x] Task 3: Wire Jarvis V2 actions in `command-turn.ts`.
  - Files:
    - `src/lib/voice/command-turn.ts`
    - `src/lib/voice/command-turn.test.ts`
  - Failing test first:
    - Multiple approvals without context asks for disambiguation.
    - Approval after an approval-list turn resolves the focused item via `via="voice"`.
    - Usage/briefing returns spoken summaries.
    - Retry/model/directive/release commands perform the expected injected action.

- [x] Task 4: Add settings persistence and auto-approval integration.
  - Files:
    - `src/lib/voice/auto-approval-policy.ts`
    - `src/lib/orchestrator/approval.ts`
    - `src/lib/approvals/queue.ts`
    - `src/daemon/server.ts`
    - matching tests
  - Failing test first:
    - Policy defaults to off.
    - Policy auto-approves checkpoint requests only when enabled.
    - Content and outward-facing gates are never silently auto-approved.

- [x] Task 5: Promote voice affordance on iOS.
  - Files:
    - `/Users/irvencassio/hivematrix-ios/HiveMatrix/Views/RootView.swift`
    - `/Users/irvencassio/hivematrix-ios/HiveMatrix/Views/VoiceTalkView.swift`
  - Failing/build check:
    - Add source-level or compile-time verification by building the iOS simulator target.
  - Behavior:
    - Show a disabled voice affordance when Voice is off, with an accessible hint
      to enable Voice on the Mac.

- [x] Task 6: Verification and finish.
  - Run:
    - `npm run typecheck`
    - `npm test`
    - `node scripts/scope-wall.mjs`
    - `npx tsx scripts/qwen-readiness.mts` when the local model server is available
    - `xcodebuild -project /Users/irvencassio/hivematrix-ios/HiveMatrix.xcodeproj -scheme HiveMatrix -destination 'generic/platform=iOS Simulator' build`
  - Review diff for scope, safety, and roadmap coverage.
