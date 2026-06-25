# Daemon Runtime Lane Copy Design

## Context

HiveMatrix has moved Settings, onboarding, and model-facing prompts to lane names. A remaining active surface is daemon runtime diagnostics and startup comments. The daemon still exposes a live health detail that says:

- `DesktopBee helper unreachable on :3748`

The route itself remains `/desktopbee/health` for compatibility, but the JSON detail is operator-facing and should use Desktop Lane language.

The daemon startup path also still describes MessageBee, MailBee, ManagerBee, and BrainBee in comments. Those are not runtime behavior, but they are active source docs for future agents editing the daemon entry point, so they should follow the lane naming strategy where doing so does not rename symbols.

## Goal

Update daemon runtime/operator copy to lane language while preserving compatibility routes, imports, function names, labels, and helper executable names.

Use:

- `Desktop Lane helper`
- `Message Lane poll loop`
- `Mail Lane poll loop`
- `Review Lane heartbeat`
- `Memory Lane poller`

Keep:

- `/desktopbee/health`
- `bee: "desktopbee"`
- `probeDesktopBeeHelper`
- `dispatchDesktopBeeAction`
- `startMessageBeePoller`, `startMailBeePoller`, `startManagerBeeHeartbeat`, `startBrainBeePoller`

## Options

### Option A: Rename Routes And Symbols

This would be cleaner long term, but it is a compatibility migration rather than a copy cleanup. It could break existing clients and health checks.

### Option B: Rename Only Active Human-Facing Copy

Keep compatibility names stable while changing the health-detail string and daemon comments that guide future routing work.

### Option C: Leave Runtime Diagnostics Alone

This keeps a visible setup/debugging surface inconsistent with the lane naming strategy.

## Decision

Use Option B. This is a small, safe slice with useful operator impact.

## Acceptance Criteria

1. The `/desktopbee/health` fallback detail says `Desktop Lane helper unreachable on :3748`.
2. The daemon source no longer contains the active detail `DesktopBee helper unreachable`.
3. Daemon startup comments describe lane workers in lane language.
4. Compatibility route and helper API names remain unchanged.
5. Focused tests, `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs` pass.
