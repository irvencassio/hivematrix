# Claude-Native Cutover — retire local Qwen, route every text role to Claude

**Date:** 2026-07-11
**Status:** Approved design — implement phase by phase
**Owner:** HiveMatrix core

## Goal

HiveMatrix abandons the local Qwen stack and becomes natively Claude-routed. Every
text-inference role resolves to the right Claude model, invoked through the existing
`claude` CLI (subscription OAuth — **no API key, no `@anthropic-ai` SDK**, ever):

| Role | Model | CLI alias |
|---|---|---|
| Thinking / reasoning (plan, review, architecture, deep-think) | Opus | `claude --model opus` |
| Coding (implementation, UI) | Sonnet | `claude --model sonnet` |
| Operational (bulk/ambient: day-brief, distill, ratchet, weaver-audit, loop-closer, learning-loop, persona-evolution) **and** interactive Flash chat | Haiku | `claude --model haiku` |

`opus` / `sonnet` / `haiku` are the CLI's version-agnostic aliases (see
`src/lib/models/catalog.ts:27-29`) — they always resolve to the latest model of the
tier, so nothing needs a version bump at model launches.

All local-Qwen machinery (rapid-mlx/LM Studio serving, provisioning, sampling knobs,
degeneration guards) is deleted. The chat degeneration guards exist only because a
4-bit local model loops; Claude does not degenerate that way, so they go too.

**Policy note (deliberate change):** `src/lib/models/chat-client.ts:1-13` carries a
"HARD CONSTRAINT: NO cloud LLM API keys, ever … Claude/Anthropic is intentionally
not invoked" header. That constraint was about API keys and keeping inference
on-box. The new operator policy is: **cloud inference via subscription-OAuth CLI is
allowed; API keys remain forbidden.** The comment must be rewritten in Phase 2 —
implementers must not "helpfully" preserve the old wording, and must not introduce
`ANTHROPIC_API_KEY` or the SDK anywhere.

## Architecture map (current state, verified)

- **Router:** `src/lib/connectivity/policy.ts:82` — `ModelRole = think | execute |
  code-critical | image | cheap-web | converse`; `:83` — `ModelTier =
  frontier-premium | frontier | local-primary | local-secondary | nanai |
  unavailable`. Role→tier maps at `:85-93` (cloud-ok) and `:98-105` (no-cloud).
  `resolveModelTier(role)` at `:192-198`.
- **Tier→model:** `src/lib/routing/model-resolver.ts:66-106` `resolveModelId()`.
  `frontier-premium` → `thinkModel` override else `CLAUDE_OPUS_ID`; `frontier` →
  `frontierModel` override else `CLAUDE_SONNET_ID`; `local-primary` →
  `getQwenProfile().primary.modelId` (`:88-91`); `local-secondary` →
  `operationalModel` override else Qwen secondary/primary (`:92-99`); `nanai` →
  `nano-banana`.
- **Role slots:** `src/lib/models/available.ts:281-292` `RoleModels
  {thinking, coding, operational, writer}` → config keys `thinkModel`,
  `frontierModel`, `operationalModel`, `writerModel` (`:388-392`); `getRoleModels()`
  `:360-369`; dropdown options `buildRoleModelOptions()` `:335-358`. Aliases
  `CLAUDE_OPUS_ID = "opus"` / `CLAUDE_SONNET_ID = "sonnet"` at `:18-19`. There is
  **no `CLAUDE_HAIKU_ID` yet**.
- **Claude CLI dispatch (coding harness):** `src/lib/orchestrator/subprocess.ts:301-346`
  `buildClaudeSpawnArgs()` → `claude -p <prompt> --output-format stream-json
  --verbose --allowedTools … --max-turns … [--model <id>] [--effort <level>]`;
  spawned at `:691`; parsed by `src/lib/orchestrator/stream-parser.ts`.
- **Haiku reference pattern:** `src/lib/orchestrator/intent-classifier.ts:113-148`
  already shells `claude -p … --model haiku --max-turns 1 --output-format text`
  (Sonnet retry at `:134`), using the CLI's own auth.
