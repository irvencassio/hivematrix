# HiveMatrix Component Map (v2)

Date: 2026-06-11
Status: Canonical — enforced by CI scope-wall (see scripts/scope-wall.mjs)
Supersedes: Hive 1 component map

## Scope wall (enforced by CI)

- No new public capability brands. New capability ideas enter DECISIONS.md as lane proposals at phase boundaries.
- Forbidden in the codebase: Ideation, Goals (personal product surface), personal-task surfaces, Personal dashboard divider, Google model providers (exception: Nano Banana image action and mflux local fallback), legacy auth/browser public brands, legacy desktop-control brand names, missions table/code (replaced by Directive primitive), and legacy YouTube-import component code. Voice Lane is active; see Q12 + lanes below.
- Every checklist/task completion requires a named prover (test path, probe id, or artifact id) recorded in the verified-completion ledger.

## Hive daemon (headless, launchd, auto-updating)

Owns: tasks, directives + runs (long-horizon autonomy primitive, replaces missions), Task Intake + Work Packages (preflight classification + staged multi-step parents; see below), approvals, model router, connectivity policy (cloud-ok | local-only | offline), usage-window scheduler, mixed-mode role routing, memory bundle assembly, traces, artifacts, health, verified-completion ledger, updater. Scheduling/watchers live in directive triggerPolicy (no separate scheduler-branded subsystem).

### Task Intake + Work Packages

- **Task Intake** (`src/lib/intake/classify.ts`) — a pure, deterministic, rule-first preflight that classifies every new task before it becomes a board task. Output: kind (normal_task | workflow | lane_task | work_package_candidate | held), risk, suggestedMode, project-collision recommendation, and a proposed-item decomposition. No live LLM in the MVP — models advise (later), HiveMatrix policy decides.
- **Work Package** (`src/lib/work-packages/`, tables `work_packages` + `work_package_items`) — the durable parent for a broad/multi-step prompt. Broad prompts are staged as a draft/held package with proposed child items instead of one messy task or an auto-running swarm. An operator explicitly converts an item into exactly one normal task. Same-repo non-worktree writer concurrency stays 1; parallel same-project work needs worktree-backing or read-only/safe scope. Release/deploy items are held (final-gated). Product copy: "Work Package" (not "macro task"). APIs under `/work-packages/*`; console panel in the Lanes tab (no run-all control).
- **Orchestration** (`src/lib/work-packages/orchestrate.ts`) — once an operator STARTS a package, ready items run in dependency order under the conservative concurrency rule (one non-worktree writer per repo); held release items stay final-gated. Two drivers: an event hook on PATCH /tasks/:id terminal transitions (fast path) and a lightweight reconcile loop (`startWorkPackageOrchestrationLoop`, 15s, wired in `src/daemon/index.ts`) that advances any `running` package even when a child completes outside the API. `planNextItems` is a pure, unit-tested eligibility planner. APIs: `POST /work-packages/:id/start` + `/advance`. Item execution is backend-agnostic — converted items are `executor:"agent"` / `agentType:"auto"`, so chatgpt/codex/qwen all execute them via the normal model router.
- **Routing control** (`POST /tasks` + New Task `Route` selector) — distinguishes *developing* a tool from *using* it. Auto routes by content, but a broad/multi-step prompt becomes a Work Package **even if it names a lane** (a bare mention or category tally like "Terminal Lane: 4" no longer hijacks the lane), and lane keyword routes require a real use-cue (use/run/ssh/via). The operator can override with an explicit route: `auto` | `work_package` (force orchestrate) | `terminal-lane` (force) | `normal` (plain task, no routing/intake). Forced Browser-Lane routing is a follow-up.
- **Model-advised decomposition** (`src/lib/intake/decompose.ts` + `src/lib/models/chat-client.ts`) — automatic and LOCAL-ONLY: on whenever a keyless local loopback model (Qwen/DeepSeek HTTP on 127.0.0.1) is configured, off otherwise (no setting). When a prompt is broad, the local model proposes cleaner step text via `classifyIntakeAsync`; offline / no local model / any failure → deterministic regex split. **No cloud LLM API keys, ever (no Anthropic, no OpenAI/ChatGPT key); Claude/Anthropic is never invoked and nothing leaves the machine.** The model only supplies step text — risk, the held release/deploy gate, dependency gating, and concurrency stay deterministic in `proposedItemsFromFragments`.

