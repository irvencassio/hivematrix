# Daemon Tailscale Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec: `docs/superpowers/specs/2026-07-05-daemon-tailscale-awareness-design.md`

## Task 1 — TDD the tailnet helper

- [ ] `src/lib/tunnel/tailscale.test.ts` (write first, watch it fail):
  - `isTailnetAddress`, `hostOnMesh`, `parseTailscaleStatusJSON` (fixture),
    `filterStunOnly`.
- [ ] `src/lib/tunnel/tailscale.ts`: implement `TailscaleStatus`,
  `isTailnetAddress`, `hostOnMesh`, `parseTailscaleStatusJSON`, `filterStunOnly`
  (pure) + `tailscalePath`, `tailscaleStatus(port)` (execFileSync, 4s timeout,
  candidate paths + `which` fallback). Green.

## Task 2 — Expose tailnet state on `GET /tunnel`

- [ ] `src/daemon/server.ts` `/tunnel` route: merge
  `tailscale: tailscaleStatus(PORT)` into the JSON (import from
  `@/lib/tunnel/tailscale`; `PORT` = `HIVEMATRIX_PORT ?? 3747`). Additive only.

## Task 3 — Skip TURN on-mesh in `GET /voice/rtc/config`

- [ ] `src/daemon/server.ts` `/voice/rtc/config` route: parse query; compute
  `direct = qs.get("transport")==="direct" || hostOnMesh(req.headers.host)`;
  `filterStunOnly(ice)` when direct; return `{ iceServers, transport }`.
  No subprocess on this path (Host/param only).

## Task 4 — Operator runbook

- [ ] `scripts/tailscale-setup.sh`: detect/instruct install (brew or app),
  `tailscale up` (interactive sign-in — operator), `tailscale serve --bg 3747`,
  then print the tailnet pairing URL + token from `~/.hivematrix/auth-token`.
  Idempotent; fail-soft with guidance when the CLI is missing.
- [ ] `docs/TAILSCALE.md`: the approach (Tailscale for phone/glasses, named
  tunnel for Watch/off-mesh), the setup steps, how skip-TURN works, pairing.

## Task 5 — Verify

- [ ] `npm run typecheck` (zero errors)
- [ ] `npm test` (all green; new tailscale tests included)
- [ ] `node scripts/scope-wall.mjs` (zero violations)
- [ ] `bash -n scripts/tailscale-setup.sh`
- [ ] Commit locally (packaged daemon needs a rebuild to serve the new routes).