- **Flash chat (the big rewire):** `src/lib/flash/loop.ts` — `runFlashAgentLoop`
  (`:529-685`) reads `getQwenProfile().primary.{endpoint,modelId}` directly at
  `:536,568-573` (**bypasses the router**); `streamFromLocalModel` (`:268-379`)
  raw-fetch POSTs an OpenAI `/v1/chat/completions` SSE stream with OpenAI-shape
  `tool_calls` deltas; degeneration guards at `:26-165`
  (`isRepeatingTail`/`isRepeatingUnitCycle`/`isRepeatingWordTail`/`isOverReplyCap`
  + `collapse*`), applied at `:583-604` and `:628-630`. Callers:
  `src/daemon/server.ts:1186,1222`, `src/lib/flash/index.ts`,
  `src/lib/flash/heartbeat.ts`.
- **Operational seam:** `src/lib/models/chat-client.ts:30` `ChatComplete` interface;
  `localChatComplete()` `:45-81`. Injectable-default consumers:
  `src/lib/flash/day-brief.ts:129`, `src/lib/flash/ratchet.ts:94`,
  `src/lib/flash/weaver-audit.ts:88`, `src/lib/voice/loop-closer.ts:125,170`,
  `src/lib/models/deep-think.ts:136`, `src/lib/intake/enhance-prompt.ts:73`, plus
  learning-loop / persona-evolution. `src/lib/flash/distill.ts` uses
  `getQwenProfile()` directly (no seam yet — gets one in Phase 2).

---

## Phase 1 — Routing + role defaults (add Haiku, repoint operational tiers)

Lowest risk. Pure routing-table change; behavior only shifts for roles that used to
resolve to Qwen — and only where callers actually go through the router (the coding
harness already sends Claude models; Flash bypasses the router until Phase 3).

### Tier decision (DECIDED — one approach)

Retire `local-primary` and `local-secondary` and replace both with a single new tier
**`operational`**. Rationale: after the cutover there is no "local" hardware
distinction — primary vs secondary Qwen was a quality split inside one box; the new
world has exactly one cheap tier (Haiku). One tier, one resolver case, no dead
names left to confuse the next reader.

### Changes

1. **`src/lib/connectivity/policy.ts`**
   - `:83` — `ModelTier = "frontier-premium" | "frontier" | "operational" | "nanai" | "unavailable"`.
   - `:85-93` `ROLE_TIER_CLOUD_OK`: `execute → "operational"`, `cheap-web →
     "operational"`, `converse → "operational"`. `think`/`code-critical`/`image`
     unchanged. Update the `:91` comment (converse is no longer "local for
     latency"; it is Haiku for cost/latency, with Flash escalation unchanged).
   - `:98-105` `ROLE_TIER_NO_CLOUD`: **every text role → `"unavailable"`**
     (`image` already is). With Qwen gone there is no offline inference. This is a
     real behavior change: `local-only`/`offline` modes now mean "no text
     inference" — see Risks. Keep the map (one map for both modes, per the `:95-97`
     comment) but it becomes all-unavailable.
   - Sweep the capability matrix comments around `:70-79` (`flash: "local model
     only"`) — flash offline availability flips to `available: false, reason: "no
     cloud connectivity; Claude required"` in the `offline`/`local-only` rows.
