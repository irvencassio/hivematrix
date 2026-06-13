# MessageBee Permission Probe Design

## Context

The main screen renders MessageBee readiness from `GET /onboarding`. That endpoint
passes `messagebee: { enabled: isChannelEnabled(), chatDbReadable: canReadChatDb() }`
into `getOnboardingStatus()`.

`canReadChatDb()` currently returns a boolean after:

1. checking that `~/Library/Messages/chat.db` exists;
2. opening it read-only with `better-sqlite3`;
3. running `SELECT 1 FROM message LIMIT 1`.

If any of those fail, onboarding reports:

> Full Disk Access needed to read Messages (chat.db)

The user reports that the main screen says MessageBee lacks permissions even
after granting them several times.

## Problem

The boolean probe collapses distinct failure states into a single permission
message. That can mislead the main screen when:

- Full Disk Access is granted but the SQL probe fails for another reason.
- The Messages database exists but is temporarily locked or has schema drift.
- Full Disk Access was granted to one process identity while the running daemon
  is a different process identity.
- MessageBee is enabled and outbound Messages automation works, but inbound
  chat.db readability is failing separately.

The current UI does not show enough detail to distinguish "grant permission"
from "restart/reinstall the daemon" or "chat.db opened but the schema probe
failed."

## Goals

1. Preserve the main screen's simple done/incomplete state.
2. Make MessageBee readiness explain the actual failing sub-check.
3. Keep inbound MessageBee gated on real chat.db readability.
4. Avoid claiming permission is missing when the file exists and the failure is
   not clearly a TCC/Full Disk Access denial.
5. Add tests before implementation.

## Non-Goals

- Do not relax the requirement that inbound MessageBee must read `chat.db`.
- Do not change allowlist semantics.
- Do not touch local-model/Qwen paths or readiness gates.
- Do not automate macOS TCC database edits.

## Approaches

### Approach A: Add Diagnostic Probe, Keep Existing Boolean

Add a new `probeChatDbAccess()` helper in `src/lib/messagebee/imessage.ts` that
returns structured state:

```ts
type ChatDbAccessProbe =
  | { ok: true; detail: string }
  | { ok: false; reason: "missing" | "open_failed" | "schema_failed"; detail: string };
```

Keep `canReadChatDb()` as a compatibility wrapper returning `probe.ok`.
`GET /onboarding` and `GET /messagebee` can include `chatDbDetail`, and
`getOnboardingStatus()` can use that detail for user-facing copy.

Pros:

- Small and backward-compatible.
- Tests can target pure probe behavior with temporary sqlite files.
- Improves the main screen without broad UI churn.

Cons:

- Still cannot directly prove which macOS app/process has Full Disk Access.
- Requires a small API shape extension.

### Approach B: Treat Any Existing DB Open As Permission Success

Change `canReadChatDb()` to return true once the database opens successfully,
and move schema failures into poller/read errors.

Pros:

- Reduces false "permission missing" states.
- Minimal surface area.

Cons:

- The setup strip may show done even if inbound reads cannot actually work.
- Less precise than the current operational gate.

### Approach C: Add a Separate Live Permission Repair Flow

Keep the existing boolean but add UI copy/actions that suggest restart, app
identity, and installed bundle checks when repeated setup attempts fail.

Pros:

- Helps users recover from macOS TCC identity issues.

Cons:

- Does not fix the misleading core status.
- More UI work for less correctness.

## Recommendation

Use Approach A.

The core bug is not that MessageBee should ignore `chat.db` readability; it is
that the readiness contract is too lossy. A structured probe lets the main screen
say, for example:

- `Messages database not found`
- `Cannot open Messages database; grant Full Disk Access to the running HiveMatrix app/daemon, then restart HiveMatrix`
- `Messages database opened, but the message table check failed: <error>`
- `enabled; reading chat.db and sending via Messages`

This keeps inbound MessageBee honest while preventing the UI from repeatedly
telling the user to grant a permission that may already be granted.

## Test Plan

1. Add `src/lib/messagebee/imessage.test.ts` coverage for:
   - missing DB path returns `reason: "missing"`;
   - valid minimal DB returns ok;
   - DB that opens but lacks the `message` table returns `reason: "schema_failed"`;
   - `canReadChatDb()` remains a boolean wrapper.
2. Add `src/lib/onboarding/onboarding.test.ts` coverage that structured
   `messagebee.chatDbDetail` is rendered in the MessageBee step.
3. Run:
   - `npm test -- src/lib/messagebee/imessage.test.ts src/lib/onboarding/onboarding.test.ts`
   - `npm test`
   - `npm run typecheck`
   - `node scripts/scope-wall.mjs`

`npx tsx scripts/qwen-readiness.mts` is not required because this change does
not touch local-model paths.