## Hive console

Next.js UI, client of the daemon. Centered shell: board left, session center, context/artifacts/brain right. Ships inside the signed .app (Tauri) from Phase 1.

## Model plane

- Frontier favorite: user-selectable; shipping default Claude (Q3)
- Qwen: primary host is this Mac (M5 Max, 128GB unified) via MLX-first serving, llama.cpp/GGUF fallback; LAN/public endpoints configurable (Q2). See QWEN-LOCAL-PROFILE.md.
- Image role: Nano Banana when cloud-ok; local MLX fallback (mflux — FLUX.2 Klein / Qwen-Image class) in local-only/offline (Q5)
- Router roles: think | execute | code-critical | image | cheap-web
- Frontier-review-debt queue for work executed locally during exhaustion
- **Deep Think** (`src/lib/models/deep-think.ts`) — test-time compute scaling on the keyless local model: N temperature-diverse parallel rollouts (thinking ON) → self-consistency agreement signal → list-wise synthesis → critique-revise only on disagreement; calibrated confidence out. Exposed as the flash `deep_think` tool for hard questions. Local-only by construction.

## Worker contract and harnesses

One worker contract. Four peer harnesses selected by routing policy:
- Claude Code
- Codex
- Qwen Code
- ds4-agent (`src/lib/orchestrator/ds4-agent.ts`) — DwarfStar's native DeepSeek coding agent, the lowest-latency local path (in-process KV-cache sessions, native tool handling, `/save`+`/switch` resume). **Opt-in and off by default** (config `ds4Agent.enabled`). DeepSeek-only with fixed, vertical tools that can NOT run the lanes (termbee/browserbee/vault), so routing selects it ONLY for autonomous DeepSeek coding tasks with no lane-tool needs (`ds4AgentEligible`); everything else — Qwen included — stays on the generic HTTP path. Runs worktree-sandboxed with the verification gate re-run post-hoc on the diff.

Qwen-Agent: optional compatibility adapter only, never an orchestrator.

## Embedded capability + channel lanes

- Terminal Lane (`termbee`; Q10 contract) — persistent terminal sessions; Canopy-backed when Canopy's agent bridge is available (profiles/Keychain/approvals/logs), with HiveMatrix's in-process local shell kept as a local fallback; exposed to the agent as `termbee_session` / `termbee_run`.
- Browser Lane (`browserbee` + `webbee` compatibility ids) — one browser capability covering read-only fresh web retrieval and authenticated/stateful browser workflows; Keychain, sessions, reauth, and audit live here. Disabled for network work in offline mode.
- Desktop Lane (`desktopbee`; Q1 contract) — Swift helper daemon; AppleScript-first → AX semantic actions → vision last resort; approval-gated; audited.
- Message Lane (`messagebee`; Q8 channel) — SMS/iMessage in/out; reads ~/Library/Messages/chat.db (Full Disk Access) high-water-marked by ROWID, sends via osascript; allowlisted senders only; routes inbound to needs_input replies or new tasks.
- Mail Lane (`mailbee`; Q9 channel) — email watch + trust-gated drafting via Apple Mail (osascript; no IMAP/SMTP/OAuth). classifyMailTrust gates every inbound (prompt-injection + risky-attachment detection, trusted/external/suspicious); auto-send only for trusted senders, else draft-for-approval.
- Market Insight Lane (`traderbee`; Q11 lane) — market-data watch + threshold alerts. **Analysis & alerts ONLY — never places trades, never moves money.** Reads quotes from Alpaca's DATA API only (env-var keys `APCA_API_KEY_ID`/`APCA_API_SECRET_KEY`; the trading API is never called); a watchlist + alert rules (above/below/pct-move) evaluated on a poller → notify. Self-gates when keys absent.
- Voice Lane (`voicebee`; Q12 lane) — live voice ingress/egress on local models (configured STT command → Hive LLM → Kokoro-voice TTS via Pipecat); conversation mode (Mac/iPhone mic) + phone-answer mode (Twilio SIP trunk → local pipeline); voice notes/calls land as task artifacts. Local-first; the only external seam is the phone number. (The video-production factory and its HeyGen avatar path were removed 2026-07-05 — voice is Kokoro-only, no video.)
- Review Lane (`managerbee`) — control-plane heartbeat, routing/review diagnostics, escalations, approvals, and worker setup visibility.
- Memory Lane (`brainbee`) — brain index, lane playbooks, memory bundle assembly, and playbook hygiene.

