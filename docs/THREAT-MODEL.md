# HiveMatrix Phase 4 Threat Model

Last reviewed: 2026-07-02

## Scope

Phase 4 adds installable packs, dashboard cards, companion-app pack surfaces,
approval flows, and capture-to-task helpers. This review covers the trust
boundary between first-party HiveMatrix code, signed pack bundles, imported pack
skills/directives, untrusted user/channel content, and companion clients.

## Assets

- Operator intent, approvals, and task state.
- Pack signing keys and trusted public-key configuration.
- Imported skills, directives, dashboard-card metadata, and pack-owned files.
- Local secrets in `~/.hivematrix`, mail/message/X provider tokens, and app
  store credentials.
- Companion app API responses and approve/deny actions.

## Trust Boundaries

- Pack bundles are untrusted until signature verification and content scanning
  succeed.
- Pack-owned skills and directives are untrusted execution instructions until
  scan-on-install produces a non-blocking verdict.
- Mail, message, social, and capture text are untrusted content. They may inform
  tasks, but they must not become higher-priority system/developer instructions.
- Companion apps are presentation and explicit-action clients. They may request
  state and submit approvals, but daemon policy remains the source of truth.

## Primary Threats

- Prompt injection in inbound content that asks the agent to reveal system
  prompts, developer messages, tool calls, passwords, API keys, or secrets.
- Malicious pack skills that attempt to override prior instructions, hide
  actions from the operator, exfiltrate secrets, or run destructive commands.
- Unsigned or tampered pack archives installed as trusted first-party packs.
- Confused-deputy companion flows where rich card or wishlist metadata tricks an
  operator into approving the wrong thing.
- Pack uninstall leaving active skills/directives behind.

## Current Controls

- Pack archives are Ed25519 signed. The daemon verifies signatures before
  importing manifests, skills, directives, or dashboard cards.
- Pack install persists pack-owned artifacts under the pack slug and tracks
  ownership for clean uninstall.
- `scanSkillContent()` blocks high-risk prompt-injection, hidden-action,
  destructive command, pipe-to-shell, credential, and obfuscation patterns before
  auto-trusting imported skills.
- `classifyMailTrust()` treats inbound messages as untrusted, flags prompt
  injection, and limits autonomous sends to trusted senders.
- Companion clients render pack cards and approvals from daemon APIs; daemon
  APIs retain approval resolution and pack install policy.

## Verification Fixtures

- `src/lib/eval/prompt-injection-fixtures.test.ts` covers malicious inbound
  content and malicious imported skill bodies.
- `src/lib/skills/scan.test.ts` covers scanner rule behavior.
- `src/lib/mailbee/contracts.test.ts` covers mail trust classification.
- `src/daemon/packs-routes.test.ts` covers signed pack install/list/uninstall
  route behavior.

## Residual Risks

- Heuristic scanning is defense in depth, not a formal proof. New prompt
  injection phrasing can appear and should be added as fixtures when observed.
- First-party catalog signing requires local private-key access during catalog
  install. Production operators should keep signing keys out of repository
  history and prefer path-based key configuration.
- Companion approval UX still depends on clear metadata from packs and daemon
  proposals. High-risk approvals should continue to require explicit operator
  action.

## Release Gate

Before shipping Phase 4, run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts src/daemon/packs-routes.test.ts src/lib/packs/*.test.ts src/lib/eval/*.test.ts
npm run typecheck
node scripts/scope-wall.mjs
```
