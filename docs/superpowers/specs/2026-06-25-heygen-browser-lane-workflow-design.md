# HeyGen Browser Lane Workflow Skeleton — Design

> Date: 2026-06-25 · Status: approved (scope set by operator prompt) · Topic: heygen-browser-lane-workflow
> Builds on commit `e2b8e7d` (read-only agent_browser snapshot MVP).

## Problem

We want to turn a script into a HeyGen *portal* video task, routed through COO /
Browser Lane with readiness gating and explicit operator handoffs — without
building general browser clicking, credential injection, or adding Playwright. This
is the portal (app.heygen.com) flow, distinct from the existing HeyGen *API* path
(`video/heygen.mjs`, `2026-06-23-heygen-video-agent-design.md`).

## Non-goals / guardrails

- No general browser clicking / credential injection / Playwright. No
  mail/message/desktop/terminal execution. No destructive Bee→Lane cleanup,
  `WorkerKind` flips, `DesktopBeeHelper.app` rename, or module sweeps.
- **No secrets** in workflow payloads, audit, traces, logs, or responses — only the
  non-secret `credentialRef` pointer (metadata), site/domain names, script text.
- Login / 2FA / CAPTCHA / file-picker / preview / export are **explicit operator
  handoff points**, never fake automation.
- Do **not** auto-store credentials (no Keychain writes).

## Design

### 1. HeyGen seed + job builder (`src/lib/browser-lane/heygen.ts`)
- `HEYGEN_SITE` constant: id `heygen`, `app.heygen.com`/`heygen.com`, home/login URLs,
  authStrategy `manual_session`, a metadata-only `credentialRef` pointer.
- `seedHeyGenBrowserSite()` (idempotent): upserts the site + a readiness probe
  (home URL, asserts the app marker "Create video", requiresAuth) + a COO routing
  rule (`heygen.video`: domains `heygen.com`/phrase `heygen` → lane `browser`,
  capability `workflow.run`, riskTier `external_side_effect`). Stores metadata only;
  **no Keychain credential write**.
- `HEYGEN_HANDOFF_POINTS`: typed manual handoffs — login, two-factor, CAPTCHA,
  file-picker, preview, export.
- `buildHeyGenVideoJob({ script, title, creativeNotes?, assetPaths?, project? })`:
  normalizes (via `parseBrowserBeeJobCreate`) to a `BrowserBeeJobCreatePayload` with
  `startUrl` HeyGen create URL, `requiresLogin: true`, `jobType: form_fill`,
  `approvalMode: manual`, `runMode: manual_escalation`, `artifactPolicy: screenshots`,
  `tracePolicy: timeline`, the handoff points + script steps, and success criteria
  (final URL or a manual completion note). Script/notes/asset paths only — **no secrets**.

### 2. Readiness-gated dispatch (`src/lib/video/heygen-workflow.ts`)
- `dispatchHeyGenVideoWorkflow(input, opts)` reuses COO dispatch so routing, audit,
  readiness, and execution-availability gates stay centralized:
  - request = `{ text: job.objective, domains: ["app.heygen.com"], project }`.
  - prepare (default) → `dispatchCooRequest(request, { staleAfterHours })` + the job.
  - create → `dispatchCooTask(request, { create, projectPath, browserAvailable,
    staleAfterHours, createTask })`; the injected `createTask` builds the task from the
    **rich HeyGen envelope** (`buildBrowserBeeTaskRequestEnvelope(job, projectPath)`),
    not the generic COO work item. The readiness/exec gates still run first, so a
    stale/needs_reauth/orange/gray HeyGen site yields `readiness_required` and never
    creates a task. `persistTask` is injected (endpoint provides `Task.create`).
- Returns `{ ...CooDispatchResult, job }`.

### 3. Endpoint (`src/daemon/server.ts`)
- `POST /video/heygen-workflow` — body `{ script, title, creativeNotes?, assetPaths?,
  project?, projectPath?, create? }`. Validates script+title (400 if empty). On
  `create`, validates `projectPath` (`normalizeHomeProjectPath`), passes
  `browserAvailable` (policy) + `staleAfterHours` (config), and a real `persistTask`
  (`Task.create`, source `browser-lane`, output carries the envelope + coo + heygen
  metadata). Returns the dispatch result (or the exact readiness blocker).

## Tests (RED first)
- seed creates metadata-only site + probe + routing rule (no secret columns).
- `buildHeyGenVideoJob`: `requiresLogin:true`, all six handoff points present, script
  carried, no password/token/cookie/credentialRef in the payload JSON.
- `resolveCooRouteFromRules` routes `app.heygen.com` → `browser` after seed.
- `dispatchHeyGenVideoWorkflow`: green+fresh → `created` + taskId + rich envelope
  (requiresLogin, no secrets); needs_reauth → `readiness_required` (no create); stale
  green → `readiness_required`.
- Existing video review/script + browser-lane tests stay green.

## Verification
`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — all green.
