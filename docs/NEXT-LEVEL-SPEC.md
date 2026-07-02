# HiveMatrix Next Level — Development Kickoff Spec

**Date:** 2026-07-02
**Status:** Approved direction (operator Q&A 2026-07-02); ready for work-package intake
**Companion doc:** `~/_GD/brain/projects/hive/2026-07-02-hivematrix-next-level-overview.html` (strategy/competitive overview)
**Supersedes in part:** `2026-07-01-openclaw-deployment-roadmap.html` (OpenClaw becomes an interim bridge, not a strategic layer — see Workstream A)

---

## 1. Product thesis

HiveMatrix becomes the **trustworthy autonomous operator for one person's business and life**: a signed, notarized Mac app + companion apps that run terminal, browser, mail, message, desktop, and voice sessions for AI agents — with credentials held in the app (never in prompts), keyless multi-model routing (ChatGPT/Codex CLI, Claude Code CLI, local Qwen) including fully offline, and max-autonomy operation with a flight recorder instead of constant approval friction.

One-line positioning: **"OpenClaw, but trustworthy and finished."**

Target customer (decided): **personal/prosumer, free + paid tiers.** Not teams, not hosted. Team/multi-tenant is explicitly out of scope (would require schema-level rearchitecture; revisit only on demand evidence).

Autonomy posture (decided): **max autonomy by default, minimal gates**, with a Settings toggle for a supervised/approval mode per user preference, plus non-negotiable safety rails (§ W3) that exist in both modes.

Model posture (decided): **keyless only.** Claude joins via the Claude Code CLI on a Claude subscription — same pattern as the Codex CLI backend. No Anthropic/OpenAI API keys stored or required. Local Qwen (LM Studio/MLX) remains the offline floor.

---

## 2. The gap this spec closes (brutal version)

1. **Ad-hoc dispatch is the product gap, and today it is outsourced to OpenClaw.** iOS Talk currently posts to `/openclaw/chat/send`. The operator's own observation: "OpenClaw is more capable of handling ad-hoc questions/tasks… it's not a problem of the channel, it's the back end figuring out what to do autonomously." Every HiveMatrix request goes through intake → task → routing → subprocess spin-up ceremony; there is no fast conversational agent loop with tools. That loop is the core of the product and cannot live in a third-party gateway with 138 CVEs that shipped its own iOS+voice app on 2026-06-29.
2. **Voice — the lowest-friction interface — is the least finished piece.** iOS has a Pipecat WebRTC client (`LiveVoiceView.swift`) and the daemon has `/voice/rtc/*` contracts, but the Mac-side sidecar runtime isn't wired; the shipping voice path is push-to-talk → text → OpenClaw.
3. **Nobody can buy this.** Personal Apple team (8B3CHTY93V), no license/paywall, no privacy policy, onboarding assumes a developer. The engineering (signed updater, daemon, lanes) is commercial-grade; the packaging is not.
4. **"Replaces a team" is a capability claim, not a product.** HiveMatrix sells lanes (terminal, browser, mail); customers buy jobs (support inbox handled, content shipped, code reviewed). Competitors (Sintra $97/mo "12 AI employees") package jobs.
5. **The security story is strong but unproven.** "Credentials never in prompts" is architecture today and marketing tomorrow — only if there are automated leak tests, a threat model doc, and eventually an external audit to point at.

---

## 3. Workstreams

### W1 — Flash Lane: native ad-hoc agent loop (P0, the centerpiece)

**Goal:** any request from voice, iMessage, mail, or the console gets an immediate, conversational, tool-using agent response — OpenClaw-grade ad-hoc competence, natively — escalating to Work Packages/Directives only when the job is genuinely long-horizon.

**New component:** `src/lib/flash/` (requires COMPONENT-MAP entry + scope-wall amendment).

**Architecture:**

