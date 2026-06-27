# Changelog

Release notes for HiveMatrix. Newest first. Auto-maintained by `scripts/release.mjs`; the in-app **Settings → Release notes** reads the same data (`src/lib/version/changelog.ts`).

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
