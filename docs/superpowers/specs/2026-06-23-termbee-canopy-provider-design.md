# TermBee Canopy Provider Design

Date: 2026-06-23

## Problem

HiveMatrix currently exposes `termbee_session` and `termbee_run` as a HiveMatrix-owned embedded terminal lane. The implementation starts `/bin/bash --norc --noprofile` directly inside the HiveMatrix daemon and keeps session state in memory.

That makes TermBee useful for local shell work, but it does not match the stronger credential and approval story already built into Canopy. Canopy has server profiles, Keychain-backed secrets, a localhost agent bridge, a CLI/MCP adapter, explicit approvals, audit logs, and command logs.

If HiveMatrix keeps telling agents to use TermBee for terminal/server work, agents may bypass Canopy's intended boundary and fall back to raw shell behavior. That is especially risky for remote server credentials because a raw terminal lane cannot know which credentials should be hidden, when to ask for approval, or which profile owns the session.

## Current Findings

### HiveMatrix TermBee

- Code lives in `src/lib/termbee/`.
- Tools are exposed from `src/lib/orchestrator/bee-tools.ts` as:
  - `termbee_session`
  - `termbee_run`
- CLI harnesses are steered to the same tools through daemon route `POST /bee/<tool>`.
- Current implementation owns local shell processes directly.
- It has no credential store, profile registry, approval policy, or durable audit log.
- It works even when Canopy is not installed or not running.

### Canopy Agent Surface

- Canopy starts a loopback-only bridge when its app is running.
- Bridge state is written to `~/Library/Application Support/Canopy/agent-bridge.json`.
- The bridge requires a bearer token when configured.
- Canopy exposes a Node CLI and MCP server under `/Users/irvencassio/Canopy/agent`.
- Current terminal capabilities include:
  - `terminal.sessions.list`
  - `terminal.session.read`
  - `terminal.session.send`
  - `terminal.session.focus`
  - `terminal.session.open_local`
  - `terminal.session.open_ssh`
- Mutating capabilities pass through Canopy's approval policy.
- `terminal.session.send` is logged through Canopy's agent command log.
- Server passwords and generic API secrets use macOS Keychain.

### Important Gap In Canopy

The normal Canopy UI path opens SSH profiles by reading the password from Keychain or prompting the user. The current agent executor for `terminal.session.open_ssh` still requires a `password` payload for password-auth profiles.

Before HiveMatrix relies on Canopy as the safer terminal provider, Canopy should expose an agent-safe profile-open path where the agent passes only `profileID`, and Canopy itself reads Keychain or returns a structured "human input needed" response.

## Options

### Option A: Remove TermBee From HiveMatrix

Remove `termbee_*` tools and tell agents to use Canopy MCP/CLI directly.

Pros:
- Eliminates the misleading duplicate terminal lane.
- Forces credential-sensitive terminal work through Canopy.
- Reduces HiveMatrix terminal ownership.

Cons:
- Breaks existing tool routing, tests, docs, and agent prompts.
- Local Qwen/generic agent loop does not currently consume arbitrary external MCP servers as first-class tools.
- Removes the offline local shell fallback when Canopy is not running.
- Makes the user-facing HiveMatrix capability dependent on another app's process availability.

Recommendation: do not choose this as the first move.

### Option B: Keep The TermBee Name But Make Canopy The Provider

Treat TermBee as the terminal capability contract, not as the implementation. HiveMatrix keeps advertising `termbee_session` and `termbee_run`, but the default provider calls Canopy's agent bridge when available.

Implementation shape:
- Add a Canopy client in HiveMatrix that reads:
  - `CANOPY_AGENT_PORT`
  - `CANOPY_AGENT_TOKEN`
  - `CANOPY_AGENT_STATE_FILE`
  - otherwise `~/Library/Application Support/Canopy/agent-bridge.json`
- Add capability checks for Canopy bridge health and capability inventory.
- Map `termbee_session`:
  - `list` -> `terminal.sessions.list`
  - `create` with local mode -> `terminal.session.open_local`
  - `create` with profile ID -> `terminal.session.open_ssh`
  - `kill` -> unsupported until Canopy adds `terminal.session.close`
- Map `termbee_run`:
  - send a marker-wrapped command through `terminal.session.send`
  - poll `terminal.session.read` until the marker appears
  - return output and exit code like the current TermBee contract
- Keep the direct HiveMatrix bash session manager as an internal fallback only when Canopy is unavailable and the requested work is local.