2. **`src/lib/models/available.ts`**
   - `:18-19` — add `export const CLAUDE_HAIKU_ID = "haiku"; // alias → latest Haiku`.
   - `:335-358` `buildRoleModelOptions()`: add `const haiku = claude?.configured ?
     roleOption(CLAUDE_HAIKU_ID, "Claude Haiku", "claude", "fast/cheap — chat and
     ambient work") : null;`. Operational options become `[haiku, sonnet, spark,
     opus]` (Claude-first; local options removed here in Phase 5 — until then keep
     `localOptions` appended last so the UI doesn't break before Phase 4/5).
     Thinking/coding/writer rows gain `haiku` as a last-resort option.
   - `:272-292` — update the role-slot doc comment: `operational → operational tier
     → config key operationalModel (default Haiku)`.
3. **`src/lib/routing/model-resolver.ts`**
   - Replace cases `local-primary` (`:88-91`) and `local-secondary` (`:92-99`) with
     one `operational` case:
     ```ts
     case "operational": {
       const cfg = readConfig();
       const backends = options.frontierBackends ?? detectBackends();
       const op = (cfg.operationalModel as string | undefined)?.trim();
       if (op && modelSupportedByBackends(op, backends)) return op;
       if (backendConfigured(backends, "claude")) return CLAUDE_HAIKU_ID;
       // Codex-only installs: fall back to the cheap Codex pool rather than null.
       if (backendConfigured(backends, "codex")) return CODEX_SPARK_ID;
       return null;
     }
     ```
   - Drop the `getQwenProfile` import (`:16`) once no case uses it.
   - `:37-39` `isFrontierOverride` and `:56-60` `modelSupportedByBackends` already
     match `haiku$` — no change needed there.
4. **Grep sweep:** `rg -n '"local-primary"|"local-secondary"|local-primary|local-secondary' src`
   — every remaining reference (directive engine, task-model, tests, console
   payloads) must be updated to `operational` or deleted. Do this in the same
   commit; the string-union change makes tsc find most of them.

### Default role slots after this phase

Empty config values keep meaning "resolver default": `thinkModel` → `opus`,
`frontierModel` → `sonnet`, `operationalModel` → `haiku`, `writerModel` → `sonnet`
(writer-role resolution lives in `src/lib/models/writer-role.ts` — verify its
fallback chain no longer names a local model; if it does, repoint to
`CLAUDE_SONNET_ID`).

### Risk
- `ModelTier` is a shared string union — a missed consumer is a compile error
  (good) or a stale string literal in untyped console JS (bad). The grep sweep is
  mandatory, including `src/daemon/console.ts`.
- Codex-only installs (see memory: frontier tier alternates Claude/Codex): the
  `operational` fallback to `CODEX_SPARK_ID` keeps them alive.

### Verify
- `npm run typecheck` / `tsc --noEmit`; run `policy.test.ts`, `model-resolver`
  tests — update fixtures from Qwen ids to `haiku`.
- Runtime: `resolveModelId(resolveModelTier("converse"))` in a scratch script →
  `"haiku"` with Claude configured; `null` in offline mode.

---

## Phase 2 — Operational tasks → `haikuChatComplete`

Swap the operational-module default backend from local Qwen HTTP to a one-shot
`claude --model haiku` subprocess. The `ChatComplete` seam means callers and tests
are untouched except for the default.

### Changes

1. **`src/lib/models/chat-client.ts`**
   - Rewrite the header comment (`:1-13`): policy is "subscription-OAuth `claude`
     CLI only; no API keys, no SDK; requests go to Anthropic under the operator's
     subscription."
   - Add `haikuChatComplete: ChatComplete`, modeled on
     `src/lib/orchestrator/intent-classifier.ts:120-128` but **async**
     (`execFile`, not `execSync` — these run inside the daemon loop):
     ```ts
     export async function haikuChatComplete(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
       const binary = resolveClaudeBinary(); // same helper intent-classifier uses
       const model = opts.model && /^(opus|sonnet|haiku)$/.test(opts.model) ? opts.model : "haiku";
       const prompt = messages.filter(m => m.role !== "system").map(m => `${m.role}: ${m.content}`).join("\n\n");
       const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
       const args = ["-p", prompt, "--model", model, "--max-turns", "1", "--output-format", "text"];
       if (system) args.push("--append-system-prompt", system);
       // execFile with { timeout: opts.timeoutMs ?? 60_000, maxBuffer: 4 * 1024 * 1024 }
       // reject on non-zero exit / empty stdout; return stdout.trim()
     }
     ```
     Notes: the CLI has no `max_tokens`/`temperature` — `opts.maxTokens` and
     `opts.temperature` are accepted and ignored (keep the interface stable);
     raise the default timeout from `12_000` (`:32`) to `60_000` for CLI startup
     latency. Use argv arrays (`execFile`), never shell interpolation — prompts
     contain operator text.
   - `resolveCompletionClient()` (`:88-91`): return `haikuChatComplete` when the
     Claude backend is configured (`detectBackends()` from
     `src/lib/models/backends.ts`), else `null`.
   - `hasLocalCompletionModel()` (`:99-103`): rename to `hasCompletionModel()`
     (true when Claude CLI is configured). Update the one caller
     `src/lib/intake/enhance-prompt.ts:20`. The "free/offline" claim in its doc
     comment no longer holds — the new comment must say Haiku-metered, needs
     connectivity.
   - Keep `localChatComplete` in place until Phase 5 (Flash Phase 3 no longer uses
     it; deleting now would churn tests twice).
2. **Swap injectable defaults** from `localChatComplete` → `haikuChatComplete`:
   - `src/lib/flash/day-brief.ts:129`
   - `src/lib/flash/ratchet.ts:94`
   - `src/lib/flash/weaver-audit.ts:88`
   - `src/lib/voice/loop-closer.ts:125` and `:170`
   - `src/lib/models/deep-think.ts:136` — **exception:** deep-think is a
     *thinking* role; default its `complete` to a `ChatComplete` that passes
     `model: "opus"` through `haikuChatComplete`'s model passthrough (or add a
     thin `opusChatComplete` wrapper). Rewrite its `:19-24` "keyless + local-only
     by construction" comment.
   - `src/lib/intake/enhance-prompt.ts:73`
   - `src/lib/flash/learning-loop.ts`, `src/lib/flash/persona-evolution.ts` —
     same pattern (verify with `rg -n "localChatComplete|chatComplete:" src/lib/flash`).