## Flash Lane (`flash`; P1.1 — M1)

Native ad-hoc conversational agent loop — the replacement for the OpenClaw chat dock.

- **Session store** (`src/lib/flash/store.ts`, tables `flash_sessions` + `flash_turns`) — per-channel-peer session scoping; same iMessage sender resumes their session; console + voice share one operator session when peer is `"operator"`.
- **Context assembly** (`src/lib/flash/context.ts`) — system prompt built from persona files (`<brainRoot>/persona/`), today's daily note, rolling session summary, and `brain_search` results for the current text.
- **Agent loop** (`src/lib/flash/loop.ts`) — streams LM Studio (Qwen) via OpenAI-compatible SSE; executes lane tools + two flash-only tools (`persona_update`, `escalate_to_work_package`); budget: 12 tool calls / 3 min.
- **Routing role** — `converse` (resolves to `local-primary` in all connectivity modes).
- **Capability gate** — `flash` (available in all three connectivity modes; cloud-dependent tools degrade within the loop per their own gates).
- **Endpoints** — `POST /flash/turn` (SSE stream: `token`, `tool_start`, `tool_result`, `escalated`, `done`), `GET /flash/sessions`, `GET /flash/sessions/:id/turns`, `POST /flash/turns/:id/feedback`.
- **Eval** — bad turns auto-appended to `eval/flash-parity/prompts.jsonl` as regression cases.
- **Learning loop** (`src/lib/flash/distill.ts`, `src/lib/flash/learning-loop.ts`) — polls every 15 min; distills sessions cold for 6h (no activity + not yet distilled). Cheap local-model pass extracts reusable how-tos into skills (`upsertSkill`, dedupe/refine on re-distillation), files failures/friction/gaps into the feedback backlog (`recordFeedbackDedup`), appends notable events to `<brainRoot>/persona/memory/YYYY-MM-DD.md`, and — operator-peer sessions only — merges durable operator facts into `persona/USER.md` and stated goals into `persona/GOALS.md` (dated/deduped/bounded; announced via `flash:persona_updated`). DB column `flash_sessions.distilledAt` prevents re-distillation across daemon restarts. The same loop also runs two slow anticipatory passes: **pattern detection** (`src/lib/feedback/pattern-detection.ts`, daily) clusters the recurring backlog into deduped "fix the root cause" enhancement proposals; **persona evolution** (`src/lib/flash/persona-evolution.ts`, weekly) synthesizes bounded SOUL.md operating notes from chronic friction, applied-and-announced under autonomous / proposed otherwise. Wired in `src/daemon/index.ts`.
- **Heartbeat** (`src/lib/flash/heartbeat.ts`; W8 presence layer) — config-gated unprompted pulse: every N min (default 30, quiet-hours aware) one flash turn over `persona/HEARTBEAT.md` (seeded on first enable) + a `composeBriefing()` status snapshot; stands down silently (`HEARTBEAT_STAND_DOWN`) unless something warrants attention. Autonomy dial shapes each pass (manual observe-only → autonomous acts inside existing lane gates, no extra approvals). Daily moments ride the same loop: persona-voice morning brief + evening recap (APNs-first, notify fallback) — replaces the retired Morning Briefing brand without resurrecting it. Reports land as replyable operator-session turns. Delivery deps daemon-injected. Endpoints: `GET/POST /settings/heartbeat`, `POST /heartbeat/run`.
- **Scope** — flash/ may import routing/, orchestrator/, brain/, skills/, db/. Only daemon/ may import flash/.

## Credential Vault (`vault`; P2.2)

macOS Keychain-backed secret store with `vault://` ref addressing.

