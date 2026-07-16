# Browser Lane Desktop Fallback — Route to Claude, Not a Local Model — Design

> Status: brainstormed autonomously (self-improvement task, unattended run — see note at bottom). Scope: `src/lib/orchestrator/lane-tools.ts`, `src/lib/browser-lane/jobs.ts`, `docs/BRINGUP-CHECKLIST.md`. Do NOT release.

## Problem

The dispatched task reports: `hivematrix_browser` workflow jobs that land on the Desktop Lane fallback backing fail with *"Desktop Lane fallback needs a configured local model"*, blocking every authenticated workflow (`requiresLogin: true`) once Codex Computer Use isn't usable — concretely blocking `integrity.com` client-data access right now.

## Root cause (verified by direct read, not just agent report)

This is a **sequencing gap left by the Claude-native cutover** (`docs/superpowers/plans/2026-07-11-claude-native-cutover.md`, 2026-07-11), not a new bug and not something a prior Browser Lane spec already solved.

1. **The fallback's model gate.** `executeBrowserBeeRun()` (`src/lib/orchestrator/lane-tools.ts:1170-1177`), when `resolveBrowserBeeBacking()` (`src/lib/browser-lane/jobs.ts:453-485`) picks `desktop_fallback`, does:
   ```ts
   const { getLocalModelConfig } = await import("@/lib/config/constants");
   const local = getLocalModelConfig();
   if (!local?.modelName) {
     return "Error: the Desktop Lane fallback needs a configured local model (config localModel.modelName), but none is set.";
   }
   model = local.modelName;
   ```
   This dates from when the fallback genuinely ran on the operator's local Qwen model (DECISIONS.md, 2026-06-14: *"the local model drives a real desktop browser via AppleScript/Accessibility"*).
2. **The key it depends on is now permanently empty.** `src/lib/config/migrate.ts:22` (`DEAD_KEYS = ["qwen", "localEngine", "localModel"]`) — part of the already-approved, already-implemented claude-native cutover — strips `config.localModel` from `~/.hivematrix/config.json` on every daemon boot. Post-cutover, `getLocalModelConfig()` can never return non-null again. The condition at `lane-tools.ts:1173` therefore now **always** fires.
3. **Why it's surfacing now.** Yesterday's change (`docs/superpowers/specs/2026-07-15-browser-lane-desktop-fallback-auto-enable-design.md`) made `browserLane.desktopFallback` auto-enable the moment an operator adds their first authenticated site — before that, the fallback was 100% opt-in and rarely exercised, so the dead gate went unnoticed. Adding `integrity.com` as an authenticated site auto-armed the fallback; the first workflow that couldn't use Codex Computer Use (subscription account, not `api-key`) then hit the always-dead branch.
4. **The claude-native-cutover plan never named this consumer.** Its Phase 5 cleanup manifest lists `src/lib/local-model/*`, `qwen-profile.ts`, `chat-client.ts`'s `localChatComplete`, `backends.ts`, `available.ts`'s local option builders, `task-model.ts`/`task-display.ts`/`writer-role.ts`, `voice/llm-env.ts` — but never mentions `lane-tools.ts`'s Desktop-fallback branch. It fell through because Browser Lane wasn't in that plan's search scope (grepped for `qwen`/`local-primary`/`local-secondary`; this branch reads `config.localModel` directly, a different string).

## Correcting the task's premise

The dispatch brief states *"Browser Lane redesign from earlier this month specified full Claude integration... Fallback using Claude is part of that architecture."* Two independent full-repo searches (DECISIONS.md through Q20, every `docs/superpowers/specs|plans` file, the 2026-06-25 Browser Lane UX doc, the 2026-07-16 Canopy-parity doc, the 2026-07-15 auto-enable doc) turned up **no existing spec that says the Desktop Lane fallback should run on Claude**. The claude-native cutover plan is about routing role-based inference (thinking/coding/operational/writer); it never touches Browser Lane. The Canopy-parity work is UI/permissions/audit only. The auto-enable doc explicitly leaves `jobs.ts`'s decision logic untouched. **This design doc is that missing spec, written now** — not a restoration of prior intent.

## Current state (verified)