3. **`src/lib/flash/distill.ts`** — currently calls `getQwenProfile()` directly.
   Refactor to accept an injectable `chatComplete: ChatComplete` defaulting to
   `haikuChatComplete`, matching its siblings. Delete its Qwen endpoint plumbing.

### Risk
- Latency: a `claude` process spawn is ~1–3 s vs a warm local HTTP call. All these
  modules are ambient/background (day-brief, distill, heartbeat-adjacent) — no
  interactive path regresses. Loop-closer texts back asynchronously; fine.
- Concurrency: several ambient tasks firing at once now spawn several CLI
  processes. Acceptable, but do not remove the per-module timeouts.
- Cost/usage window: Haiku calls draw on the Claude subscription pool; when the
  usage window is exhausted, `ConnectivityPolicy.onUsageWindowExhausted` flips mode
  to `local-only` → router returns null → ambient tasks should degrade to their
  existing "no model" fallbacks (they all have one — e.g. deterministic regex
  split per `chat-client.ts:84-87` comment). Verify each module's null path.

### Verify
- Unit: existing tests inject fake `chatComplete`s — they must pass unchanged.
  Add one test for `haikuChatComplete` arg construction (mock `execFile`).
- Real: `node -e` scratch invoking `haikuChatComplete([{role:"user",content:"say ok"}])`;
  then trigger a day-brief manually and confirm output + a `claude` process in `ps`.

---

## Phase 3 — Flash chat → Haiku via the Claude CLI (the hard one)

Rewire `runFlashAgentLoop` (`src/lib/flash/loop.ts:529`) to source tokens and tool
calls from `claude --model haiku --output-format stream-json` instead of
`streamFromLocalModel`. This is isolated to `flash/loop.ts` + one new file; the
exported signature (`runFlashAgentLoop(messages, emit, sessionId, brainRoot,
options)`) and all callers (`server.ts:1186,1222`, `flash/index.ts`,
`heartbeat.ts`) stay unchanged.

### Bridging decision (DECIDED — one approach)

**Expose the flash lane-tools to the CLI as an MCP stdio server and let the CLI's
native tool-calling drive them.** The alternative (keep the OpenAI-shaped loop and
only source tokens from the CLI) is not viable: a one-shot `claude -p` cannot emit
externally-executable OpenAI `tool_calls` — its tool_use events are only actionable
for tools the CLI itself can dispatch. MCP is the CLI's supported extension point.

**Key risk called out:** the tool-calling shape mismatch. Today the loop accumulates
OpenAI `delta.tool_calls` fragments by index (`loop.ts:354-366,605-614`), executes,
and appends `role:"tool"` messages (`:675`). The CLI world is: stream-json
`assistant` events containing `tool_use` blocks, dispatched by the CLI into the MCP
server, results returned by the MCP server — the loop never re-feeds tool results.
The bridge is: **tool execution moves into the MCP server process boundary; the
loop becomes a pure observer/renderer of the stream.**

### Changes

1. **New file `src/lib/flash/mcp-tools-server.ts`** — a stdio MCP server entrypoint
   (run as `node <bundle> --flash-mcp` or a dedicated script) exposing:
   - every lane tool from `availableLaneTools(policy)` (`loop.ts:544`), dispatching
     to `executeLaneTool(name, args, ctx)` (`:666`);
   - the flash-only tools `persona_update`, `deep_think`, `generate_avatar`,
     `escalate_to_task` (`FLASH_ONLY_TOOLS`, handlers at `:385-501`), with
     `deep_think` now routing to the Phase-2 Opus-backed deep-think.
   - The JSON-schema tool definitions already exist in OpenAI function shape;
     MCP `inputSchema` takes the same JSON Schema objects — reuse them verbatim.
   - **Gating:** the server receives the allowed-tool list (read-only pass vs full)
     via env/argv and enforces it at dispatch, mirroring the execution-time gate at
     `loop.ts:652-656`. `READ_ONLY_FLASH_TOOLS` (`:513-522`) stays the source of
     truth. Prompt-level gating alone is NOT acceptable (same rationale as the
     existing comment at `:508-512`).
   - The server also needs `ctx` (`projectPath`, `project`, `requestedBy` —
     `loop.ts:550-554`) and `brainRoot`, passed via env vars.
