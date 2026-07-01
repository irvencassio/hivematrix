# Voice Scheduled Reminders Design

Date: 2026-06-30
Status: Approved for implementation

## Problem

Voice requests such as "remind me at 5:35 PM to go look up something" are not handled as a first-class HiveMatrix command. They can fall through to generic autonomous task execution, where an agent tries unavailable remote scheduling tools and sits in progress.

## Goals

- Detect explicit time-based reminder utterances before generic task creation.
- Create a delayed HiveMatrix task with `delayUntil` instead of spawning an agent immediately.
- Keep the operator-facing reply immediate and honest.
- Preserve the existing generic "remind me to ..." task behavior when no time is given.
- Add tests so future voice changes do not regress into generic agent scheduling attempts.

## Non-Goals

- Do not add Apple Reminders, Calendar, SMS, email, or external notification delivery.
- Do not require Claude Remote trigger tools.
- Do not redesign Scheduled items or Directive execution.
- Do not change weather, Browser Lane, Mail Lane, or release verification voice commands.

## Recommended Design

Add a new deterministic voice command intent, `scheduledReminder`, for utterances shaped like:

```text
remind me at 5:35 PM to go look up something
remind me at 2pm video bible idea
```

`commandTurnOverride` should turn that intent into a task:

```ts
{
  title: "Reminder: go look up something",
  description: "Voice reminder scheduled for ...",
  project: "inbox",
  projectPath: homedir(),
  status: "backlog",
  executor: "agent",
  source: "voice",
  delayUntil: targetIso,
  output: { voiceReminder: { text, whenText, runAt: targetIso } }
}
```

The scheduler already ignores future `delayUntil` values and claims the task when the time arrives. This gives HiveMatrix native delayed work without letting a headless agent improvise with unavailable MCP trigger APIs.

## Date Handling

Interpret the spoken time in the local machine timezone. If the parsed time has already passed today, schedule it for tomorrow. Keep parsing intentionally narrow for this slice: hour, optional minutes, optional AM/PM.

## Tests

- Intent detection returns `scheduledReminder` for time-specific reminder wording.
- The command path creates exactly one delayed task with `delayUntil`.
- The delayed reminder does not create an immediate generic task body that asks an agent to schedule a reminder.

## Verification

- `node --import tsx/esm --test src/lib/voice/command-intent.test.ts src/lib/voice/command-turn.test.ts`
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