- **Backing decision** (unrelated to login/CAPTCHA/form-fill — purely an auth/availability gate): `resolveBrowserBeeBacking()` picks `codex_computer_use` only when `codexAuthMode === "api-key"`; otherwise `desktop_fallback` when the operator opted in (`browserLane.desktopFallback`) and Desktop Lane is running (`getConnectivityPolicy().getCapability("desktopbee")` — **always `true` in every connectivity mode**, `src/lib/connectivity/policy.ts:34,49,66`, since it's a local Swift helper, not cloud-gated).
- **What actually drives the browser on this path.** The created Task is dispatched exactly like any other agent Task (`POST /tasks`, `executor: "agent"`, loopback + shared-secret auth — `lane-tools.ts:1196-1210`). Its `model` field selects the executor. For a Claude model id, `src/lib/orchestrator/subprocess.ts` spawns the ordinary `claude` CLI coding harness (`buildClaudeSpawnArgs`, full native tools, `--dangerously-skip-permissions`, the `PreToolUse` approval hook as the real gate — **no `--allowedTools` filtering happens anymore**, per the comment at `subprocess.ts:328-330`). The task description (`buildBrowserBeeDesktopFallbackDescription`, `jobs.ts:380-401`) already tells the executor to drive the browser with the `desktop_action` tool via `desktop.script.run` → `desktop.ax.query`/`desktop.ax.act` → coordinate click, verified with `desktop.capture` — and the general outbound-routing prompt (`beeToolsRoutingPrompt`, `src/lib/orchestrator/outbound-routing.ts:192-208`) already documents `POST /bee/desktop_action` as a generic, model-agnostic HTTP bridge any Claude-executed Task can call with its Bash tool.
- **Conclusion: no new Claude↔DesktopBee wiring is needed.** `desktop_action` is already a first-class lane tool (`lane-tools.ts:142-173,1229-1252`) reachable by any agent-executed Task regardless of which Claude model runs it. The only thing tying this path to a local model is the one dead gate above, plus stale prose. This is a **narrow fix**, not new integration work.
- **Existing tests.** `src/lib/browser-lane/jobs.test.ts` covers `resolveBrowserBeeBacking`/`readBrowserBeeDesktopFallbackEnabled` (the *decision*) thoroughly. `src/lib/orchestrator/lane-tools.test.ts` covers the accessMode read/write gate on `executeBrowserBeeRun` but has **zero coverage of the post-decision model-resolution branch** — no test exercises `desktop_fallback` end-to-end. This regression shipped with no test guarding it.

## Approaches considered (which Claude model backs the fallback)

**A. Hardcode a literal model string (`"sonnet"`) in `lane-tools.ts`.** Rejected: every other place in the codebase that needs "the operator's chosen Claude model for autonomous execution work" goes through the existing `RoleModels`/`getRoleModels()` seam (`src/lib/models/available.ts:274-283`, config key `frontierModel`) — `writer-role.ts:38` and `scheduler.ts:163-190` (`resolveModelForAgentRole`) both do `roleModels.<slot>.trim() || CLAUDE_<TIER>_ID`. Hardcoding a string here re-rolls scaffolding that already exists and ignores an operator's `frontierModel` override (e.g., if they've pinned Opus or a Codex model as their coding tier).