2. **Rewrite `runFlashAgentLoop` internals (`loop.ts:529-685`):**
   - Preconditions: replace the `getQwenProfile()` check (`:536-541`) with a
     Claude-backend check (`detectBackends()`); on failure emit "Claude CLI not
     configured — set it up in Settings → Models."
   - Build spawn args with `buildClaudeSpawnArgs()`
     (`src/lib/orchestrator/subprocess.ts:301-346`) or a thin flash variant:
     `-p <prompt> --output-format stream-json --verbose --model haiku
     --max-turns <MAX_TOOL_CALLS> --mcp-config <path-or-json>
     --allowedTools "mcp__flash__<t1>,mcp__flash__<t2>,…"` — the `--allowedTools`
     list is the *offer-time* gate (`options.allowedTools`, `:546-548`); the MCP
     server enforces the *dispatch-time* gate.
   - **History/prompt bridge:** FlashMessage[] history is OpenAI-shaped. For the
     first turn of a flash session, serialize system messages via
     `--append-system-prompt` and prior turns into the `-p` prompt. For subsequent
     turns in the same flash session, persist the CLI session id from the
     stream-json `system:init` event and pass `--resume <cliSessionId>` (pattern at
     `subprocess.ts:312-313`), keyed by flash `sessionId`. This replaces the
     manual `currentMessages` replay.
   - **Stream consumption:** reuse `src/lib/orchestrator/stream-parser.ts` to parse
     stream-json lines; map to the existing `FlashEmitter`:
     `assistant text delta → emit.token(...)`; `tool_use start →
     emit.toolStart(name, argsPreview)`; `tool_result → emit.toolResult(name, ok,
     preview)`; final `result` event → return the accumulated text. If
     stream-parser is coupled to orchestrator task events, extract its line-parsing
     core into a shared helper rather than duplicating SSE/NDJSON parsing.
   - **Budgets stay:** keep `MAX_TOOL_CALLS = 12` (as `--max-turns`) and
     `MAX_WALL_MS` (kill the child on expiry, emit the existing budget message,
     `:680-684`).
   - **Delete the degeneration machinery:** `REPEAT_LIMIT`, `sentenceUnits`,
     `isRepeatingTail`, `collapseRepetition`, `WORD_REPEAT_LIMIT`,
     `trailingWordCycle`, `isRepeatingWordTail`, `collapseWordRepetition`,
     `isRepeatingUnitCycle`, `collapseUnitCycle`, `isOverReplyCap` (`loop.ts:25-165`
     region), the in-stream checks (`:583-604`), the collapse-on-return (`:628-630`),
     and their unit tests. Claude does not word-loop; `maxReplyChars` sampling cap
     goes with the sampling settings (Phase 4/5).
   - Delete `streamFromLocalModel` (`:268-379`), `candidateUrls`/`normalizeEndpoint`
     (`:256-266`), the `SamplingParams` import (`:15`), and the `StreamEvent`
     OpenAI-delta types in `flash/types.ts` that nothing else uses.
3. **Escalation path check:** the Flash "escalates to frontier on depth>3" comment
   (`policy.ts:91`) and `escalate_to_task` keep working — escalated tasks go
   through the coding harness (Sonnet/Opus) as today.

### Risk (highest of the plan)
- MCP config/tool-name drift: `--allowedTools mcp__flash__*` naming must match the
  server's registered names exactly; a typo silently offers zero tools. Mitigate
  with an integration test that lists tools via the CLI (`claude mcp` tooling) or a
  smoke turn that calls `workflow_inbox`.
- Session resume semantics: `--resume` binds to the CLI's session store; if the
  id is lost (daemon restart), fall back to first-turn serialization. Store the
  mapping in the existing flash session state.
