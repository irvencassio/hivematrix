# Vale Voice to OpenClaw Return Path Design

Date: 2026-07-01
Status: Ready for implementation
Owner: Irv

## Summary

HiveMatrix voice should be able to route a spoken turn to Vale/OpenClaw and then read Vale's answer back through the existing Talk voice interface.

The operator-facing phrases are:

```text
ask Vale to summarize today's email
hey Vale, summarize today's email
ask OpenClaw to summarize today's email
hey OpenClaw, summarize today's email
```

When the OpenClaw Chat Dock feature is enabled, the desktop HiveMatrix console should also show an OpenClaw chat dock. The current screenshot evidence shows the feature enabled in Settings but no visible dock in the console, so this slice must include a dock visibility/status fix and diagnostics.

## Evidence

- `/Users/irvencassio/Screenshots/Screenshot 2026-06-30 at 9.31.43 PM.png`: Settings -> Features shows "OpenClaw Chat Dock" enabled.
- `/Users/irvencassio/Screenshots/Screenshot 2026-06-30 at 9.31.50 PM.png`: Main HiveMatrix console shows no visible OpenClaw dock at the bottom or in the main content area.

The dock may be hidden because `/openclaw/status` reports `enabled:false`, because `initOpenclawDock()` fails and hides the dock, because the dock is collapsed too quietly, or because CSS/layout keeps the dock outside the visible console area. The implementation should verify the live API response and DOM state instead of guessing.

## Goals

- Add deterministic voice routing for `ask Vale`, `hey Vale`, `ask OpenClaw`, and `hey OpenClaw`.
- Send the stripped user request to OpenClaw through the existing daemon-side bridge.
- Return Vale/OpenClaw's answer through the existing HiveMatrix voice playback path.
- Use the existing iOS/desktop Talk contract where possible: text reply plus `audioBase64`, and async `voice:result` for late results.
- Keep OpenClaw credentials server-side; never expose Gateway tokens or secrets to browser code or HiveMatrix-iOS.
- Fix the enabled-but-invisible OpenClaw Chat Dock behavior.
- Add enough tests and UI diagnostics that a future enabled-but-hidden state is obvious.

## Non-Goals

- Do not embed the full OpenClaw Control UI.
- Do not make OpenClaw the default voice backend for every spoken turn.
- Do not replace HiveMatrix Mail Lane, Browser Lane, or task routing.
- Do not send or delete email automatically as part of this slice.
- Do not add a native iOS OpenClaw chat screen. Voice return through Talk is enough.
- Do not expose OpenClaw session secrets, auth tokens, or raw config values.

## Voice Routing Design

Add a deterministic OpenClaw voice intent before generic task creation and before sidecar escalation creates a generic task.

Suggested intent:

```ts
type CommandKind = ... | "openclawAsk";

interface CommandIntent {
  kind: CommandKind;
  openclaw?: {
    assistant: "vale" | "openclaw";
    prompt: string;
    sessionKey: string;
  };
}
```

Detection should match:

- `ask Vale ...`
- `ask Vale to ...`
- `hey Vale ...`
- `hey Vale, ...`
- `ask OpenClaw ...`
- `hey OpenClaw ...`

The prompt sent to OpenClaw should remove the wake/routing phrase:

```text
ask Vale to summarize today's email
```

becomes:

```text
summarize today's email
```

Default OpenClaw session:

```text
agent:main:main
```

If the existing dock/session preference has a better selected session, the implementation can use it later, but the first version should be deterministic and tested with `agent:main:main`.

## Return Path

There are two acceptable return modes.

1. Synchronous, only if OpenClaw can provide the final assistant text within the normal voice turn budget.
   - `/voice/turn` returns `{ transcript, reply, audioBase64 }`.
   - The iOS Talk screen plays the reply immediately.

2. Async, recommended for email and other slower work.
   - `/voice/turn` replies immediately: `I asked Vale. I'll read it back when it's ready.`
   - HiveMatrix tracks the OpenClaw run/session.
   - When the assistant response is available, HiveMatrix synthesizes it with `synthesizeLiveVoice()` and broadcasts:

```ts
broadcast("voice:result", {
  taskId,
  sessionId,
  text,
  audioBase64,
  ok: true
});
```

The async mode fits "summarize today's email" because email/browser work can take longer than a live push-to-talk request.

## OpenClaw Bridge Requirements

Use the existing daemon bridge surfaces:

- `GET /openclaw/status`
- `POST /openclaw/chat/send`
- `GET /openclaw/chat/history`

If `POST /openclaw/chat/send` only returns a `runId`, add a small server-side waiter/poller that watches `chat.history` for the next assistant message after the user message. Keep the polling bounded.

Suggested bounded wait:

- Initial immediate poll after send.
- Poll every 1 second.
- Stop after 30 seconds for the synchronous path.
- If not complete by then, keep an async tracker or create a voice-originated HiveMatrix task whose completion goes through `voice:result`.

The bridge should return structured unavailable messages:

- OpenClaw Chat Dock feature disabled.
- OpenClaw not installed.
- OpenClaw Gateway unreachable.
- OpenClaw send failed.
- OpenClaw response timed out.

## Mail Summary Prompting

When the user asks Vale to summarize email, HiveMatrix should not itself claim email access. It should pass the user's request to OpenClaw/Vale with a small, explicit routing preface only when useful:

```text
The operator asked by voice through HiveMatrix. Answer concisely because the response may be spoken aloud. If you need email access, use the available OpenClaw/HiveMatrix lane tools or browser workflow rather than asking the operator to manually summarize. Request: summarize today's email
```

Keep the spoken result concise. If Vale returns a long answer, cap the spoken text and leave the full answer visible in the OpenClaw chat dock.

## Dock Visibility Fix