**B. Route through the `operational` tier (Haiku, cost/latency-optimized).** Rejected: `operational`/Haiku is for ambient, one-shot, bulk work (day-brief, ratchet, weaver-audit — see the cutover plan's Phase 2 list). The Desktop fallback is a multi-turn, full-tool-access, budget-bounded autonomous agent session driving a real login/navigation flow — architecturally identical to a normal coding Task, not a cheap ambient completion. Codex Computer Use, the backing this replaces *as a fallback for*, is itself a strong, specialized model — the Claude analog should match capability, not undercut it with the cheapest tier.

**C. (Chosen) Reuse `getRoleModels().coding` (config key `frontierModel`, default Claude Sonnet), matching the exact `.trim() || CLAUDE_SONNET_ID` idiom already used by `writer-role.ts`/`scheduler.ts`.** Zero new config keys, zero new concepts — the "coding" role slot already means "the Claude model for autonomous implementation/execution work," which is exactly what desktop-automation-driving is. An operator who already overrode `frontierModel` gets that choice honored here for free.

## Design

### 1. `src/lib/orchestrator/lane-tools.ts` — `executeBrowserBeeRun()`

Replace the local-model gate with a Claude model resolution. No error path remains for "no model configured" — a Claude coding-tier model is always resolvable once `desktop_fallback` was already chosen as the backing (that decision already confirmed Desktop Lane is reachable; model choice is a config default, never absent).

```ts
if (decision.backing === "desktop_fallback") {
  const { getRoleModels, CLAUDE_SONNET_ID } = await import("@/lib/models/available");
  model = getRoleModels().coding.trim() || CLAUDE_SONNET_ID;
  description = buildBrowserBeeDesktopFallbackDescription(payload, { requestedProjectPath: ctx.projectPath });
} else {
  model = CODEX_COMPUTER_USE_MODEL_ID;
  description = buildBrowserBeeTaskDescription(payload, { requestedProjectPath: ctx.projectPath });
}
```

`laneLabel` (currently `"Desktop fallback — local model"`) becomes `"Desktop fallback — Claude"`. The two nearby comments describing this branch as "the local Desktop Lane path... driven by the local model" get the same word swap (grep `local model` in this file to catch every instance verbatim rather than trusting hand-copied line numbers).

### 2. `src/lib/browser-lane/jobs.ts` — prose only, no logic change

- `buildBrowserBeeDesktopFallbackDescription()`'s doc comment and its "Note that this ran on the Desktop Lane fallback (local model)..." output-expectations bullet both say Claude instead.
- `resolveBrowserBeeBacking()`'s refusal-reason string ("...drive a real desktop browser with the local model instead") says Claude instead.
- Grep `local model` across this file to catch every instance.

### 3. `docs/BRINGUP-CHECKLIST.md:46`

*"enable the Desktop Lane fallback for local-only"* → wording that says the fallback runs on Claude via Desktop Lane (still opt-in, still lower reliability than Codex Computer Use, no longer "local-only").

### Non-goals / explicitly out of scope for this fix

- **No new approval-gating for credential entry via AX actions.** `executeDesktopBeeAction()` (`lane-tools.ts:1229-1252`) hardcodes `approved: true` for every dispatched action, and `desktop.ax.act`/`desktop.type` (policy tier) have no structural way to detect "this is a password field." This is a **pre-existing** gap — it was equally true when Qwen drove this path — not something this fix introduces or worsens. The task description already instructs the executor to stop and report rather than re-enter credentials (`jobs.ts:390`: *"Reuse an already-signed-in browser session... if login is required and no session exists, stop and report that human login is needed"*), which is prompt-level, not structurally enforced. Worth a dedicated hardening pass later (e.g., extending the `credential_fill` job-type refusal pattern from Q20 to AX-level actions); flagged here, not fixed here.
- **No cleanup of the other three now-dead `config.localModel` consumers** (`src/lib/config/providers.ts`'s BYO-local-model branch, `src/lib/connectivity/posture.ts`'s `localModelConfigured()`, `src/lib/orchestrator/subprocess.ts`'s `isLocalEndpointModel`/`ANTHROPIC_BASE_URL` redirect). All three are guarded by null checks and inert (harmless dead code, not blocking anything) — unlike the Browser Lane branch, they never throw. They're a legitimate Phase-5-completion item for the claude-native-cutover initiative, but touching `posture.ts` in particular ripples into user-facing capability-report copy (some of which — e.g. "Code-critical runs locally now" — looks independently stale in a way this design doc did not audit) and `subprocess.ts`'s model-dispatch routing, both wider blast radius than this bug fix warrants. Flagged for a separate, focused pass.
- **`scripts/desktopbee-proof.mts`** (the `hive-desktopbee-proof` skill) still imports the now-deleted `getQwenProfile()` — a same-family migration straggler in a proof script, not production code. Flagged, not fixed here.
- **`docs/MODEL-ROUTING.md`** describes a "primary/secondary local model" / "local-only macro posture" architecture that predates the cutover and looks stale end-to-end, not just around Browser Lane. A full audit is a separate documentation pass.

These four points are genuinely open for operator override: say the word and any of them can become a follow-up task.

## Verification gates

```
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

No `qwen-readiness.mts` gate — this touches Browser Lane / lane-tools only, not `src/lib/local-model/` or `qwen-profile.ts`.

## Note on process

Produced in a single unattended pass (no live back-and-forth) — flagged as a self-improvement task with an explicit "do not release, operator releases" boundary, consistent with prior autonomous work in this repo (2026-07-15 auto-enable design, 2026-07-16 Canopy-parity design). Every claim above is grounded in a direct file read (cited with paths/line numbers) or a targeted grep, not assumption. The model-tier choice (Approach C) and the four deferred items above are the points most worth a second look if this doesn't match operator intent.