Pros:
- Keeps HiveMatrix's existing tool contract stable.
- Moves terminal/server work toward Canopy's profile, Keychain, approval, and audit surfaces.
- Avoids agents learning two different terminal tools.
- Preserves local fallback for emergencies and development.

Cons:
- Needs careful semantic mapping because Canopy's current terminal API is interactive send/read, not command-run.
- Canopy should add safer profile opening and ideally a native `terminal.command.run` capability.
- `kill`/close is not currently represented in Canopy's agent capabilities.

Recommendation: best overall direction.

### Option C: Add A Separate `canopy_*` Tool And Deprecate TermBee

Add HiveMatrix tools such as `canopy_capabilities`, `canopy_terminal_open`, and `canopy_terminal_send`, while marking `termbee_*` deprecated.

Pros:
- Honest about the provider.
- Easier initial implementation because it can mirror Canopy's exact capabilities.
- Lets agents use Canopy directly for profile-aware work.

Cons:
- Creates two terminal lanes in prompts and routing.
- Agents may still choose the raw TermBee path unless guidance is very strong.
- More naming and migration churn.

Recommendation: useful as a temporary bridge only if Option B is too large for one slice.

## Recommended Design

Choose Option B: keep `TermBee` as the HiveMatrix terminal contract, but change its default provider to Canopy.

TermBee should mean:

> "HiveMatrix terminal work, executed through the safest available terminal provider."

Provider order:

1. Canopy bridge, when running and capability-compatible.
2. Direct HiveMatrix local shell fallback, only for local commands and only when Canopy is unavailable.

This keeps the public HiveMatrix lane stable while making the implementation match the security model the user expected.

## Required Canopy Companion Change

Before using Canopy for credential-managed remote sessions, update Canopy so `terminal.session.open_ssh` can open a profile using Keychain without passing a password through the agent payload.

Desired behavior:

- Agent sends `{ "profileID": "..." }`.
- Canopy looks up the profile.
- If SSH key auth: open without password unless passphrase is needed.
- If password auth and Keychain has password: open using Keychain.
- If password auth and Keychain is missing: return a structured error or approval/input-needed envelope; do not ask HiveMatrix or the agent to pass the password.
- Remove `password` from the public agent capability input keys, or keep it only as a human-approved emergency override.

This is the piece that makes the credential boundary real.

## HiveMatrix Implementation Sketch

Add:

- `src/lib/canopy/client.ts`
  - `loadCanopyBridgeConfig()`
  - `invokeCanopyCapability()`
  - `listCanopyCapabilities()`
  - `isCanopyTerminalAvailable()`
- `src/lib/termbee/provider.ts`
  - provider interface for `session`, `run`, and `read`
  - Canopy provider
  - local shell fallback provider
- update `src/lib/orchestrator/bee-tools.ts`
  - keep tool names
  - route through provider instead of importing `src/lib/termbee/session` directly
- update routing prompt text
  - describe TermBee as Canopy-backed when available
  - forbid passing passwords or secrets through terminal tool args
- update service status
  - show TermBee provider as `canopy`, `local-fallback`, or `unavailable`

## Verification

HiveMatrix:

- `npm run typecheck`
- `npm test -- src/lib/orchestrator/bee-tools.test.ts src/lib/connectivity/posture.test.ts src/lib/bees/service-manager.test.ts`
- `node scripts/scope-wall.mjs`

Canopy:

- `swift test`
- `cd agent && npm test`
- Manual/local check with Canopy running:
  - `node /Users/irvencassio/Canopy/agent/bin/canopy.js capabilities list`
  - `node /Users/irvencassio/Canopy/agent/bin/canopy.js terminal sessions`
  - open an SSH profile without password in CLI payload

## Open Questions

1. Should direct local shell fallback remain available, or should HiveMatrix refuse all terminal work when Canopy is unavailable?
2. Should the user-facing name stay `TermBee`, or should the UI say `Terminal (Canopy)` while internal tool names remain stable?
3. Should command completion polling live in HiveMatrix, or should Canopy add a first-class `terminal.command.run` capability?

Recommended answers:

1. Keep local fallback for local-only work, but never for remote/profile credential work.
2. Keep internal `termbee_*` names for compatibility; display the provider clearly in UI/status.
3. Start with HiveMatrix polling for a small slice; add `terminal.command.run` to Canopy as the cleaner follow-up.