- Latency: first token now costs CLI startup (~1–2 s) vs local warm model. Emit an
  existing-style status event while waiting so the UI doesn't look dead.
- Voice: ALL voice routes through Flash lane-tools (memory: voice-loop-closer) —
  voice latency inherits the CLI startup cost. Test a voice round-trip explicitly.

### Rollback
Phase 3 is one commit touching `flash/loop.ts`, `flash/types.ts`, the new MCP file,
and tests. Revert restores the Qwen path *only if Phase 5 hasn't deleted
qwen-profile yet* — hence Phase 5 is last.

### Verify
- Unit: loop tests rewritten around a fake spawn (inject child-process like
  `subprocess.ts` tests do).
- Real: open Flash chat, ask a question requiring `brain_search` → tokens stream,
  tool start/result events render, reply completes. Run a heartbeat observe-only
  pass → confirm only `READ_ONLY_FLASH_TOOLS` are offered AND a forced write-tool
  call is rejected at the MCP server. Voice round-trip.

---

## Phase 4 — Settings UI: "Local Model" tab → Claude "Models" routing view

`src/daemon/console.ts` — the local-engine UI spans roughly `:5383` (render call),
`:5687` `renderLocalEngine`, `:6423,6476` `renderLocalEngineToggleRow`, and the
provision/sampling cards in the `~:6468-7045` region.

### Changes
1. Remove the Local Model tab/cards: engine status, provision flow, quant/tier
   pickers, sampling sliders (temperature/top_p/repetition_penalty/max_tokens —
   shipped 0.1.172, now dead), health/serving indicators.
2. Replace with a **Models** view showing per-role Claude routing, each row a
   dropdown fed by `buildRoleModelOptions()` (Phase 1 shape):
   - Thinking → default Claude Opus (`thinkModel`)
   - Coding → default Claude Sonnet (`frontierModel`)
   - Operational + Chat → default Claude Haiku (`operationalModel`)
   - Writer → default Claude Sonnet (`writerModel`)
   Each overridable to any configured option (other Claude alias, Codex when
   configured). Persist through the existing role-model set endpoint
   (`ROLE_CONFIG_KEY`, `available.ts:388-392`).
3. Strip local options from the dropdown builders (`localRoleOptions`,
   `available.ts:316-333`, and the `localOptions` spreads at `:352-356`).
4. Remove the console's daemon endpoints that only served the local-engine UI
   (provision/serving/sampling routes in `src/daemon/server.ts` — find with
   `rg -n "localEngine|provision|sampling" src/daemon/server.ts`).

### Risk
Console JS is untyped — stale element ids/routes fail at runtime only. Click
through every Settings tab after the change.

### Verify
Launch the app, open Settings → Models: three-plus role rows render with Claude
defaults; changing Operational to Sonnet writes `operationalModel: "sonnet"` to
`~/.hivematrix/config.json`; Flash chat picks it up on next turn.

---

## Phase 5 — Delete dead local-Qwen code + config migration

Only after Phases 1–4 are verified in real use (this phase makes rollback of 3
require a revert of 5 first).

### Cleanup manifest

**DELETE (files + their `.test.ts` siblings):**
- `src/lib/config/qwen-profile.ts` (+ `qwen-profile.test.ts`)
- `src/lib/models/local-engine.ts`, `local-presets.ts`, `local-quant.ts`,
  `local-tuning.ts`, `provision.ts`
- `src/lib/local-model/` — entire directory: `serving.ts`, `health.ts`,
  `context-governor.ts`, `fallback.ts`, `metrics.ts` (+ tests). Verify no
  survivor imports: `rg -n "local-model/" src`.
- `src/lib/orchestrator/qwen-code.ts` (Qwen-backed coding path)
- `localChatComplete` + local-URL helpers in `src/lib/models/chat-client.ts:34-81`
  (the `ChatComplete` type, `haikuChatComplete`, `resolveCompletionClient`,
  `hasCompletionModel` stay)
- Degeneration guards + `streamFromLocalModel` in `src/lib/flash/loop.ts`
  (already gone in Phase 3 — listed for completeness)
- Local-engine console UI (gone in Phase 4)

**MODIFY:**
- `src/lib/models/backends.ts` — drop the `local` backend detection/entry (Qwen
  profile-based); `BackendId` union loses `"local"`; sweep consumers.