The OpenClaw Chat Dock is already expected to exist in `src/daemon/console.ts` as `#openclawDock`, initialized by `initOpenclawDock()`.

Required behavior:

- If `openclaw.chatDock` is enabled and `/openclaw/status` reports `enabled:true`, the dock must be visible in the console.
- If OpenClaw is unavailable, show a compact unavailable dock with the reason. Do not silently hide the dock when the operator explicitly enabled the feature.
- If `/openclaw/status` throws, show an error dock with "Could not check OpenClaw status" and a refresh button.
- Collapsed state must still leave a visible strip labeled "OpenClaw" or "Vale".
- The dock must not be hidden behind the right settings/usage panel or below the viewport with no affordance.
- On narrow viewports where the dock intentionally hides, Settings should say that the dock is hidden on narrow screens.

Recommended diagnostics:

- Add a small status line in Settings -> Features for OpenClaw:
  - feature flag enabled/off
  - installed true/false
  - gateway reachable true/false
  - dock visible true/false when the console is open
- Add console tests for the enabled-but-unavailable and enabled-but-status-error states.

## Review Task Ordering Fix

The console task lists should sort review tasks with the most current item at the top and the oldest item at the bottom.

Current evidence from the operator report: tasks in `review` are still not sorted correctly. The implementation should inspect the task list rendering/sorting code instead of relying on the backend's incidental order.

Required behavior:

- The `review` section sorts by the best available recency timestamp descending.
- Prefer an explicit task update/completion/review timestamp if one exists.
- Fall back to `updatedAt`, then `createdAt`, then any existing age/id fallback used by the console.
- Do not reverse other sections unless their current behavior is also demonstrably wrong.
- Add a regression test that seeds review tasks with mixed timestamps and asserts newest first, oldest last.

## Implementation Surfaces

Likely files:

- `src/lib/voice/command-intent.ts`
- `src/lib/voice/command-turn.ts`
- `src/lib/voice/command-turn.test.ts`
- `src/lib/voice/logic-scenarios.ts`
- `src/lib/openclaw/bridge.ts`
- `src/lib/openclaw/bridge.test.ts`
- `src/daemon/server.ts`
- `src/daemon/openclaw-routes.test.ts`
- `src/daemon/console.ts`
- `src/daemon/console.test.ts`
- `src/lib/voice/voice-result-loop.ts` if the async return path reuses voice task delivery.

HiveMatrix-iOS should not need a new screen for this slice. It already posts text/audio to `/voice/turn` and listens for `voice:result` while Talk is open.

## Acceptance Criteria

- Saying `ask Vale to summarize today's email` routes one prompt to OpenClaw with `summarize today's email`.
- Saying `hey Vale, summarize today's email` behaves the same.
- Saying `ask OpenClaw to summarize today's email` behaves the same.
- The immediate spoken reply is honest: either Vale's answer, or `I asked Vale. I'll read it back when it's ready.`
- A late Vale answer is delivered to the open Talk surface through `voice:result` and is spoken.
- If OpenClaw is unavailable, the voice reply says why and does not create an unrelated generic task.
- No OpenClaw tokens, secrets, or raw auth config reach browser JavaScript, iOS JSON, logs, or tests.
- When the OpenClaw Chat Dock feature is enabled, a visible dock or visible unavailable-state strip appears in the HiveMatrix console.
- The dock is not silently hidden on status errors.
- Tests cover intent detection, prompt stripping, unavailable OpenClaw behavior, and dock visibility states.
- Review tasks are sorted newest first and oldest last in the console review section.

## Verification

Focused gates:

```bash
node --import tsx/esm --test src/lib/voice/command-intent.test.ts src/lib/voice/command-turn.test.ts
node --import tsx/esm --test src/lib/openclaw/bridge.test.ts src/daemon/openclaw-routes.test.ts src/daemon/console.test.ts
npm run typecheck
node scripts/scope-wall.mjs
```

Manual checks:

```bash
curl -s http://127.0.0.1:3747/openclaw/status
```

with normal HiveMatrix auth if required, then verify:

- Settings says OpenClaw Chat Dock is enabled.
- Console shows the OpenClaw/Vale dock or an unavailable reason.
- Voice phrase `hey Vale, summarize today's email` returns an immediate acknowledgement.
- When Vale's response arrives, the open Talk screen speaks it.

## Implementation Prompt

Implement the Vale/OpenClaw voice bridge and the OpenClaw dock visibility fix described in `docs/superpowers/specs/2026-07-01-vale-voice-openclaw-return-path-design.md`.

Start by verifying the live `/openclaw/status` response and the `#openclawDock` DOM/display state because screenshots from 2026-06-30 show the feature enabled in Settings but no visible dock in the console. Do not guess from Settings alone.

Add deterministic voice intent handling for `ask Vale`, `hey Vale`, `ask OpenClaw`, and `hey OpenClaw`. Strip the wake phrase, send the remaining request to OpenClaw through the daemon-side bridge, and return the answer through the existing Talk voice path. Prefer an async return for slow requests: acknowledge immediately, then synthesize and broadcast the final answer through `voice:result`.

Fix the dock so enabling the feature never results in a silent invisible state. If OpenClaw is unavailable or status probing fails, show a compact visible dock strip/panel with the reason and a refresh/settings affordance.

Also fix the console task ordering bug where tasks in `review` are not sorted correctly. The `review` section must show the most current task at the top and the oldest task at the bottom, using the best available recency timestamp and a regression test.

Keep OpenClaw secrets server-side. Add focused tests for intent detection, prompt stripping, OpenClaw unavailable replies, bridge polling or async delivery, and console dock visibility/error states. Run the focused voice/OpenClaw/console tests, then `npm run typecheck` and `node scripts/scope-wall.mjs`.
