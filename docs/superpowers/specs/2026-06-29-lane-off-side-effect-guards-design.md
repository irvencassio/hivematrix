# Lane-Off Side-Effect Guards Design

## Problem

When Mail Lane appears "not set up" or is disabled, HiveMatrix must not launch or control Apple Mail as a side effect of status checks, notifications, send attempts, or setup surfaces. The live daemon showed Mail Lane disabled after operator action, but Apple Mail had already been launched by earlier Mail Lane AppleScript paths. Message Lane needs the same safety contract: when off, no Messages AppleScript should run.

Flight review cards also read as "Blocks Flight", which sounds like a failure even when the item is simply waiting for operator acceptance.

## Goals

- Mail Lane disabled means no Apple Mail AppleScript for status, send, draft, notification fallback, or background polling.
- Message Lane disabled means no Messages AppleScript for test-send, send, notification fallback, or background result notifications.
- Apple Mail readiness probes must avoid launching Mail unless the operator explicitly asks to set up, enable, or test the lane.
- Review-held Flight child cards should read as operator review work, not failure blockers.
- Preserve existing setup routes and explicit probe/test behavior.

## Non-Goals

- Remove Mail Lane or Message Lane.
- Change allowlist semantics.
- Auto-accept or auto-land review items.
- Change the existing local DB state except through explicit operator actions.

## Proposed Approach

1. Add a Mail app running check in `src/lib/mailbee/applemail.ts`.
   - `canControlMail()` should return false without AppleScript when Mail is not already running.
   - Add an explicit option for setup/enable paths to allow launching Mail when the operator intentionally probes or enables Mail Lane.

2. Gate outbound Mail Lane actions in `src/lib/orchestrator/lane-tools.ts`.
   - `executeMailBeeSend()` and `executeMailBeeDraft()` should return a clear disabled error before calling `sendMail()` or `draftMail()` when Mail Lane is off.

3. Gate notification fallback in `src/lib/notify/notify.ts`.
   - Email notification sends only if Mail Lane is enabled.
   - iMessage notification sends only if Message Lane is enabled.

4. Gate explicit Message Lane test-send in `src/daemon/server.ts`.
   - `/messagebee/test-send` should refuse when Message Lane is disabled before calling `sendIMessage()`.

5. Rename the board badge for review-held Flight children.
   - Change `Blocks Flight` to `Flight Review`.
   - Include `awaiting accept` in the tooltip details when the item status is `review`.

## Risks

- Tightening gates may prevent notifications that used to work through direct config alone. This is intended: lane state must be the source of truth for whether local apps may be driven.
- Changing `canControlMail()` could make setup look less automatic if Mail is closed. The setup copy already tells the operator to open Mail first; explicit probe/enable can still opt into launch-capable behavior.

## Verification

- Focused unit tests:
  - Mail send/draft refuse while disabled without invoking IO.
  - Notify skips email/iMessage when lanes are disabled.
  - `/messagebee/test-send` refuses while disabled.
  - `canControlMail()` does not run Mail AppleScript when Mail is not running.
  - Flight board card text uses `Flight Review`, not `Blocks Flight`.
- Repo gates:
  - `npm run typecheck`
  - `npm test`
  - `node scripts/scope-wall.mjs`
