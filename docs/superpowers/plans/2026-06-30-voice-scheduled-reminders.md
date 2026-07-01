# Voice Scheduled Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- [x] Add failing intent test in `src/lib/voice/command-intent.test.ts`.
  - Assert `"remind me at 5:35 PM to go look up something"` returns kind `scheduledReminder`, `reminderWhenText`, and `reminderText`.
  - Assert `"remind me at 2pm video bible idea"` is also parsed as `scheduledReminder`.

- [x] Add failing command test in `src/lib/voice/command-turn.test.ts`.
  - Inject a fixed `now` value and fake `createTask`.
  - Assert one task is created with `status: "backlog"`, `source: "voice"`, and a future `delayUntil`.
  - Assert the description identifies this as a direct Voice Lane delayed reminder.

- [x] Implement intent parsing in `src/lib/voice/command-intent.ts`.
  - Add command kind `scheduledReminder`.
  - Add `reminderText` and `reminderWhenText` fields to `CommandIntent`.
  - Match time-based reminder patterns before the generic `createTask` fallback.

- [x] Implement command execution in `src/lib/voice/command-turn.ts`.
  - Add optional `now?: Date` to `CommandTurnDeps`.
  - Parse local time text into a target `Date`.
  - Create a delayed task using `delayUntil`.
  - Return an immediate spoken reply that the reminder was scheduled.

- [x] Run targeted tests.
  - `node --import tsx/esm --test src/lib/voice/command-intent.test.ts src/lib/voice/command-turn.test.ts`

- [x] Run repository gates.
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
