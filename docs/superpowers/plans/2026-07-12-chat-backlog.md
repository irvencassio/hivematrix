# Chat & Observability backlog — 2026-07-12

Opus-authored spec. Construction handed to Sonnet for isolated backend slices;
the shared `src/daemon/console.ts` UI integration is done by the managing model
(Opus) to avoid parallel-edit conflicts. All findings verified live on 0.1.188.

## Scope decision

Ship in two phases:

- **Phase 1 (this build):** observability (record Flash telemetry + by-model
  rendering), approval-autonomy wiring, mic STT fix + composer mic button, MCP
  server listing, Canopy detection in setup.
- **Phase 2 (separate):** voice close-the-loop, Canopy-side register buttons
  (HiveMatrix + Copilot; Copilot config path needs verification first), unified
  cross-device pane decision memo.

## Autonomy decision (default chosen, not blocked)

`autonomous` = bypass approval prompts for reversible/internal actions and
low-risk sends to already-trusted/allowlisted recipients. Keep a **hard safety
floor**: sending to a brand-new (non-allowlisted) recipient, destructive
deletes, and deploy/release still confirm regardless of the dial. `manual` and
`standard` behave as today. Operator can widen the floor later.

---

## 1. Observability (task #2)

### 1a. Record Flash telemetry — `src/lib/flash/loop.ts`
The Flash loop never calls `recordRun`/`captureRunTelemetry`, so chat/voice/skill
usage is absent from observability. On each completed Flash turn, record a
telemetry row with: the resolved model id (the CLI `system/init` `data.model`,
same field `capture.ts:34` reads for orchestrator runs), token counts from the
stream result, role e.g. `"flash"`, and channel. Mirror the shape written by
`captureRunTelemetry` (`src/lib/orchestrator/agent-manager.ts:797,843`) /
`src/lib/observability/capture.ts`. Do not double-count when a Flash turn
escalates to an orchestrator task.

### 1b. Per-model time series — `src/lib/observability/series.ts`
Current query groups `GROUP BY bucket, provider` (`series.ts:195-208`). Add a
model-grouped variant (`GROUP BY bucket, model`) producing per-bucket-per-model
points, exposed on the series payload (a `pointsByModel` alongside the existing
provider points, or reuse the already-computed-but-unused `s.models`).

### 1c. Render by-model in the top charts — `src/daemon/console.ts` (Opus-integrated)
`obsLegend` (`3010-3014`) and `obsStackedBars` (`3017-3051`) are hardwired to
`OBS_COLORS`/`OBS_LABELS`. Branch on `_obsGroup`: in `"model"` mode use the
per-model series + `obsModelColor`/`obsModelLabel`/`obsModelTier`
(`console.ts:2746-2781`, already present). `renderObsDashboard` (`3070`) must
pass the model-grouped points to the legend/bars in that mode.

---

## 2. Approval respects autonomy (task #3)

- `src/lib/orchestrator/lane-tools.ts`: import `getAutonomyLevel` from
  `@/lib/config/autonomy`. In `executeMailBeeSend` (~701) and
  `executeMessageBeeSend` (~754): when level is `autonomous` AND recipient is
  already trusted/allowlisted → send directly. New/non-allowlisted recipient →
  keep drafting (hard floor). Preserve manual/standard behavior.
- `src/lib/orchestrator/approval.ts` `generateHookScript` (~40-160): the
  "MCP tools — always require approval" branch (line ~124) must consult
  autonomy; when `autonomous`, auto-approve mcp tool calls except the safety
  floor (release/deploy/destructive), so an escalated task from chat doesn't
  force per-tool approval.
- `src/daemon/console.ts:1170-1180`: update Autonomy copy to state scope
  precisely (governs Flights/background + chat tool execution; irreversible
  external actions still confirm).

## 3. Mic (task #4)

- `voice-sidecar/turn_server.py`: replace `from stt import transcribe` usage in
  `_one_turn`/`_one_email` with the in-process pywhispercpp path from
  `whisper_stt.py` (`transcribe_whisper`), falling back to `stt.transcribe`
  (command-seam) only when `pywhispercpp` isn't importable — mirroring
  `whisper_stt.py:127-134`.
- `src/daemon/console.ts` `flashPanelHtml()` (~6482-6497): add a mic button as
  the **first child** of `.oc-panel-composer-actions` (before `flashSendBtn` at
  6495) so it renders above Send (flex-column). Handler records via
  MediaRecorder, POSTs audio for transcription, and inserts the transcript into
  `#flashInput` for review (dictation-into-input, not an independent voice turn).
  May need a transcribe-only server path (or a `mode:"transcribe"` on
  `/voice/turn`) that returns text without running a model turn.
- Close the band-aid self-improvement task (`~/.hivematrix/hivematrix.db` tasks
  `_id=7447151e3e254222b1f22cc5`, status `review`) — mark rejected with a note
  pointing at this real fix.

## 4. MCP server listing (task #6)

- `src/lib/mcp/registry.ts` `getMcpServers()` (~51-64): merge in (a) the always-on
  internal `flash` lane-tools server (informational, non-restartable), and (b) a
  read-only reflection of `~/.claude.json`→`mcpServers` (e.g. Canopy), labeled
  "registered for Claude Code — not exposed to chat (strict-mcp-config)". Keep
  `probeMcpServer` status model; `console.ts renderMcp()` needs no change.

## 5. Canopy detection in setup (task #5)

- `src/lib/onboarding/onboarding.ts` (~149-175 pattern): add optional step
  `canopy`. installed = `existsSync("/Applications/Canopy.app")`; registered =
  `mcpServers.canopy` present in `~/.claude.json`. State done when both.
- `src/daemon/console.ts` `wizardAction` (~4225-4275): add a `canopy` case —
  open Canopy's install page when not installed, or run its bundled
  `install-agent-mcp.sh` when installed-but-unregistered.

## Verification
- `npm test` (unit), typecheck.
- Live browser check of the daemon console: Observability by-model legend shows
  Opus/Sonnet/Haiku; 1h shows recent chat/voice after a turn; MCP list shows
  flash + canopy; Setup shows Canopy card; mic button sits above Send and
  dictates into the input; autonomous no longer prompts for allowlisted sends.
- Release via `scripts/developer-id-release.sh`.
