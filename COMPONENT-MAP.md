# HiveMatrix Component Map (v2)

Date: 2026-06-11
Status: Canonical — enforced by CI scope-wall (see scripts/scope-wall.mjs)
Supersedes: Hive 1 component map

## Scope wall (enforced by CI)

- No new Bee brands. New capability ideas enter DECISIONS.md as proposals at phase boundaries.
- Forbidden in the codebase: Ideation, Goals (personal product surface), personal-task surfaces, Personal dashboard divider, Google model providers (exception: Nano Banana image action and mflux local fallback), AuthBee/Weaver as public brands, ComputerBee (renamed to DesktopBee — use DesktopBee everywhere), missions table/code (replaced by Directive primitive), TubeBee code. (VoiceBee un-deferred — see Q12 + lanes below.)
- Every checklist/task completion requires a named prover (test path, probe id, or artifact id) recorded in the verified-completion ledger.

## Hive daemon (headless, launchd, auto-updating)

Owns: tasks, directives + runs (long-horizon autonomy primitive, replaces missions), approvals, model router, connectivity policy (cloud-ok | local-only | offline), usage-window scheduler, mixed-mode role routing, memory bundle assembly, traces, artifacts, health, verified-completion ledger, updater. Scheduling/watchers live in directive triggerPolicy (no separate CronBee subsystem).

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

- TermBee (Q10; embedded) — persistent terminal sessions (real shells in-process, no node-pty/tmux dep); run/scrollback/kill; available in every connectivity mode (offline workhorse); exposed to the agent as termbee_session/termbee_run
- BrowserBee — one local browser controller; Keychain, sessions, reauth, audit
- WebBee — read-only public web; disabled in offline
- DesktopBee (Q1; ComputerBee name retired) — Swift helper daemon; AppleScript-first → AX semantic actions → vision last resort; approval-gated; audited
- MessageBee (Q8; channel) — SMS/iMessage in/out; reads ~/Library/Messages/chat.db (Full Disk Access) high-water-marked by ROWID, sends via osascript; allowlisted senders only; routes inbound to needs_input replies or new tasks (source: messagebee)
- MailBee (Q9; channel) — email watch + trust-gated drafting via Apple Mail (osascript; no IMAP/SMTP/OAuth). classifyMailTrust gates every inbound (prompt-injection + risky-attachment detection, trusted/external/suspicious); auto-send only for trusted senders, else draft-for-approval; tasks source: mailbee
- TraderBee (Q11; insight lane) — market-data watch + threshold alerts. **Analysis & alerts ONLY — never places trades, never moves money.** Reads quotes from Alpaca's DATA API only (env-var keys `APCA_API_KEY_ID`/`APCA_API_SECRET_KEY`; the trading API is never called); a watchlist + alert rules (above/below/pct-move) evaluated on a poller → notify. Self-gates when keys absent.
- VoiceBee (Q12; voice lane) — live voice ingress/egress on local models (configured STT command → Hive LLM → cloned-voice TTS via Pipecat); conversation mode (Mac/iPhone mic) + phone-answer mode (Twilio SIP trunk → local pipeline); voice notes/calls land as task artifacts. Local-first; the only external seam is the phone number. Video production (script→Remotion factory) is a **no-brand capability** (like the TubeBee→recipe pattern), with an optional cloud avatar (HeyGen) used sparingly — not a public Bee brand. See the voice/video persona plan in brain.

## Internal subsystems (no public brand)

- Session/identity plane: SessionBroker, SessionStore (internal; was AuthBee in Hive 1 — no public brand)
- Updater: signed, notarized .app from day one (Tauri shell + Sparkle/Tauri-updater channel; no git-based updater, Q4); daemon-side migrate-backup-restart-probe-rollback with stable/beta rings

## Deferred from v1 (designs kept, no code)

- TubeBee + import workflows (return as BrowserBee workflow recipes)
- (MessageBee + MailBee un-deferred — see Q8/Q9 + lanes above)
- (VoiceBee un-deferred — see Q12 + lane above)

## Standalone provider products (unchanged)

- Canopy
- Brainpower

## Memory plane

~/_GD/brain is canonical. No harness-side or Qwen-side shadow memory.