- **Session model.** Tables `flash_sessions` (id, channel, peer, createdAt, summary, lastActiveAt) and `flash_turns` (sessionId, role, content, toolCalls, artifacts, ts). Session scope is **per-channel-peer** (mirror OpenClaw's proven default): the same iMessage sender resumes their session; the console and voice share one operator session per profile.
- **Dispatch path.** `POST /flash/turn` `{sessionId?, channel, peer, text, attachments?}` → SSE stream of `token`, `tool_start`, `tool_result`, `escalated`, `done` events. This is a **new in-daemon loop**, not a task: no intake classification, no subprocess spin-up, no scheduler tick.
- **Agent loop.** Iterative model ↔ tool loop inside the daemon process:
  1. Build context: rolling turn window + session summary + skills index + `brain_search` retrieval on the query.
  2. Call model with the full bee-tool set (`termbee_run`, `browserbee_run`, `desktopbee_action`, `mailbee_send`, `messagebee_send`, `brain_search`, `code_graph`, `digest_url`, `skill_used`) — same connectivity gating and trust gates as today (`src/lib/orchestrator/lane-tools.ts` is the reuse point).
  3. Execute tool calls inline, feed results back, iterate up to a per-turn budget (default 12 tool calls / 3 min wall clock).
  4. Stream text to the caller as it arrives.
- **New routing role `converse`** in `src/lib/routing/router.ts`: latency-optimized. Default `local-primary` (Qwen) for instant response; escalate the *same turn* to `frontier` when the model signals complexity or tool-call depth > 3 and connectivity policy allows. Offline: stays local, never blocks.
- **Escalation contract.** When the loop judges the job long-horizon (needs a worktree, multi-repo, >N minutes, provable criteria), it calls a new internal tool `escalate_to_work_package` → creates the work package via existing intake (`src/lib/intake/classify.ts`), replies "started X, I'll report back," and the existing result loop (generalize `voice-result-loop.ts` → `flash-result-loop`) posts completion back to the originating session/channel.
- **Channel unification.** Message Lane and Mail Lane route allowlisted-sender turns into flash sessions (replacing direct task creation for conversational messages); trust classification unchanged. iOS `VoiceTalkView` and Talk UI switch from `/openclaw/chat/send` to `/flash/turn`.
- **OpenClaw bridge.** Keep `/openclaw/chat/*` endpoints behind a feature flag `openclaw.bridge` (default **on** at M1, **off** at M2). Explicit "ask OpenClaw …" prefix still forwards while the flag is on. No new OpenClaw surface area.

**Acceptance criteria:**
- Parity eval: a fixed set of ≥30 real ad-hoc prompts (harvested from OpenClaw chat history — `GET /openclaw/chat/history`) runs through Flash Lane; operator grades ≥90% as "as good or better than OpenClaw."
- First streamed token < 2s local model, < 4s frontier (warm).
- A turn that triggers `mailbee_send` to a trusted contact completes end-to-end with no approvals in full-autonomy mode, and appears in the audit log.
- A "build me X" prompt escalates to a work package and the completion report arrives back on the originating channel unprompted.
- 0 regressions: `npm run typecheck && npm test && npm run scope-wall` green; new tables migrate cleanly.

### W2 — Voice runtime: wire the sidecar end-to-end (P0)

**Goal:** hands-free, sub-1.5s-to-first-audio conversation on Mac and iPhone, feeding Flash Lane.

- **Sidecar process.** Daemon-managed Pipecat subprocess (spawn/health/restart via the launchd-style supervision already used for helpers). Pipeline: WebRTC in → STT → `POST /flash/turn` (streaming) → **Kokoro-82M TTS** (already validated ~1s turns per 0.1.53–0.1.56 work) → WebRTC out. Sentence-level TTS streaming: speak the first sentence while the rest generates.
- **STT:** whisper.cpp (local, offline-capable) on Mac; iOS keeps on-device Apple Speech for push-to-talk. Live Voice (Pipecat WebRTC) does STT daemon-side so both platforms share one pipeline.
- **Endpoints:** finish `/voice/rtc/offer` + `/voice/rtc/config` (contracts exist; implement against the sidecar). Barge-in via Pipecat interruption handling.
- **Wake word:** deferred (Phase 2+). Push-to-talk and open-mic Live Voice are the MVP surfaces.
- **Persona:** operator-cloned voice remains the Phase-2 option (VoxCPM per voice strategy memory); Kokoro is the shipping default.

**Acceptance:** round-trip "what's on my board?" voice → spoken answer < 3s total on M-series; barge-in interrupts TTS < 300ms; works with connectivity policy `offline` (Qwen + whisper.cpp + Kokoro all local); iOS `LiveVoiceView` connects to the real pipeline on a physical device.

### W3 — Autonomy rails: max autonomy with a flight recorder (P0)

**Goal:** honor the "max autonomy, minimal gates" decision without shipping the failure mode that kills products in this category (one bad autonomous action → uninstall).

- **Modes:** `full` (default) and `supervised` (outward actions queue for approval — reuse existing approval queues). Global toggle in Settings + per-lane overrides (e.g., full autonomy everywhere but mail = supervised).
- **Non-negotiable rails present in BOTH modes:**
  - **Audit everywhere:** every lane action already lands in the JSONL audit log; surface it as a first-class "Activity" timeline in console + iOS (what was done, on whose request, with what tool, diff/artifact links).
  - **Rate caps:** configurable ceilings — outbound mail/hr, messages/hr, per-day totals. Defaults generous (not friction), but a runaway loop can't send 500 emails.
  - **Protected actions list:** payments/purchases, credential mutations, bulk deletions (termbee destructive-command classifier: `rm -rf`, `git push --force` to main, disk-level ops) always require approval regardless of mode. Small, fixed, documented list.
  - **Kill switch:** one tap on iOS/watch pauses all lanes, directives, and flash sessions (`POST /system/pause`). Big red button.
- **Trust ramp (optional polish):** per-contact/per-site trust earned from approved history — supervised mode auto-relaxes for repeatedly-approved action patterns.

**Acceptance:** flipping supervised→full mid-session changes behavior without restart; caps trip and notify rather than silently dropping; kill switch halts a running termbee command < 2s; audit timeline shows a complete story for a full-autonomy day.

### W4 — Credential vault: make "never in prompts" a provable guarantee (P1)

**Goal:** unify today's scattered good behavior (Keychain browser logins, env-var registry, mode-600 tokens) into one vault with an enforced, tested guarantee.

- **New component `src/lib/vault/`:** Keychain-backed secret store; secrets addressed by ref (`vault://github/pat`, `vault://site/stripe.com`). Lanes resolve refs at execution time only; models see refs, never values. (This is OpenClaw's SecretRef idea, done natively and by default.)
- **Migrate:** browser-lane login profiles, terminal-lane host credentials (the deferred ADO/SSH Keychain work), X/YouTube/Alpaca keys out of env vars.
- **Redaction filter:** transcript/audit/SSE output scanner that replaces any stored secret value with its ref if a tool ever echoes one (e.g., `cat .env` in termbee).
- **Leak test in CI:** automated test seeds canary secrets, runs representative lane flows, asserts canaries never appear in prompts, transcripts, audit logs, or SSE streams. This test is the marketing claim.

**Acceptance:** `secrets audit`-style command reports zero plaintext secrets outside Keychain; CI leak test green; browser lane completes a login using a vault ref end-to-end.

### W5 — Commercial packaging: make it buyable (P1)

**Goal:** free + paid prosumer product a stranger can install, trust, and pay for.

- **Tiers:**
  - **Free — "Local":** local models only (offline connectivity policy), terminal + browser + desktop lanes, console UI, no channels, no voice, single profile. Genuinely useful; the privacy-first hook.
  - **Pro — $39/mo or $349/yr (flat, no credits):** all lanes and channels (mail, iMessage/SMS, voice), cloud model routing (user's own ChatGPT/Claude subscriptions — we never meter tokens), directives/scheduling, iOS/watch/glasses companions, signed skill packs.
  - Anchor message vs. every metered competitor: *"No credits. No per-task fees. It runs on your Mac."*
- **Licensing:** signed local license file (reuse the Ed25519 pattern from the updater), Stripe or Lemon Squeezy checkout, offline grace period ≥30 days. Enforcement points: channel lane enablement + voice + companion pairing.
- **Onboarding wizard (first-run, in console):** guided checklist — permissions (Full Disk Access, Accessibility, Automation), model backend detection (Claude Code CLI / Codex CLI / LM Studio with install links), voice test, iOS pairing QR, autonomy mode choice. Target: zero terminal commands for a non-developer.
- **Distribution:** Apple **organization** developer account (blocker: personal team 8B3CHTY93V cannot ship the iOS app publicly); App Store submission for iOS (privacy policy, support page, review demo video + demo daemon); Mac app stays direct-download DMG + signed auto-update (already production-grade); marketing site with downloads (extend the irvcassio.com / app-downloads pipeline).
- **Telemetry:** opt-in only, anonymous (version, crash reports, feature counters). Privacy story is the moat; don't undermine it.
- **iOS hardening for review:** move SSE auth from `?token=` query param to short-lived signed tokens or `Last-Event-ID`-compatible header transport (query-param bearer tokens leak into logs); add conversation history to Talk; graceful offline states.

**Acceptance:** a fresh Mac + iPhone owned by a non-developer goes from download → paired → first voice task in <15 minutes with no terminal; Stripe test purchase unlocks Pro; App Store build passes review in TestFlight external testing first.

### W6 — Outcome packs: sell jobs, not lanes (P2)

**Goal:** make "replaces a team" concrete. Each pack = a curated bundle of directives + skills + lane configs + a dashboard card, installable in one click.

- **Support Inbox pack:** mail+iMessage triage, trust-gated auto-replies for known senders, draft-for-approval for new senders, daily digest.
- **Content Engine pack:** research → draft → (existing) video factory → post via X keys / Browser Lane; editorial calendar directive.
- **Dev Copilot pack:** repo watch, issue triage, PR review via Claude Code CLI, test-and-release runbooks (release skill already exists).
- **Personal Chief-of-Staff pack:** morning briefing (APNs — already live), calendar/reminders via Desktop Lane, travel/errand browser workflows.
- **Skill pack security (anti-ClawHavoc):** no open marketplace. Packs are **signed with the updater key**, first-party only at launch; imported third-party skills remain `trusted: false` sandboxed-until-approved. This is a headline differentiator, not a limitation.

**Acceptance per pack:** installable/uninstallable cleanly; runs 7 days of dogfood producing its dashboard card; documented in a user-guide brain doc.

### W7 — Model routing polish (P2, small)

- Add **Claude Code CLI keyless** as a first-class frontier backend alongside Codex CLI (per decision; most plumbing exists in `src/lib/orchestrator/subprocess.ts` — ensure subscription auth, not `ANTHROPIC_API_KEY`, and surface login state in onboarding).
- **Quota/health-aware routing:** detect CLI subscription rate-limit responses → automatic failover frontier↔frontier↔local with frontier-review debt (mechanism exists).
- **`converse` role** (from W1) documented in `docs/MODEL-ROUTING.md`.
- Accept and document the ToS risk of subscription-CLI routing in DECISIONS.md (it is also the pricing moat: we never meter).

---

## 4. Milestones

| Milestone | Weeks | Contents | Gate |
|---|---|---|---|
| **M1 — Own the loop** | 1–4 | W1 Flash Lane + W2 voice runtime; iOS Talk → `/flash/turn` (OpenClaw bridge flag on) | Parity eval ≥90%; voice round-trip <3s; operator uses Flash daily over OpenClaw by choice |
| **M2 — Trust** | 5–8 | W3 autonomy rails + W4 vault + W7 routing; OpenClaw bridge default off | CI leak test green; kill switch demo; 7-day full-autonomy dogfood with zero destructive incidents |
| **M3 — Buyable** | 9–12 | W5 packaging: org account, licensing, onboarding wizard, App Store submission, site | Stranger-install test <15 min; TestFlight external group; first paid transaction (even $1 test) |
| **M4 — Jobs** | 13–16 | W6 outcome packs (Support + Chief-of-Staff first); security audit engagement booked | 2 packs through 7-day dogfood; public beta announcement |

Dogfood gate (per workplan memory) applies before any public beta: the operator's own business runs on it for a sustained period.

## 5. Non-goals (explicit)

- Multi-user / team / RBAC / hosted SaaS (schema-level rework; only on demand evidence).
- Open skill marketplace (ClawHavoc lesson: signed first-party packs only at launch).
- Embedding OpenClaw as a runtime dependency (bridge is interim; native parity is the strategy).
- Windows/Linux ports; wake word; HeyGen-dependent features beyond current state.
- API-key model backends (keyless remains the rule).

## 6. Risks

| Risk | Exposure | Mitigation |
|---|---|---|
| Subscription-CLI routing breaks (ToS/format changes) | Frontier tier goes dark | Local Qwen floor always works; dual frontier vendors; abstain from automation patterns that violate ToS |
| Siri AI (Gemini, free, this fall) absorbs consumer voice | Free-tier appeal shrinks | Position on *operations* control (terminal/browser/mail/ops), not general assistant |
| OpenClaw converges on this exact shape with OpenAI funding | Feature-race loss | Win on trust: signed, audited, vault, no plaintext, no poisoned marketplace — ship M2 proof points fast |
| One bad autonomous action at a customer | Category-killing churn | W3 rails in both modes; audit timeline; protected actions; caps |
| Solo maintainer bandwidth vs. 4 workstreams | Slippage | Strict milestone order; M1 before anything else; packs are templated directives, not new engines |
| App Review rejects agentic iOS app | iOS distribution delay | App is a *client* to user's own server (precedented); demo daemon + review notes; TestFlight external first |

## 7. Kickoff mechanics

1. Amend `COMPONENT-MAP.md` + scope wall for `flash/` and `vault/`; record decisions (Claude CLI backend, OpenClaw bridge policy, autonomy default, tiers/pricing) in `DECISIONS.md`.
2. Intake this spec as work packages per workstream (W1 first, W1+W2 can run in parallel: daemon loop vs. sidecar).
3. Harvest the OpenClaw chat history into the W1 parity eval set before turning the bridge off — it is the ground-truth spec for "ad-hoc competence."