- `src/lib/models/available.ts` — remove `SUPPORTED_LOCAL_TIER_PRESETS` /
  `LOCAL_MODEL_PRESETS` imports (`:12-13`), `localTierLabel/Note` (`:36-44`),
  `localModelFamily` (`:52-56`), `localRoleOptions` (`:316-333`), local picker
  plumbing.
- `src/lib/models/task-model.ts`, `task-display.ts`, `writer-role.ts` — remove
  local-model branches (find with `rg -n "qwen|local" src/lib/models`).
- `src/lib/voice/llm-env.ts` — remove Qwen endpoint/env wiring; voice uses the
  Flash lane (Phase 3) end to end.
- `src/lib/connectivity/policy.ts` — capability-matrix comments referencing the
  local model (`:70-79` region and the offline/local-only rows).
- `src/lib/embeddings/provider.ts` — **do not touch** (see Out of scope), but
  confirm it does not import `qwen-profile.ts`; if it does, inline its own config
  read before the delete.

**Config migration** (one-time, in the daemon's config-load path, logged once):
- Drop keys: `qwen`, `qwen.*` (including `qwen.sampling`), `localEngine`,
  `localEngine.*`, `localModel`.
- `operationalModel`: if set and NOT matching `isFrontierOverride`
  (`model-resolver.ts:37-39` regex — i.e. it names a Qwen/local id), reset to
  `""` (→ Haiku default). Same check for `thinkModel`/`frontierModel`/`writerModel`
  (a local override there now points at nothing).
- Write back atomically via `writeJsonAtomic` (`available.ts:10`). Old keys in an
  already-migrated config are a no-op. No downgrade path: a config rolled back to
  an old build simply re-provisions Qwen from scratch — acceptable.
- The `flash chat` sampling settings UI keys shipped in 0.1.172 die with
  `qwen.sampling`.

### Verify
`tsc --noEmit`; full test suite; `rg -in "qwen|lm studio|rapid-mlx|local-primary|local-secondary|localEngine" src`
returns only historical docs/comments that were deliberately kept; fresh-install
smoke run (rename `~/.hivematrix/config.json` aside) reaches chat via Haiku with
zero local-model prompts.

---

## Risk / rollback summary

| Phase | Blast radius | Rollback |
|---|---|---|
| 1 Routing | Compile-time mostly; offline modes lose text inference | revert commit |
| 2 Operational | Ambient tasks slower + metered; null-model fallbacks must hold | revert commit |
| 3 Flash | Interactive chat + voice; MCP bridge is new machinery | revert commit (requires Phase 5 not yet applied) |
| 4 Settings UI | Console only | revert commit |
| 5 Delete + migrate | Irreversible config migration; file deletes | revert commit + restore config backup |

Cross-cutting risks:
- **Offline/exhausted-usage behavior change (biggest product change):** today
  `local-only`/`offline` degrade to Qwen; after cutover they degrade to *nothing*
  for text roles. `ConnectivityPolicy` still flips modes on usage-window exhaustion
  (`policy.ts:151-156`) — callers must surface "Claude usage window exhausted /
  offline — try later or escalate to Codex" instead of silently failing. Decide in
  Phase 1 review whether `operational` should fall back to Codex Spark when
  Claude's window is exhausted (the resolver sketch above already allows it).
- **Cost:** everything ambient is now metered against the subscription. The Flash
  heartbeat and rituals cadence should be reviewed once real usage data exists —
  out of scope for this spec but flag it in the Phase 2 PR description.
- **No API keys:** any implementer reaching for `ANTHROPIC_API_KEY` or
  `@anthropic-ai/*` packages is off-spec. CLI subscription OAuth only.

## OUT OF SCOPE — keep as-is

- **Embeddings** (`src/lib/embeddings/provider.ts`, local Ollama qwen-embedding):
  the Claude CLI/subscription has **no embeddings endpoint** — there is no Claude
  equivalent to migrate to. The local embedding model stays; it is the one
  remaining on-box model and that is fine.
- **Image generation** (`nanai` tier → `nano-banana`,
  `model-resolver.ts:100-101`): Claude does not generate images; unchanged.
- **Codex provider alternation** (`frontierProvider`, `available.ts:261-270`;
  memory: frontier tier is sometimes Codex by usage window): untouched — Codex
  remains the alternate frontier and the operational fallback.
- **Coding harness dispatch** (`subprocess.ts`) — already Claude-native; only
  consumed, not modified (except any shared stream-parser extraction in Phase 3).
