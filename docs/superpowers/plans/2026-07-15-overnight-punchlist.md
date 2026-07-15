# Overnight Punch List — 2026-07-15

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

Source: `~/_GD/brain/2026-07-14-tools-skills-reachability-run-pills-spec.html` (deferred console spec)
+ memory `overnight-audit-2026-07-14` (ranked findings across console sidebar, voice pipeline,
autonomy/self-evolving — produced by the prior session tonight, which spent its $10 budget on
research and stopped before writing code). Verified against HEAD `58323407` — unchanged since
that audit, all citations trusted without re-derivation.

Operator ask (paraphrased): implement the reachability spec, enhance the voice pipeline across
hivematrix/iOS/Android, push autonomy/self-evolving further, simplify the left/right console
sidebar. Budget-capped session (`--max-budget-usd 10`); prioritize leverage-per-dollar, defer
low-rank items rather than going shallow on everything.

## Wave 1 — isolated, testable, low blast-radius (parallel)

1. **[HIGH] Voice: dead local-Qwen path in `/voice/turn` audio branch** — `server.ts:3402` calls
   `relayTurn()` → sidecar `_one_turn()` → deleted local-Qwen `llm.py:936`. Swap to
   `relayTranscribe()` (already used by `/voice/transcribe`), matching its `text = await
   relayTranscribe(audioB64, lang)` shape. Android's audio path is next up per
   `docs/companion-ports/MASTER-PLAN.md` — this must land before that lands.
2. **Autonomy: self-improvement directive never auto-installed** — `buildSelfImprovementDirective()`
   (`self-improvement.ts:98`, guard `isSelfImprovementDirective` at `:83`) is reachable only via
   `POST /feedback/maintenance-directive`, zero callers. Auto-install at boot in `daemon/index.ts`
   next to `rearmStaleRecurringDirectives()` (~line 106), same guarded/idempotent pattern.
3. **Voice: approval disambiguation dead-ends on bare ordinal replies** — `command-intent.ts:335,339`
   require the verb (`deny|reject|...`, `approve`) in the same utterance; a bare "the second one"
   reply to a pending disambiguation (`disambiguationReply` in `command-turn.ts`) never resolves.
   Fix: when context holds a pending approve/deny disambiguation, a bare ordinal/matchText-only
   utterance completes it using the remembered verb.
4. **iOS voice robustness** — `LiveVoiceView.swift:124` no reconnect/backoff on network drop
   (silent dead call in the eyes-free/driving case); `VoiceTalkView.swift:276`
   `APIClient.voiceTurn(audio:)` fully built, zero call sites — wire as `SFSpeechRecognizer`
   failure fallback.
5. **Android voice robustness** — `TalkViewModel.kt:300-323` decode+write+`MediaPlayer.prepare()`
   on the main thread (ANR risk on long replies); `TalkScreen.kt:71-82` speech intent has no
   `resolveActivity()` guard (crashes on GMS-less devices).

## Wave 2 — console sidebar simplification (sequential, same file)

Ranked order from the audit (cheapest first); `skDetail` right-rail slot already retired
(console.ts:3853, since 2026-06-29) so this is additive simplification, not a rewrite.

6. Give Observability a left-nav button — today `updateObsNav()` (~console.ts:3133) is a
   deliberate no-op ("obs has no left-nav button; opened from the right rail"). Mirror the
   `goalsNav` pattern exactly: button `id="obsNav"` after `goalsNav` (console.ts:1777), add
   `obsNav: _obsState.panelOpen` to `syncNav()`'s `active` map (console.ts:2095-2108), point
   `updateObsNav()` at `syncNav()` like `updateOverviewNav()` does.
7. Delete dead functions `libDetailHtml` (console.ts:3872) and `localDetailHtml` (console.ts:3896)
   — zero callers, leftover from the `skDetail` retirement.
8. Promote Scheduled/directives (`dirSec`, console.ts:1864-1921, ~58 of the right rail's ~84
   template lines) to its own left-nav button + center screen, mirroring how Goals was already
   promoted (`showGoals`/`goalsNav`/`_goalsState`).

## Deferred (ranked below the cut line tonight — leave for a future session)

- Reachability spec Path A (badges + pill adapter) + folding Skills&Commands rail / MCP Servers
  into their center screens + 2-col catalog migration — bigger feature work; attempt only if
  Wave 1+2 land clean and budget remains (see memory `tools-skills-reachability-spec` for the
  full recommended design).
- Voice pipeline items #7-10 from the audit (barge-in/cancel intent, PIM logic dedup, intent-miss
  telemetry, Watch banner-removal verification) — lower rank, not urgent.
- Autonomy fix #2 (surface `GET /feedback`/`loop-health` in console) — paired with the Tools panel
  work, deferred alongside it.

## Verification gate (every wave, before commit)

`npm run typecheck` · `npm test` · `node scripts/scope-wall.mjs` — per `AGENTS.md`. Swift/Kotlin
changes verified by their own toolchain (xcodebuild/gradle) where feasible; state explicitly if a
live device/simulator check wasn't possible. No new persistent store/orchestration primitive/
product concept in any of the above — all are surgical fixes to existing surfaces.
