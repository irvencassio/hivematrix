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
- **Orchestration** (`src/lib/work-packages/orchestrate.ts`) — once an operator STARTS a package, ready items run in dependency order under the conservative concurrency rule (one non-worktree writer per repo); held release items stay final-gated. Two drivers: an event hook on PATCH /tasks/:id terminal transitions (fast path) and a lightweight reconcile loop (`startWorkPackageOrchestrationLoop`, 15s, wired in `src/daemon/index.ts`) that advances any `running` package even when a child completes outside the API. `planNextItems` is a pure, unit-tested eligibility planner. APIs: `POST /work-packages/:id/start` + `/advance`.

## Hive console

Next.js UI, client of the daemon. Centered shell: board left, session center, context/artifacts/brain right. Ships inside the signed .app (Tauri) from Phase 1.

## Model plane

- Frontier favorite: user-selectable; shipping default Claude (Q3)
- Qwen: primary host is this Mac (M5 Max, 128GB unified) via MLX-first serving, llama.cpp/GGUF fallback; LAN/public endpoints configurable (Q2). See QWEN-LOCAL-PROFILE.md.
- Image role: Nano Banana when cloud-ok; local MLX fallback (mflux — FLUX.2 Klein / Qwen-Image class) in local-only/offline (Q5)
- Router roles: think | execute | code-critical | image | cheap-web
- Frontier-review-debt queue for work executed locally during exhaustion

## Worker contract and harnesses

One worker contract. Three peer harnesses selected by routing policy:
- Claude Code
- Codex
- Qwen Code

Qwen-Agent: optional compatibility adapter only, never an orchestrator.

## Embedded capability + channel lanes

- Terminal Lane (`termbee`; Q10 contract) — persistent terminal sessions; Canopy-backed when Canopy's agent bridge is available (profiles/Keychain/approvals/logs), with HiveMatrix's in-process local shell kept as a local fallback; exposed to the agent as `termbee_session` / `termbee_run`.
- Browser Lane (`browserbee` + `webbee` compatibility ids) — one browser capability covering read-only fresh web retrieval and authenticated/stateful browser workflows; Keychain, sessions, reauth, and audit live here. Disabled for network work in offline mode.
- Desktop Lane (`desktopbee`; Q1 contract) — Swift helper daemon; AppleScript-first → AX semantic actions → vision last resort; approval-gated; audited.
- Message Lane (`messagebee`; Q8 channel) — SMS/iMessage in/out; reads ~/Library/Messages/chat.db (Full Disk Access) high-water-marked by ROWID, sends via osascript; allowlisted senders only; routes inbound to needs_input replies or new tasks.
- Mail Lane (`mailbee`; Q9 channel) — email watch + trust-gated drafting via Apple Mail (osascript; no IMAP/SMTP/OAuth). classifyMailTrust gates every inbound (prompt-injection + risky-attachment detection, trusted/external/suspicious); auto-send only for trusted senders, else draft-for-approval.
- Market Insight Lane (`traderbee`; Q11 lane) — market-data watch + threshold alerts. **Analysis & alerts ONLY — never places trades, never moves money.** Reads quotes from Alpaca's DATA API only (env-var keys `APCA_API_KEY_ID`/`APCA_API_SECRET_KEY`; the trading API is never called); a watchlist + alert rules (above/below/pct-move) evaluated on a poller → notify. Self-gates when keys absent.
- Voice Lane (`voicebee`; Q12 lane) — live voice ingress/egress on local models (configured STT command → Hive LLM → cloned-voice TTS via Pipecat); conversation mode (Mac/iPhone mic) + phone-answer mode (Twilio SIP trunk → local pipeline); voice notes/calls land as task artifacts. Local-first; the only external seam is the phone number. Video production (script→Remotion factory) is a no-brand capability, with an optional cloud avatar (HeyGen) used sparingly.
- Review Lane (`managerbee`) — control-plane heartbeat, routing/review diagnostics, escalations, approvals, and worker setup visibility.
- Memory Lane (`brainbee`) — brain index, lane playbooks, memory bundle assembly, and playbook hygiene.

## Internal subsystems (no public brand)

- Session/identity plane: SessionBroker, SessionStore (internal; no public brand)
- Updater: signed, notarized .app from day one (Tauri shell + Sparkle/Tauri-updater channel; no git-based updater, Q4); daemon-side migrate-backup-restart-probe-rollback with stable/beta rings

## Deferred from v1 (designs kept, no code)

- YouTube/import workflows (return as Browser Lane workflow recipes)
- Message Lane + Mail Lane are active; see Q8/Q9 + lanes above.
- Voice Lane is active; see Q12 + lane above.

## Standalone provider products (unchanged)

- Canopy
- Brainpower

## Memory plane

~/_GD/brain is canonical. No harness-side or Qwen-side shadow memory.
