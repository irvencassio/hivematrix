# Changelog

Release notes for HiveMatrix. Newest first. Auto-maintained by `scripts/release.mjs`; the in-app **Settings → Release notes** reads the same data (`src/lib/version/changelog.ts`).

## v0.1.145 — 2026-07-06

Message Lane setup removal controls

## v0.1.144 — 2026-07-06

Message Lane self handles and voice email bridge

## v0.1.143 — 2026-07-06

Simplify voice/video: Kokoro-only TTS; remove the video factory / HeyGen pipeline entirely.

## v0.1.142 — 2026-07-05

Developer ID release

## v0.1.141 — 2026-07-05

Developer ID release

## v0.1.140 — 2026-07-05

Fix Tailscale pairing URL: advertise the MagicDNS HTTPS serve endpoint (https://<magicDNS>) instead of a dead loopback-bound http://<tailnet-ip>:port

## v0.1.139 — 2026-07-05

First hivematrix-core.json feed release on the Developer ID identity com.irvcassio.hivematrix.core; new-task box shows pickable command options; arms auto-update for the new identity

## v0.1.138 — 2026-07-05

Fix auto-update so new versions take effect: after install the bundled daemon restarts into the new version, and the daemon self-heals when updated from an older build

## v0.1.137 — 2026-07-05

Fix iOS Talk and Live voice replies

## v0.1.136 — 2026-07-04

Harden inbound pollers and Browser Lane reads: mail/message poll loops log failures instead of swallowing them, and the Browser Lane read client bounds its fetch with a timeout so a hung app fails the read instead of stalling the calling task

## v0.1.135 — 2026-07-04

Proactive-partner layer: heartbeat presence (pulse plus morning brief and evening recap), operator modeling and voice-writable goal ledger, backlog pattern detection, capability self-assessment, autonomy trust-ramp, deep-think reasoning on the local model, and voice deep-think/goals/memory/heartbeat commands; hardened by an adversarial review pass (enforced heartbeat tool gating, continuous learning, contestable trust, atomic config writes)

## v0.1.134 — 2026-07-04

loop-guard smoke verification prevents false-complete coding tasks

## v0.1.133 — 2026-07-04

DeepSeek agentic parity: per-request thinking off-switch (thinking:disabled) reachable over HTTP with an auto skip-in-the-middle/think-at-the-ends heuristic across agent turns, plus an opt-in native ds4-agent as a 4th DeepSeek coding harness (KV-cache /save+/switch sessions), off by default and gated to no-lane coding tasks so Qwen/Codex/Claude paths are untouched

## v0.1.132 — 2026-07-04

Standardize local models after the tools/model-bench bake-off: DeepSeek V4 Flash q2-q4 primary (128GB machines) with Qwen3.6-35B-A3B via Rapid-MLX as the lower-memory option (MLX tool calling enabled), fix Mixed-mode routing that ignored the configured local model and pointed Claude sessions at the local endpoint, mandatory code-verification gate on every coding agent, on-demand Qwen3-Embedding-0.6B via Ollama for brain search, and a RAM-aware install-local-model.sh for new machines

## v0.1.131 — 2026-07-04

Maintenance: de-duplicate the 0.1.130 changelog entry that concurrent releases left doubled

## v0.1.130 — 2026-07-04

Fix mobile pairing: the QR now shows a clear reason instead of a blank box when it can't render, Settings reflects saved Cloudflare Access credentials, and saving just the secret no longer wipes the client id; add a local license-issue script (counterpart to license-keygen) and harden messagebee onboarding tests against an installed Pro license

## v0.1.129 — 2026-07-04

Fix slow local DeepSeek tasks: forward each task's thinking mode to Dwarf Star as reasoning_effort so lighter work decodes faster, give goal decomposition a real 60s timeout (12s default aborted every thinking-mode split and silently fell back), and quadruple the ds4-server KV disk cache budget to stop per-turn prefill re-thrashing

## v0.1.128 — 2026-07-04

Optimize DeepSeek goal decomposition: goal-aware flight intake split, offline local-model support, reasoning token budget

## v0.1.127 — 2026-07-03

Browser Lane and Terminal Lane apps now host the agent read/run backends (127.0.0.1:4011 and :4012) so DeepSeek tasks complete and are watchable in-app; local model health config-matching and test-isolation fix; voice routes to the configured Dwarf Star DeepSeek model

## v0.1.126 — 2026-07-03

Make Codex optional and hide unavailable OpenClaw

## v0.1.125 — 2026-07-03

Fix settings and DeepSeek local model UI

## v0.1.124 — 2026-07-03

cloud-first local model setup

## v0.1.123 — 2026-07-03

lock deep link dependencies

## v0.1.122 — 2026-07-03

ship phase gate ledger

## v0.1.121 — 2026-07-02

Phase 4 outcome packs and companion surfaces

## v0.1.120 — 2026-07-02

auto-deploy HiveMatrix next level spec

## v0.1.119 — 2026-07-02

auto-update rebuild

## v0.1.118 — 2026-07-02

improve Flight autonomy and operator feedback

## v0.1.117 — 2026-07-01

7-day usage bar green-red pacing

## v0.1.116 — 2026-07-01

ship OpenClaw center pane

## v0.1.115 — 2026-07-01

refresh desktop auto-update release

## v0.1.114 — 2026-07-01

Fix Vale voice bridge and Flight duplication

## v0.1.113 — 2026-07-01

ship model routing, voice reminders, usage pacing, and console polish

## v0.1.112 — 2026-06-30

ship OpenClaw chat dock and command project routing

## v0.1.111 — 2026-06-30

complete Flight lanes and guard work-package auto-land

## v0.1.110 — 2026-06-29

auto-deploy HiveMatrix

## v0.1.109 — 2026-06-29

lane-off guards for Mail and Message Lane

## v0.1.108 — 2026-06-29

auto-update console fixes

## v0.1.107 — 2026-06-29

flight child autonomy + one-click decisions

## v0.1.106 — 2026-06-29

about version metadata refresh

## v0.1.105 — 2026-06-29

disabled lane passive probe fix

## v0.1.104 — 2026-06-28

Flight review reply reconciliation

## v0.1.103 — 2026-06-28

Flight loop profiles and release preflight

## v0.1.102 — 2026-06-28

Flight reliability and Goal Flights

## v0.1.101 — 2026-06-28

UI polish and Flight queue fixes

## v0.1.100 — 2026-06-28

_Maintenance release._

## v0.1.99 — 2026-06-27

_Maintenance release._

## v0.1.98 — 2026-06-27

Queued-task restart and project picker fixes

## v0.1.97 — 2026-06-27

Main-screen Flights orchestration UX

## v0.1.96 — 2026-06-27

_Maintenance release._

## v0.1.95 — 2026-06-27

_Maintenance release._

## v0.1.94 — 2026-06-27

_Maintenance release._

## v0.1.93 — 2026-06-27

Voice weather inline answers + console UI polish

## v0.1.92 — 2026-06-26

Post-autoupdate Lane app update handling

## v0.1.91 — 2026-06-26

_Maintenance release._

## v0.1.90 — 2026-06-26

Operator-path hardening: Browser Lane Add Site, lane app Edit menus, video-approval guard, release smoke

## v0.1.89 — 2026-06-26

lane app artifact delivery

## v0.1.88 — 2026-06-26

system readiness repair actions

## v0.1.87 — 2026-06-26

Browser Lane Google SSO, Terminal Lane, voice tools, and console UI updates

## v0.1.86 — 2026-06-26

Browser Lane readiness, workflow inbox, and Terminal Lane cleanup

## v0.1.84 — 2026-06-25

Bee-to-Lane rename: lane-native tools, services, config, central protocol, and refreshed guides

## v0.1.83 — 2026-06-24

video: Approve renders via HeyGen Video Agent by default (slides + annotations + B-roll); failed renders are re-approvable; accuracy guard against invented stats

## v0.1.82 — 2026-06-24

video: render failures (e.g. HeyGen out of credit) now surface on the review task instead of silently closing — retry or cancel

## v0.1.81 — 2026-06-24

video: editing a script now saves & stays in review (approve renders separately) + clear review controls; 'create an AI-news video' routes straight to draft/review

## v0.1.80 — 2026-06-24

browsable Release notes in Settings (changelog of every version + summary), auto-updated each release

## v0.1.79 — 2026-06-24

console: edit drafted scripts in place (Edit the draft button), persistent reply-box resize, copy from Result

## v0.1.78 — 2026-06-24

writer-role model selection (frontier or lock-free) + retire weekly-news as a feature (video factory runs via a directive)

## v0.1.77 — 2026-06-24

video: AI-news script now written by the local model (was a canned template); full script shown at the review checkpoint; agents must review-before-render

## v0.1.76 — 2026-06-24

voice: escalated-task results now return to the open Talk session

## v0.1.75 — 2026-06-23

fix: voice message/text/email requests now escalate to a real task and get sent

## v0.1.74 — 2026-06-23

consistent live Kokoro voice across Talk + iMessage (warm /synth endpoint); cloned voice reserved for produced narration

## v0.1.73 — 2026-06-23

voice escalation + video review hardening + iOS demo fixes

## v0.1.72 — 2026-06-23

_Maintenance release._

## v0.1.71 — 2026-06-23

_Maintenance release._

## v0.1.70 — 2026-06-23

_Maintenance release._

## v0.1.69 — 2026-06-23

_Maintenance release._

## v0.1.68 — 2026-06-23

_Maintenance release._

## v0.1.67 — 2026-06-23

_Maintenance release._

## v0.1.66 — 2026-06-23

_Maintenance release._

## v0.1.65 — 2026-06-23

_Maintenance release._

## v0.1.63 — 2026-06-22

voice command layer + console UI overhaul + iOS voice redesign

## v0.1.62 — 2026-06-22

_Maintenance release._

## v0.1.61 — 2026-06-22

_Maintenance release._

## v0.1.60 — 2026-06-22

_Maintenance release._

## v0.1.59 — 2026-06-22

_Maintenance release._

## v0.1.58 — 2026-06-22

Voice: ask Voice Lane to remind you or add a task and it lands in HiveMatrix; unanswered questions escalate too

## v0.1.57 — 2026-06-21

Voice: ask Voice Lane to read an email, list senders, or summarize your inbox — not just count

## v0.1.56 — 2026-06-20

Voice: consistent ~1s spoken turns (email-tool gate) + Kokoro works out-of-the-box for new installs (espeak via pip)

## v0.1.55 — 2026-06-20

Voice: kill spurious email-tool stalls — every spoken turn is now consistently fast (~1s)

## v0.1.54 — 2026-06-20

Kokoro fast TTS for interactive Talk — ~1s voice turns (was several seconds on the cloned voice)

## v0.1.53 — 2026-06-20

Persistent push-to-talk voice worker — STT+TTS stay warm across turns (no per-turn model reload)

## v0.1.52 — 2026-06-20

grouped new-task model selector

## v0.1.51 — 2026-06-20

two-tier Rapid-MLX routing, coding-tier task selection, reasoning status

## v0.1.50 — 2026-06-20

Rapid-MLX local-engine + live status in Settings

## v0.1.49 — 2026-06-20

voice TTS cache+warmup, Mail Lane voice tool, selectable app icon

## v0.1.48 — 2026-06-19

voice TURN, Matrix theme, hex-flower icon, opacity slider

## v0.1.47 — 2026-06-19

role-model-overrides

## v0.1.46 — 2026-06-19

command layout hotfix

## v0.1.45 — 2026-06-19

attachment provider parity

## v0.1.44 — 2026-06-19

console input cleanup

## v0.1.43 — 2026-06-17

_Maintenance release._

## v0.1.42 — 2026-06-17

_Maintenance release._

## v0.1.41 — 2026-06-17

_Maintenance release._

## v0.1.40 — 2026-06-17

_Maintenance release._

## v0.1.39 — 2026-06-16

command launcher provenance UI

## v0.1.38 — 2026-06-16

feat: render result tables and Mermaid

## v0.1.37 — 2026-06-16

fix: daemon native runtime ABI

## v0.1.36 — 2026-06-16

fix: command launcher owns project context

## v0.1.35 — 2026-06-16

fix: command launches use selected home project path

## v0.1.34 — 2026-06-16

feat: /uploads endpoint (iOS attachments transfer real bytes to host); steer any in-progress task, not just Codex

## v0.1.33 — 2026-06-15

fix: Mail Lane never auto-replies a Gmail/MCP auth dead-end; task tells agent to attach files via Apple Mail send path, not Gmail

## v0.1.32 — 2026-06-15

fix: strip NUL bytes from spawn argv so AGENTS.md/CLAUDE.md with stray nulls can't crash task launch

## v0.1.31 — 2026-06-15

local commands & skills catalog

## v0.1.30 — 2026-06-15

_Maintenance release._

## v0.1.29 — 2026-06-15

_Maintenance release._

## v0.1.28 — 2026-06-15

_Maintenance release._

## v0.1.27 — 2026-06-15

_Maintenance release._

## v0.1.26 — 2026-06-14

_Maintenance release._

## v0.1.25 — 2026-06-14

_Maintenance release._

## v0.1.24 — 2026-06-14

_Maintenance release._

## v0.1.23 — 2026-06-14

_Maintenance release._

## v0.1.22 — 2026-06-14

_Maintenance release._

## v0.1.21 — 2026-06-14

_Maintenance release._

## v0.1.20 — 2026-06-14

_Maintenance release._

## v0.1.19 — 2026-06-14

_Maintenance release._

## v0.1.18 — 2026-06-14

collapsible console + ops script skills

## v0.1.17 — 2026-06-13

Claude auth login

## v0.1.16 — 2026-06-13

interaction fixes

## v0.1.15 — 2026-06-13

usage refresh

## v0.1.14 — 2026-06-13

focus and Mail Lane fixes

## v0.1.13 — 2026-06-13

updater fixes
