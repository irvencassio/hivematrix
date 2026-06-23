# TermBee Canopy Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-06-23-termbee-canopy-provider-design.md`

## Goal

Make HiveMatrix TermBee use Canopy's agent bridge as the default terminal provider while preserving the existing `termbee_session` and `termbee_run` tool contract. Keep the current in-process shell manager as a local fallback only. Update Canopy so opening SSH profiles through the agent bridge can use Keychain without passing a password in the agent payload.

## Task 1: Canopy opens SSH profiles through Keychain

- [x] RED: Add a Canopy test in `/Users/irvencassio/Canopy/Tests/CanopyAgentCoreTests/AppStateAgentCoreTests.swift` proving `terminal.session.open_ssh` no longer advertises `password` as an input key.

Expected failing assertion:

```swift
let caps = await core.registeredCapabilities()
let openSSH = try #require(caps.first { $0.name == "terminal.session.open_ssh" })
#expect(openSSH.inputKeys == ["profileID"])
```

- [x] GREEN: In `/Users/irvencassio/Canopy/ShellLens/Models/AppState.swift`, change the `terminal.session.open_ssh` capability input keys to `["profileID"]`.
- [x] GREEN: In `/Users/irvencassio/Canopy/ShellLens/Agent/Executors/TerminalAgentExecutor.swift`, make `openSSH` use Keychain lookup instead of requiring `payload["password"]`.
- [x] GREEN: Update the handler in `/Users/irvencassio/Canopy/ShellLens/Models/AppState.swift` to await the async terminal executor method.

Verification:

```bash
cd /Users/irvencassio/Canopy
swift test --filter AppStateAgentCoreTests
```

## Task 2: HiveMatrix Canopy bridge client

- [x] RED: Add `/Users/irvencassio/hivematrix/src/lib/canopy/client.test.ts` for bridge config loading and capability invocation.

Test cases:

```ts
assert.deepEqual(loadCanopyBridgeConfigFromState({ port: "8421", token: "abc" }), { port: 8421, token: "abc" });
assert.equal(canUseCanopyTerminal([{ name: "terminal.session.send" }, ...required]), true);
```

- [x] GREEN: Add `/Users/irvencassio/hivematrix/src/lib/canopy/client.ts` with:
  - `loadCanopyBridgeConfig`
  - `loadCanopyBridgeConfigFromState`
  - `invokeCanopyCapability`
  - `listCanopyCapabilities`
  - `canUseCanopyTerminal`

Verification:

```bash
cd /Users/irvencassio/hivematrix
npm test -- src/lib/canopy/client.test.ts
```

## Task 3: TermBee provider abstraction

- [x] RED: Add `/Users/irvencassio/hivematrix/src/lib/termbee/provider.test.ts` proving the provider prefers Canopy, wraps commands with a marker, polls read output, and falls back to local shell when Canopy is unavailable.

Test shape:

```ts
const provider = createTermBeeProvider({ canopy: fakeCanopy, local: fakeLocal });
await provider.createSession({ id: "s1" });
const result = await provider.runCommand("s1", "echo hi");
assert.equal(result.exitCode, 0);
assert.match(result.output, /hi/);
```

- [x] GREEN: Add `/Users/irvencassio/hivematrix/src/lib/termbee/provider.ts`.
- [x] GREEN: Keep the existing local implementation in `/Users/irvencassio/hivematrix/src/lib/termbee/session.ts` and call it only through the fallback adapter.
- [x] GREEN: Use Canopy capabilities:
  - `terminal.sessions.list`
  - `terminal.session.open_local`
  - `terminal.session.read`
  - `terminal.session.send`
- [x] GREEN: Represent unavailable Canopy/unsupported kill with clear errors.

Verification:

```bash
cd /Users/irvencassio/hivematrix
npm test -- src/lib/termbee/provider.test.ts src/lib/termbee/session.test.ts
```

## Task 4: Wire TermBee tools through the provider

- [x] RED: Update `/Users/irvencassio/hivematrix/src/lib/orchestrator/bee-tools.test.ts` so the schemas and guide still expose `termbee_session` and `termbee_run`, but the language says Canopy-backed/default provider.
- [x] GREEN: Update `/Users/irvencassio/hivematrix/src/lib/orchestrator/bee-tools.ts` to call the provider instead of importing the local session manager directly.
- [x] GREEN: Update `/Users/irvencassio/hivematrix/src/lib/orchestrator/outbound-routing.ts` and matching test so CLI routing no longer implies raw shell is the default.

Verification:

```bash
cd /Users/irvencassio/hivematrix
npm test -- src/lib/orchestrator/bee-tools.test.ts src/lib/orchestrator/outbound-routing.test.ts
```

## Task 5: Status and full verification

- [x] Update status/docs if needed so TermBee is described as a contract with Canopy as preferred provider.
- [x] Run:

```bash
cd /Users/irvencassio/hivematrix
npm run typecheck
npm test -- src/lib/canopy/client.test.ts src/lib/termbee/provider.test.ts src/lib/termbee/session.test.ts src/lib/orchestrator/bee-tools.test.ts src/lib/orchestrator/outbound-routing.test.ts
node scripts/scope-wall.mjs
```

- [x] Run:

```bash
cd /Users/irvencassio/Canopy
swift test --filter AppStateAgentCoreTests
cd agent && npm test
```
