# Improvements — 2026-07-17 (harness speed · persona · mobile autonomy)

Branch: `improve/harness-speed-persona-mobile-2026-07-17`
Verification: `npm run typecheck` clean · `npm test` 3096 pass / 0 fail · `node scripts/scope-wall.mjs` 0 violations.
No commit / push / release performed — working tree only, for review.

Prompted by: "Claude Code generation seems slow and limiting vs. using Claude Code
directly; improve the UX, the goal to be autonomous, and the personality / human
interface side." This branch ships six surgical, tested changes and leaves a
recommendations list for the items that are operator-decisions or need
Swift/live verification.

## Shipped (verified)

### 1. Claude Code generation is faster & less blocking — `src/lib/orchestrator/approval.ts`
The `claude -p` worker path gated **every** tool call through a per-task bash
hook. Three fixes, no change to the safety floor (release/deploy/destructive
still always gated):
- **Narrowed the PreToolUse matcher** `.*` → `Bash|mcp__.*`. Read/Edit/Write/
  Grep/Glob/Agent/etc. were always auto-allowed anyway, so the hook was spawning
  a bash process per call just to `exit 0`. Now the dominant tool calls skip the
  hook entirely.
- **Live-read the autonomy dial** inside the MCP branch (was baked at spawn
  time). Flipping to `autonomous` to unblock a long-running agent now takes
  effect on its next tool call, not only on the next task.
- **0.2s approval poll** (was 1s), so an agent resumes near-instantly after you
  approve. Same 30-min timeout.
- Cheaper ssh-diagnostics path (only reads config.json for ssh tools).

### 2. Flash sounds like a partner, consistently across surfaces — `src/lib/flash/context.ts`
- **Always-on voice doctrine**: warm, direct, addresses the operator by name,
  cuts corporate filler, admits uncertainty plainly. Previously the built prompt
  had *only* capability-routing mechanics — all tone was delegated to a
  self-authored SOUL.md that steers toward purpose, not personality. The doctrine
  explicitly defers to SOUL/IDENTITY when defined, so a rich persona still wins.
- **Per-surface format**: iMessage gets a plain-text texting register, mail gets
  an email register. Before, only voice/watch/glasses had a style branch, so
  markdown headers/bullets leaked as literal `#`/`*`/`-` into text bubbles.

### 3. Approvals reach your pocket even when the app is closed — `src/lib/notify/notify-loop.ts`
The escalation tick pushed new pending approvals/stuck tasks only to Telegram/
iMessage/email — never to native devices. Now it also calls `sendPush()`
(APNs/FCM) with a `data.kind`/`taskId`/`timestamp` deep-link payload, using the
same dedup so each item pings once. Best-effort: a push transport error never
breaks the existing escalation.
> Companion (Swift, not in this branch — see recommendations): iOS needs a
> `UNUserNotificationCenterDelegate` to deep-link on tap + Approve/Deny
> notification actions; the Watch already has the approval API wired but no UI.

### 4. The heartbeat stops nagging about things you already handled — `src/lib/flash/heartbeat.ts`
The proactive pulse ran in its own session and could only see its own past
reports — blind to what you just discussed in the console/voice thread. It now
folds a compact digest of your recent live turns into the pulse prompt with an
explicit "do not re-surface anything already handled here" rule. This is the
single biggest lever against false-positive proactivity.

### 5. Per-task Effort control + Cmd/Ctrl+Enter — `src/daemon/console.ts`, `src/daemon/server.ts`
The backend supported a per-task `thinkingMode`, but the UI hid it entirely, so
every task ran at the global `max`-effort default (a real slowness source for
simple work). New Task now has an **Effort** selector (Auto/High/Medium/Low)
that threads through as `thinkingMode`; the server validates it defensively. The
description box also submits on **Cmd/Ctrl+Enter**.