- **Keychain layer** (`src/lib/vault/keychain.ts`) — macOS `security` CLI wrapper; service `hivematrix-vault`; account key `<scope>/<name>`.
- **Ref system** (`src/lib/vault/refs.ts`) — `VaultRef = vault://<scope>/<name>`; `isVaultRef`, `makeRef`, `parseRef`, `describeRef`. Refs are safe in prompts, task payloads, SSE events, and audit logs.
- **Store** (`src/lib/vault/store.ts`) — `VaultStore`: set/get/delete/list backed by Keychain + a SQLite `vault_refs` index (metadata only, never values).
- **Resolution** — `resolveVaultRef(ref)` resolves a ref to its plaintext value. **Call only from lane execution code** (browser-lane login fill, terminal-lane host auth, config secrets). Never pass the resolved value to a model, SSE event, or audit log.
- **Import restrictions:** only `src/lib/browser-lane/`, `src/lib/terminal-lane/`, `src/lib/config/`, and `src/daemon/` may import `@/lib/vault`. vault/ must NOT import from orchestrator/.
- **Endpoints** — `GET /vault/refs`, `POST /vault/refs`, `DELETE /vault/refs/:scope/:name` (values never returned).
- **Secrets registry** — `src/lib/config/secrets.ts` accepts `vaultRef` alongside `env` on each `SecretSpec`; `secretStatuses()` reports `source: "env" | "vault" | null`.

## Packs (`packs`; M4)

Installable outcome packs that deliver a job end-to-end.

- **Pack format** — a signed Ed25519 tarball (`.hmpack`) containing `manifest.json` `{name, version, description, tier, requires: {lanes, permissions}, directives, skills, dashboardCard, uninstall}` + skill markdown files + directive templates (JSON matching the Directive primitive) + optional persona/HEARTBEAT.md additions.
- **Signing** — Ed25519 (third keypair, operator-held). Daemon refuses unsigned packs. No open marketplace; first-party packs only at launch. Third-party skills imported individually remain `trusted:false` until operator approval (existing mechanism).
- **Lifecycle** (`src/lib/packs/`) — install, list, uninstall; uninstall removes its directives/skills/config cleanly and leaves artifacts/brain docs in place; pack directives appear in the normal directive UI, tagged with the pack name.
- **Dashboard cards** — each pack registers one console card (and companion equivalent) summarizing its job: counts, last run, money/time metrics where applicable, pending approvals. Schema: `{title, metrics[], cta}` — rendered generically so new packs need no app update.
- **Bundled packs** — Support Inbox (P4.2a), Chief-of-Staff (P4.2b), Content Engine (P4.2c), Dev Copilot (P4.2d).
- **Import restrictions:** only `src/daemon/` may import `@/lib/packs`. packs/ must NOT import from orchestrator/.

## Internal subsystems (no public brand)

- Session/identity plane: SessionBroker, SessionStore (internal; no public brand)
- Updater: signed, notarized .app from day one (Tauri shell + Sparkle/Tauri-updater channel; no git-based updater, Q4); daemon-side migrate-backup-restart-probe-rollback with stable/beta rings
- **Trust ramp** (`src/lib/approvals/trust-ledger.ts`) — adaptive layer over the autonomy dial. Per action class, records operator approve/deny history; under `autonomous` a class with ≥3 clean approvals + 0 denials auto-approves (no toggle), a denial revokes it. Hard floor: only `checkpoint`/`lowRiskTool` are ever trust-eligible — content/external/risky-tool/stuck/protected NEVER auto-approve at any trust level. Wired into `orchestrator/approval.ts` (record on `resolveApproval`, consult in `maybeAutoApproveRequest`, `auto_approved` audit). Endpoints `GET /trust`, `POST /trust/reset`.
- **Capability self-assessment** (`src/lib/feedback/capability-gaps.ts`) — mines the backlog for missing-capability friction, classifies the remedy (skill|lane|pack|unknown) + self-serviceability, files labeled proposals. Proposing is free; acquiring is gated — only first-party skills are self-serviceable (already auto-distilled); lanes/packs always need operator approval, even under autonomous. Never installs/enables anything. Runs daily in the flash learning loop.

## Deferred from v1 (designs kept, no code)

- YouTube/import workflows (return as Browser Lane workflow recipes)
- Message Lane + Mail Lane are active; see Q8/Q9 + lanes above.
- Voice Lane is active; see Q12 + lane above.

## Standalone provider products (unchanged)

- Canopy
- Brainpower

## Memory plane

~/_GD/brain is canonical. No harness-side or Qwen-side shadow memory.