### 6. Flash learns how *you* like to be talked to — `src/lib/flash/distill.ts`
Extended the existing `operator_facts` distillation (already written to
USER.md, already surfaced every turn) to explicitly capture communication-style
preferences — brevity, formality, how you want to be addressed, tone
corrections. Makes the always-on voice doctrine (#2) adapt to you over time.
Reuses the existing primitive rather than adding a new store/section (complexity
budget).

## Round 2 (2026-07-18) — operator reviewed the held items; decisions applied

Shipped after review (all verified, full suite green):

- **Message Lane repaired** (`messagebee/imessage.ts`). Two failures hid behind one
  opaque string. 2026-07-15: ~20 sends failed `-1719` ("Can't get account 1 whose
  service type = iMessage") — the account list intermittently enumerates EMPTY
  while iMessage is signed in and sending fine; added a chat-id recovery path
  (`any;-;+1555…`, the macOS 26 service-agnostic prefix, verified against
  chat.db), keeping account/participant PRIMARY since it is proven and also
  covers brand-new recipients. 2026-07-18: sends TIMED OUT with empty stderr
  after the 0.1.214 update re-triggered the Automation (TCC) consent prompt,
  unanswered overnight. `formatSendFailure()` now separates timeout from script
  error and keeps stderr/stdout/exit code. Verified end-to-end: AppleScript
  compiles (`osacompile`), and a real message was delivered.
- **Effort default is adaptive** (`config/budget-policy.ts`). "auto" no longer
  collapses to "max"; `--effort` is omitted so the CLI picks depth per turn, as
  in a direct session. Explicit tiers still honored; junk stays conservative.
- **One morning voice** (`flash/heartbeat.ts`). The persona moment folds
  `composeDayBrief`'s facts into its snapshot; the deterministic ritual
  suppresses its own send when a moment covers that part of day (runtime check,
  so an existing config can't double-send).
- **Harness prompt trimmed + measured** (`orchestrator/`). The delegation
  directive is gated on `workflow === "work"` so narrow tasks stop being pushed
  into subagent round-trips; `lastRunTtftMs`/`lastRunDurationMs` are now
  persisted so prompt-overhead work can actually be judged.
- **`git push` left auto-allowed** by operator decision (gating it would deadlock
  unattended overnight runs).

### Still open (operator approved, not yet built)

1. **Console token streaming** — approved approach: build it and verify against an
   ISOLATED throwaway daemon (temp HOME/DB, alt port), never the live one.
   Touches `daemon/server.ts` `/events` (carry transcript deltas in the payload)
   and `daemon/console.ts` (`refresh`/`selectTask` → append-only rendering
   instead of full `innerHTML` rebuild). Large change to a 10k-line inline
   script; `console.test.ts` parses the whole script for syntax, which is the
   safety net.
2. **iOS + Watch** — approved to build AND release (operator confirmed no manual
   step needed; the Watch app lives INSIDE `hivematrix-ios`, not the deprecated
   standalone repo). iOS: `UNUserNotificationCenterDelegate` (`willPresent` +
   `didReceive`) to deep-link into Approvals, plus Approve/Deny notification
   actions calling the existing `resolveApproval`. Watch: an approvals list
   (`APIClient.swift` already exposes `pendingApprovals`/`resolveApproval`,
   unused) and a live complication showing pending count. Ships via App Store
   Connect (`release-hivematrix-ios` skill); note the build-number drift
   gotcha — bump above ASC's highest.

## Original recommendations (superseded above where applied)

Ranked by impact:

1. **Console token streaming (biggest perceived-speed win).** The console does
   no token streaming — SSE events are payload-less "something changed" pings
   that trigger a full re-poll + full `innerHTML` rebuild on a ≤5s cadence
   (`src/daemon/console.ts` `refresh`/`selectTask`; `src/daemon/server.ts`
   `/events`). So even though the agent streams, you see output in 5s chunks.
   Carrying transcript deltas in the SSE payload and appending them is a large
   but high-value change; it also removes the scroll/`_ctx*`/mermaid re-render
   gymnastics that exist only to survive the full rebuilds. Needs a running
   daemon to verify — not done here to avoid touching your live instance.
2. **The `max`-effort default itself.** `DEFAULT_THINKING_MODE = "max"` +
   `auto → max` (`src/lib/config/budget-policy.ts`) means every task, even
   trivial ones, runs at maximum reasoning. #5 gives per-task control; if you
   want the *default* faster, either make genuine `auto` omit `--effort` (letting
   Claude Code adapt, matching direct usage) or default to `high`. This trades
   quality for speed globally — your call, which is why I didn't flip it.
3. **iOS notification delegate + actions** (Swift). With #3's push now arriving,
   add `UNUserNotificationCenterDelegate` (`willPresent` + `didReceive`) to
   deep-link into Approvals and register Approve/Deny actions calling the
   existing `resolveApproval`. Today tapping a notification is a no-op.
4. **Watch approvals UI** (Swift). `HiveMatrixWatch/Sources/APIClient.swift`
   already exposes `pendingApprovals`/`resolveApproval` but no view calls them —
   highest-ROI Watch change because the plumbing exists. Also: the complication
   is a static hexagon; make it show a pending-approval count.
5. **Two morning/evening systems, both default-on.** Persona-voice daily moments
   AND the deterministic Day-Brief ritual are both enabled in `DEFAULT_CONFIG`
   (`src/lib/flash/heartbeat.ts`), so you can get two differently-toned morning
   messages. Gate one off by default, or feed the Day-Brief facts into the
   model daily-moment so there's one voice.
6. **`git push` is in the hook's auto-allow Bash allowlist** (`approval.ts`).
   Pushing to a remote is outward-facing; confirm that's intended for autonomous
   agents, or move it below the approval line.
7. **`--append-system-prompt` overhead**: the `claude -p` path injects ~13
   system-prompt blocks per spawn (`src/lib/orchestrator/subprocess.ts`).
   Amortized across a multi-turn task, but worth measuring TTFT impact and
   consolidating the small routing prompts.
