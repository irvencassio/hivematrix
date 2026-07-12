# HiveMatrix Design Decisions

Date closed: 2026-06-11. All six reset questions are closed.

## Q1 — Desktop Lane naming

**Decision:** Desktop Lane is the public capability name. ComputerBee is retired.
**Code:** `src/lib/desktopbee/` remains the compatibility module; exported types still use the `DesktopBee*` prefix until the API surface can be renamed safely.

## Q2 — Local Qwen hardware

**Decision:** M5 Max 128GB unified memory, no LAN GPU box. Primary serving stack: MLX-first (mlx-lm server or Rapid-MLX), llama.cpp/GGUF fallback. vLLM deferred unless a LAN Linux/GPU box appears.
**Code:** `src/lib/local-model/health.ts` readiness gate extended in Phase 2. See [QWEN-LOCAL-PROFILE.md](QWEN-LOCAL-PROFILE.md).

## Q3 — Frontier default

**Decision:** Claude as the selectable default frontier model. OpenAI remains selectable. Google models removed except Nano Banana (image role, cloud-ok) and mflux local fallback.
**Code:** `src/lib/models/catalog.ts` — ModelOption type has no gemini-pro/flash entries.

## Q4 — Update channel trust

**Decision:** Signed, notarized .app from day one. No git-based updater. Tauri shell from Phase 1 with Sparkle/Tauri-updater channel. Daemon-side migrate-backup-restart-probe-rollback design is unchanged inside the signed bundle.
**Code:** Phase 1 work. No updater code in Phase 0.

## Q5 — Nano Banana offline

**Decision:** Nano Banana (cloud) is the primary image-role provider when `cloud-ok`. Local MLX fallback: mflux (FLUX.2 Klein / Qwen-Image class, draft/asset-grade) in `local-only` and `offline` modes.
**Code:** Router role `image` in Phase 2. `nano-banana` entry retained in catalog.

## Q6 — Mission primitive

**Decision:** Mission is retired. The long-horizon autonomy unit is the **Directive** (standing objective + proven success criteria + trigger/budget policy + recoverable run loop). Mission tables are not ported.
**Code:** `src/lib/db/index.ts` has `directives`, `runs`, `run_journal`, `directive_criteria` tables. No missions table.

## Q7 — Cloud-only run mode + capability lanes for the local agent

Date closed: 2026-06-12.

**Decision A — Cloud-only posture.** Alongside `Local` (pure Qwen) and `Mixed`
(router: frontier thinking + local processing), a third selectable macro mode
**Cloud-only** runs every role on frontier and never spawns the local model.
When the cloud is unreachable a cloud-only task is **not** downgraded to local —
it is left for retry when `cloud-ok` returns (no silent local fallback). This is
a router preference (`routeByRole(role, policy, { noLocal })`), surfaced as the
`cloud-only` model option; setting it as the default model also makes directive
"execute" work stay on frontier.
**Code:** `src/lib/routing/router.ts` (`RouteOptions.noLocal`),
`src/lib/models/available.ts` (`CLOUD_ONLY_ID`), `src/lib/orchestrator/subprocess.ts`
(`model === "cloud-only"` branch), `src/lib/orchestrator/directive-engine.ts`.

**Decision B — capability lanes available to the local (Qwen) agent.** Browser Lane
and Desktop Lane are exposed to the local/generic agent tool loop as compatibility
function tools (`webbee_search`, `browserbee_run`, `desktopbee_action`). No new
brands. Each is gated by the
ConnectivityPolicy capability matrix: a lane disabled in the current mode is
neither advertised to the model nor dispatched. Browser Lane workflow jobs run as
delegated Codex Computer Use tasks. Desktop Lane acts are auto-approved at dispatch (Irv's
explicit posture), with the Swift helper's server-side gate retained as
defence-in-depth.
**Code:** `src/lib/orchestrator/bee-tools.ts`, wired via
`src/lib/orchestrator/tool-bridge.ts` and `generic-agent.ts`.
**Provers:** `src/lib/orchestrator/bee-tools.test.ts`,
`src/lib/routing/router.test.ts` (noLocal cases),
`src/lib/models/available.test.ts` (cloud-only cases).

---

## Q8 — Message Lane un-deferred (SMS/iMessage channel lane)

Date closed: 2026-06-12.

**Decision.** Message Lane moves from "deferred beyond notification egress" to an
**active embedded channel lane** — the top channel priority for the autonomous
business operator, because SMS/iMessage is the founder's control surface
(approvals, `needs_input` replies, content sign-off by text). No standalone
runtime and no new HTTP brand service: it runs **inside the daemon**, like the
Browser Lane and Desktop Lane capabilities (Q7-B pattern).

**Mechanism (self-contained — no external `imessage` CLI).**
- **Read:** poll `~/Library/Messages/chat.db` directly via better-sqlite3
  (read-only), high-water-marked by `message.ROWID`. Requires the daemon to hold
  **Full Disk Access** (a new optional onboarding step + System Settings
  deep-link, mirroring the Desktop Lane TCC pattern).
- **Send:** `osascript` AppleScript `tell application "Messages" … send` (built
  into macOS; recipient + text passed as `on run` argv to avoid escaping).
- **Routing:** inbound from an **allowlisted** identity (`message_identities`)
  → resolve a pending `needs_input` task for that sender and post the reply, else
  create a task (`source: "messagebee"`). Non-allowlisted senders are read-only
  (never create or resolve work). `/model` directives parsed (ported pattern).
- **State:** the existing `message_channels` / `message_identities` tables (db
  v5). chat.db schema access is version-gated; the AppleScript send path is
  independent of the read path so a chat.db schema drift can't break sending.

**Code:** `src/lib/messagebee/` (contracts, imessage I/O, store, handoff, poller),
wired into the daemon boot + `src/daemon/server.ts` (`/messagebee/*`) +
onboarding. **Scope wall + COMPONENT-MAP amended** in the same change.
**Provers:** `src/lib/messagebee/*.test.ts` (routing/allowlist/parse/applescript);
end-to-end: SMS in → task → iMessage reply; `needs_input` round-trip; a
non-allowlisted sender cannot trigger execution.

---

## Q9 — Mail Lane un-deferred (email watch + trust-gated drafting)

Date closed: 2026-06-12.

**Decision.** Mail Lane becomes an **active embedded channel lane** (the founder's
inbox, watched and triaged). Self-contained via **Apple Mail (osascript)** — no
IMAP/SMTP creds, no OAuth; it reads/sends through accounts Mail.app already holds
(Gmail + Outlook both work). Same daemon-embedded pattern as Message Lane (Q8).

**The safety story (ported from Hive 1, the highest-value reusable asset).**
Every inbound email is **trust-classified** before anything acts on it
(`classifyMailTrust`): prompt-injection signal detection in subject/body, risky
(executable/script) attachment detection, and trust hints (known sender +
authenticated domain). Levels: `trusted` (known + authenticated domain) /
`external` (default) / `suspicious` (injection or risky attachment). The email
body/thread/links/attachments are treated as **untrusted input**; auto-send is
gated to `trusted` senders; everything else drafts-for-approval.

**Mechanism.** Read recent inbox messages via `osascript` (high-water by Mail
message id), trust-classify, create a task (`source: "mailbee"`) carrying the
trust assessment; the agent drafts a reply; approval (e.g. via Message Lane text,
W1.3) sends it. Allowlist + "trusted domains" live in `message_identities` /
config (channel `email`). State in the v5 `message_channels`/`message_identities`
tables.

**Code:** `src/lib/mailbee/` (contracts incl. `classifyMailTrust`, applemail I/O,
store, handoff, poller). Endpoints `/mailbee/*`; onboarding `mailbee` step.
Scope wall + COMPONENT-MAP amended. **Provers:** `src/lib/mailbee/*.test.ts`
(trust classification + routing); live-Mac: real Mail.app read/draft.

---

## Q10 — Terminal Lane becomes an owned embedded lane

Date closed: 2026-06-12.

**Decision.** Terminal Lane is no longer "Canopy provider" — it's a **HiveMatrix-owned
embedded capability lane**: persistent terminal sessions the agent drives across
turns. Self-contained — **real shells managed in-process** (no node-pty native
addon, no tmux dependency); a per-command completion marker reads each command's
combined output + exit code back off the shared stdout stream. State (cwd, env,
shell vars) persists between commands like a real terminal.

**Availability: every connectivity mode** (cloud-ok / local-only / offline) —
Terminal Lane is the offline workhorse, so it's added to the ConnectivityPolicy matrix
as always-available.

**Code:** `src/lib/termbee/` (contracts, session manager). Exposed to the agent
loop via `bee-tools.ts` as `termbee_session` (create/list/kill) and `termbee_run`
(run a command in a session). Capability `termbee` in `connectivity/policy.ts`;
catalog + COMPONENT-MAP updated. **Provers:** `src/lib/termbee/*.test.ts`
(marker parsing + a real multi-step session: cd persists, command output across
turns, runs offline).

**Update (2026-06-25).** Reversed the 2026-06-23 "Canopy preferred provider"
update. Terminal Lane is HiveMatrix-owned end-to-end with **no external provider**:
the Canopy bridge and `src/lib/canopy/` are removed, and `src/lib/termbee/provider.ts`
delegates only to the in-process shell engine. The credential/profile-aware work
(Keychain-backed profiles, readiness/test-login, audit) moves *into* HiveMatrix as
its own Terminal Lane app + subsystem, modeled on Browser Lane, with a SwiftTerm
PTY for human-usable per-host sessions. See
`docs/superpowers/specs/2026-06-25-terminal-lane-app-design.md`.

---

## Q11 — Market Insight Lane un-deferred (market-data watch + alerts) + env-var key pattern

Date closed: 2026-06-14.

**Decision A — Market Insight Lane. ANALYSIS & ALERTS ONLY; it
NEVER places trades, submits orders, or moves money.** Reads quotes from
**Alpaca's DATA API only** (`data.alpaca.markets`; the trading API is never
called). A watchlist + alert rules (above / below / pct_move) are evaluated on a
5-min poller → `notify()`, deduped once-per-crossing. Self-gates when the Alpaca
keys are absent. COMPONENT-MAP amended (lane listed). The analysis scenarios
(bull/bear brief, position-size, trend brief) already work via the **trader agent
profile** on demand; this adds the live watch only.
**Code:** `src/lib/traderbee/` (contracts incl. pure `evaluateAlerts`, Alpaca
data `provider`, watchlist `store`, `poller`), `src/daemon/server.ts`
(`/traderbee`, `/traderbee/watch`, `/traderbee/poll`), boot-wired.
**Provers:** `src/lib/traderbee/contracts.test.ts` (alert eval, snapshot mapping,
key-gate). Hard constraint honored: trading API never imported.

**Decision B — API keys via environment variables, set/unset visible in settings.**
Keys are read from env vars (never stored in config.json or returned to clients);
`src/lib/config/secrets.ts` is the registry and `GET /settings/keys` reports which
are SET (boolean only — never the value). Covers Anthropic, OpenAI, Nano Banana,
Alpaca (`APCA_API_KEY_ID`/`APCA_API_SECRET_KEY`), X, YouTube.
**Provers:** `src/lib/config/secrets.test.ts` (set/unset, no value leakage).

---

Proposals for future phase boundaries go below this line. Nothing above is re-opened without a new decision entry.

---

## PROPOSAL (2026-06-13) — Capability dispatch + outbound Bee tools ("chief of staff")

Status: **Slice 1 IMPLEMENTED 2026-06-13** (outbound dispatch). Brain-search +
learning-loop slices remain open. Owner: Irv.
Full review: brain doc `2026-06-13-hivematrix-architecture-review.md`.

**Implemented (slice 1 — outbound dispatch + routing table).**
- New embedded outbound tools on the local/generic agent loop: `mailbee_send`
  (sends to trusted recipients via Apple Mail; **drafts for approval otherwise**),
  `mailbee_draft` (always drafts), `messagebee_send` (allowlisted handles only,
  else refused). The trust/allowlist gate lives **inside** each tool, not in the
  profile. `src/lib/orchestrator/bee-tools.ts`.
- New connectivity capabilities `mailbee`/`messagebee`, available in **every**
  mode (osascript-local — work offline). `src/lib/connectivity/policy.ts`.
- "Chief of staff" routing table injected into the agent system prompt
  (`capabilityRoutingGuide`) so the agent uses the named lane instead of
  improvising with bash/osascript — only advertising lanes the current mode
  permits. `bee-tools.ts` + `src/lib/orchestrator/generic-agent.ts`.
- Qwen reliability: `waitForServerReady` + a dispatch-time pre-flight so a task
  dispatched during the server's cold-start/relaunch window **waits** instead of
  failing with a cryptic connection error. `src/lib/local-model/serving.ts` +
  `generic-agent.ts`. Routing reference: `docs/MODEL-ROUTING.md`.
- **Provers:** `src/lib/orchestrator/bee-tools.test.ts` (trust gate sends-vs-drafts,
  allowlist refusal, availability per mode, routing guide), `src/lib/local-model/serving.test.ts`
  (`waitForServerReady`). Full suite 484/484 green; scope-wall + typecheck clean.
**Implemented (slice 1b — CLI executor bridge, 2026-06-13).** The Claude Code /
Codex harnesses run their own toolset and never saw the bee tools — the original
"Claude improvised with its own interface" failure. Bridge: the daemon exposes
the SAME trust-gated send path over loopback HTTP (`POST /mailbee/send`,
`/mailbee/draft`, `/messagebee/send` in `src/daemon/server.ts`, behind the daemon
token), and an **outbound routing block** is injected into the Claude Code system
prompt (`src/lib/orchestrator/outbound-routing.ts` →
`outboundHttpRoutingPrompt`, wired in `subprocess.ts` via `--append-system-prompt`)
telling it to curl those endpoints with its Bash tool instead of using osascript.
The endpoints accept JSON **or** form-urlencoded (`--data-urlencode`, so no shell
JSON-escaping). Trust gate stays server-side — single source of truth for every
caller. **Provers:** `src/lib/orchestrator/outbound-routing.test.ts` (body
parsing both shapes, prompt content). Full suite 490/490 green.

**Implemented (Codex bridge, 2026-06-13).** Codex `exec` has no
`--append-system-prompt`, so the routing block is prepended to the prompt
(`buildCodexPrompt` in `src/lib/orchestrator/codex-agent.ts`). Prover:
`codex-agent.test.ts`. ⚠ Caveat: `codex exec` runs sandboxed — loopback network
to the daemon may be blocked depending on the Codex sandbox/network policy; if
so the endpoint is unreachable and this needs a sandbox-network allowance (the
Qwen and Claude Code paths are unaffected). To verify live before relying on it.

**Implemented (slice 2 — brain retrieval, 2026-06-13).** "Store a doc for lookup
later" now works: keyword search over the brain root with term-frequency scoring
+ snippets, bounded and cloud-stall-safe (per-file timeout + wall-clock budget —
the root lives on a dehydrating Drive mount). `src/lib/brain/search.ts`.
Exposed three ways: `brain_search` tool for the local agent (new `brain`
connectivity capability, available every mode); `GET /brain/search?q=` daemon
endpoint; and a routing block (`brainSearchRoutingPrompt`) injected into both CLI
executors so Claude Code/Codex recall stored docs instead of assuming they're
absent. **Provers:** `src/lib/brain/search.test.ts` (ranking, content-only match,
skip node_modules, empty/disabled root), `bee-tools.test.ts` (availability +
guide), `outbound-routing.test.ts` (endpoint prompt). Full suite 499/499 green.
No vector DB yet — keyword v1; embeddings are a later upgrade.

**Implemented (slice 3 — self-improvement loop, 2026-06-13).** Reflection and the
feedback backlog were disconnected (lessons went only to playbook prose; nothing
tracked or measurable). Now: a directive retrospective's "what didn't work" →
deduped `bug` feedback and follow-up ideas → `enhancement` feedback, captured
automatically at the directive learn step (`recordReflectionFeedback` in
`directive-engine.ts`, non-blocking, journaled). `openFeedbackForPlanning()`
surfaces the backlog for a maintenance directive to consume (NOT force-injected
into unrelated directives). `loopHealth()` is the eval signal — resolution rate,
recurring-issue count, reflection-sourced count, backlog age — exposed at
`GET /feedback/loop-health`. Core: `src/lib/feedback/self-improvement.ts` +
dedup helpers in `feedback.ts`. **Provers:** `self-improvement.test.ts` (mapping,
dedup-across-runs, planning surface, recurrence, loop-health). 505/505 green.
Honest scope: capture + measure + surface is wired; *auto-closing* a feedback
item when a corrective task proves it (task↔feedback linkage) is the next wire.

**Closing logic + planning surface (2026-06-13).** Shipped, additive (no core-path
change): `feedbackStatusForCompletedTask` (pure) + `resolveFeedbackForCompletedTask`
(forward-only: task done→feedback done, review→triaged, never re-opens) in
`self-improvement.ts`, and `GET /feedback/for-planning` (open backlog + a ready
prompt fragment for a maintenance directive). Provers in `self-improvement.test.ts`.
507/507 green. The closing *logic* is tested and ready to wire; the **hook point
is a deliberate open decision** (see below) — not wired into the 24×7 task path
without a direction call.

**Closed decision — full loop wired (Both/both, 2026-06-13).** Operator picked
both hooks + both producers, so the loop is end-to-end:
- **Producers:** `POST /feedback/:id/work` (operator → feedback-linked task) and
  `POST /feedback/maintenance-directive` (installs `buildSelfImprovementDirective`,
  a standing directive whose planner pulls the backlog — gated by a goal marker so
  only it sees global feedback).
- **Link:** planner emits `feedbackId` per task → threaded to `task.output.feedbackId`
  (createAutonomyPlanTasks/createReplanTasks).
- **Hook A (task completion, agent-manager):** open → triaged as a linked task exits.
- **Hook B (criteria-proof, verify):** triaged → done when the run proves out
  (`resolveProvenFeedback`, guarded by `proven.length > 0`).
- **Provers:** recipe/detection + parser `feedbackId` + forward-only resolver in
  `self-improvement.test.ts` / `directive-autonomy.test.ts`. 509/509 green.

- **Other open:** brain_search keyword→embeddings if too blunt; embed Hermes as an
  alternate runtime. **All four original review gaps (dispatch, browser/LinkedIn
  diagnosis, retrieval, self-improvement) are addressed and the loop now closes
  automatically.**

## PROPOSAL/BUILD (2026-06-14) — YouTube playlist watcher (no new public lane brand)

Status: **Implemented 2026-06-14.** Owner: Irv.

**Need.** Watch a YouTube playlist; on a new video, summarize (transcript-based)
into an HTML brain doc with thumbnail + link, and notify.

**Constraint that shaped it.** YouTube "Watch Later" is NOT reachable via the
Data API (Google removed it). Decision: operator saves videos to a normal
private/unlisted playlist; the watcher polls THAT via `playlistItems.list`. (The
alternative — browser-scraping WL — was rejected: fragile + depends on the weak
Codex/Desktop Lane browser-auth path. COMPONENT-MAP's older YouTube-import recipe
note is superseded for this case by the cleaner API path.)

**Shape (scope-wall respected — no standalone YouTube-import brand).** Self-contained
`src/lib/youtube/` module + a daemon poll loop (mirrors the Message Lane poller
pattern), self-gated on config. Deterministic API poll + HTML render; the LLM only
writes the summary text (a spawned `source:"youtube"` task), then a deterministic
step renders + writes the doc + notifies once. First run seeds (marks existing
playlist items seen) so it never summarizes the whole backlog.

**Config (`~/.hivematrix/config.json`):**
```jsonc
{ "youtube": { "enabled": true, "apiKey": "<YouTube Data API v3 key>",
  "playlistId": "<your private/unlisted playlist id>",
  "pollIntervalMinutes": 30, "maxPerTick": 5 } }
```
Docs land in `<brain>/youtube/<date>-youtube-<slug>-<id>.html`.

**Endpoints:** `GET /youtube` (status), `POST /youtube/poll` (manual cycle for setup/testing).
**Provers:** `src/lib/youtube/contracts.test.ts` (diff, filename, render+escaping,
API mapping, transcript helpers). 517/517 green.
**Needs live verification:** real API key + playlist; transcript fetch is
best-effort (scrapes captionTracks) and degrades to description-based summary.

## BUILD (2026-06-14) — closed the three gap-hunt enhancement gaps

1. **CLI executor capability parity.** Generic `POST /bee/<tool>` endpoint
   dispatches via `executeBeeTool` (same connectivity gate), and
   `beeToolsRoutingPrompt` (wired into Claude Code + Codex) teaches them to reach
   webbee/browserbee/desktopbee/termbee — previously only the local agent could.
2. **Proactive failure escalation.** `notifyFailures()` in the notify loop seeds
   on first tick then pushes each newly-failed task to the founder's channels
   (set reassigned each tick → auto-prune/bound). Closes the 24×7 blind spot
   where a failed task/directive went unnoticed.
3. **Browser Lane health endpoint.** `GET /browserbee/health` surfaces
   the Browser Lane health snapshot (codex auth mode, desktop-fallback enabled,
   effective backing, job counts) so a refused LinkedIn/browser job explains
   itself instead of failing opaquely.

**Provers:** `beeToolsRoutingPrompt` test; full suite 518/518 green; scope-wall +
typecheck clean.

## Consolidation pass (2026-06-14)

Verified the whole session's work holds together and surfaced the new signals:
- **Daemon bundle builds** (`npm run build:daemon` → 792kb, all new modules
  integrate). Tests 518/518, scope-wall + typecheck clean.
- **Failure-escalation noise filter:** `notifyFailures` now skips internal
  directive phase tasks (planner/reviewer/retrospective churn) — real work
  failures still escalate.
- **loopHealth surfaced** in the Review Lane control-plane report
  (`report.ts` → `selfImprovement`), so the self-improvement signal rides the
  heartbeat the operator already watches (console/iOS) instead of needing a
  separate poll. (eslint not installed locally — lint not run; not a regression.)

## DECISION (2026-06-14) — do NOT embed Hermes; adopt its skill-loop idea instead

Spike: brain doc `2026-06-14-hermes-integration-spike.md`. Both `NousResearch/hermes-agent`
and `openclaw/openclaw` are real + active (GitHub API confirmed). But the primary
README disproves the blog-sourced claims that made integration look easy: Hermes
has **no MCP-server mode, no headless task API, no Claude/Codex subagent spawning**
— it's interactive/gateway-first (CLI + messaging gateway + cron).

**Verdict: don't embed it.** (1) No interface to drive it behind our daemon; (2)
it IS a full competing control plane (~80% surface overlap) — conflicts with
"Hive is the control plane, harnesses don't orchestrate"; (3) a switch loses our
trust gate / connectivity policy / Directives / signed updater, which Hermes lacks.

**Adopt instead:** Hermes's real differentiator — the **autonomous skill-creation
loop** (skills distilled from experience, agentskills.io format). Layer it on what
we built: distill directive-retrospective "whatWorked" + repeated successful task
patterns into reusable skill files under `<brain>/skills/`, retrievable via
`brain_search` + the Skill tool, refined on reuse. No new runtime, no scope-wall
change, reversible. **This is the recommended next build.** To evaluate Hermes
itself: run it STANDALONE on the secondary Mac for a week, don't integrate.

**Closes the last open strategic item from the original review.**

## BUILD (2026-06-14) — skill-creation loop (the "adopt instead of embed" path)

Built Hermes's one good idea directly into HiveMatrix: experience → reusable
skills, no new runtime.
- **Skill model + store** (`src/lib/skills/`): agentskills.io-shaped markdown
  (frontmatter + recipe body) under `<brain>/skills/`. `upsertSkill` dedupes by
  slug and REFINES on re-distillation (new body → revisions++), never duplicates.
  Cloud-stall-safe (timed reads), like the brain module.
- **Distillation:** `DirectiveRetrospective.skills` (parsed from the retrospective
  LLM output; the prompt now asks for reusable recipes "only when a repeatable
  procedure actually worked"). Written at the directive learn step via
  `recordDistilledSkills` (mirrors `recordReflectionFeedback`), journaled.
- **Retrieval/use:** skills live in the brain root, so `brain_search` already
  finds them; plus a compact **skill index injected into the local agent's system
  prompt**, a pointer in the CLI brain-routing prompt, and `GET /skills`.
- **Provers:** `skills/contracts.test.ts` (render/parse round-trip, index),
  `skills/store.test.ts` (create + refine-not-duplicate + no-op refine),
  `directive-autonomy.test.ts` (skills parsed, body-less skill dropped). Full
  suite **527/527** green; daemon bundles (800kb); scope-wall + typecheck clean.
- **Apply-time refinement (2026-06-14) — done.** "Improves during use": skills
  carry `useCount` + `lastUsedAt`; an agent signals application via the
  `skill_used` tool (local) or `POST /skills/:name/used` (CLI), which bumps the
  count and, if the agent supplies a one-line refinement, appends it to the body
  and bumps revisions. The skill index sorts most-used first and shows "(used N×)"
  so proven skills surface. Provers in `skills/store.test.ts` + `contracts.test.ts`.
  Full loop now: **distill (create) → apply (count + refine) → re-distill (refine)**.
  530/530 green; daemon bundles.

## DECISION + BUILD (2026-06-14) — embeddings for retrieval (local-first, v2 corpus index)

Operator chose **local-first embedding model** + **straight to v2 (full corpus
index)**. Built `src/lib/embeddings/`:
- **vector.ts** — pure cosine/topK (no vector DB; brute-force in-memory).
- **provider.ts** — config-gated OpenAI-compatible `/v1/embeddings` client
  (local endpoint by default — same mlx/llama.cpp stack as Qwen, so it works
  offline + no data egress). Self-gates: null when unconfigured → keyword fallback.
- **index-store.ts** — sidecar `~/.hivematrix/embeddings-index.json` keyed by
  brain-relative path + content hash; pure `planReindex` (new/changed embed, gone
  prune, model-change reset).
- **indexer.ts** — incremental corpus reindex (cloud-stall-safe walk, batched
  embed, prune) + a self-gated background poller (boot-wired).
- **search.ts** — `semanticSearch` (cosine over the index) + `hybridBrainSearch`
  (keyword recall × semantic rank, pure `mergeHybrid` blend) returning the same
  BrainSearchResult so formatters/callers are unchanged.
- **Wiring:** `brain_search` tool + `GET /brain/search` use hybrid when enabled
  (else keyword, zero behavior change); `GET /embeddings` (status), `POST
  /embeddings/reindex`.
- **Provers:** `vector.test.ts` (cosine/topK, planReindex, mergeHybrid, hash) +
  `indexer.test.ts` (incremental/prune/reset + semantic rank + hybrid, fake
  injected embedder). **540/540** green; daemon bundles (818kb).
- **Config (`~/.hivematrix/config.json`):** `embeddings: { enabled, endpoint,
  model, provider, pollIntervalMinutes }`. **Needs live verification:** a real
  local embedding model served at the endpoint (can't test the live `/v1/embeddings`
  call from a build box; gated off until configured, falls back to keyword).
- **v1 limitation note:** N/A — went straight to full corpus index (semantic recall).
- **Brainpower alignment (2026-06-14):** Brainpower (the standalone app) already
  runs hybrid semantic search over the SAME brain via `~/brain/retrieve` + Ollama
  `qwen3-embedding:8b-q8_0`. Decision: **align the model** — HiveMatrix embeddings
  config now DEFAULTS to `http://localhost:11434/v1` + `qwen3-embedding:8b-q8_0`, so
  enabling embeddings shares Brainpower's model (no data egress, one model). Two
  indexes still; unifying on `retrieve` is a later option. Brainpower also got
  cosmetic Swift changes (skills/youtube sidebar sections + frontmatter strip in
  `~/Brainpower` + `~/Brainpower-iOS` — compile-unverified from this box). See brain
  doc `2026-06-14-brainpower-hivematrix-intersection.md`.

## AUDIT (2026-06-14) — 102 user-guide scenarios vs current capability

Brain doc `2026-06-14-scenario-coverage-audit.md`. **~94% already supported** —
the scenarios are compositions of existing capabilities (channel lanes + Directives
+ Content + Approval + Brain) plus this session's adds (outbound send, brain_search,
embeddings, skills, YouTube watcher, failure escalation). **Genuine gaps (each needs
a decision, not a guess):**
1. **Market Insight Lane market watch/alerts** (guide §M, "Proposed, not yet built") — analysis
   already works via the trader profile; live watch needs a quotes data source +
   watchlist + alert directive, and is a **new capability-lane proposal**.
2. **Content publishing execution** — X/Twitter has no posting path (needs X API or
   Browser Lane workflow); newsletter/email send is now possible via Mail Lane (this
   session) but the content→Mail Lane send step isn't wired (in-scope follow-on).
3. **On-demand "digest this URL"** (#43 article path) — composable via a task today;
   a thin `POST /digest` would make it one-tap (low priority, no external dep).

## BUILD (2026-06-14) — on-demand digest (scenario #43, the article path)

Built the one decision-free gap: `src/lib/digest/` + `POST /digest {url, note?}`
(creates a `source:"digest"` task that fetches the page via Browser Lane,
summarizes, and writes a markdown brain doc with the source link) + a `digest_url`
bee tool (web-gated) so agents can digest links they encounter (e.g. in an email).
Pairs with the YouTube watcher for "save anything for review." Provers:
`digest/contracts.test.ts` (url validation, slug/filename, task-prompt builder) +
bee-tools (web-gating: absent offline). **544/544** green; daemon bundles (824kb).
No external dependency.

## BUILD (2026-06-14) — X posting + skill/MCP management (backend)

**X (Twitter) posting** — `src/lib/x/` — OAuth 1.0a request signing (pure,
tested) + `postTweet`/`postThread` via API v2; keys via env
(`X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET`). Outward-facing, so
**operator-triggered only** (`POST /x/post`, `/x/thread`) — no free agent tool,
honoring "approve before posting". Posting only — never reads DMs/acts.

**Skill management** — skills now carry **`compat`** (claude/codex/qwen/all) +
**`hasInput`** ({{input}} slot). `GET /skills` returns both; `POST /skills/:name/run
{input}` launches a skill with text input (the "dropdown + text box" backend);
`POST /skills/import {url}` imports a shared/public skill into `<brain>/skills/`.
Chief-of-staff awareness: the injected skill index is **filtered by harness compat**
(a local-Qwen agent doesn't see Claude-only skills). `src/lib/skills/`.

**MCP management** — `src/lib/mcp/registry.ts` — `mcpServers` config registry
(stdio/http/sse, transport inferred from url); `GET /mcp` lists servers + status
(HTTP/SSE health-probed for reachability; stdio = configured/per-session);
`POST /mcp/:name/restart` (honest: managed-process restart is a follow-on).

**Keys/secrets** — env-var only, never stored/returned; `GET /settings/keys` shows
set/unset per key (`src/lib/config/secrets.ts`).

**Provers:** `x/oauth.test.ts`, `skills/contracts.test.ts` (compat/input),
`mcp/registry.test.ts`, `config/secrets.test.ts`. Full suite green; daemon bundles.

**Remaining (frontend / follow-on, not backend gaps):** the **console dropdown UI**
to drive skill launch / import / MCP status (the Next.js console — separate from
this daemon work; all the endpoints above now back it). Owned-process MCP
supervision (launchagent restart) for HTTP MCP servers HiveMatrix runs itself.
Newsletter *send* still needs a recipient list + content→Mail Lane wiring.

## BUILD (2026-06-14) — ADO feature flag + skill launcher UI

**Feature flags in settings** — `src/lib/config/features.ts` (`features.<key>` in
config.json; `getFeatureFlags`/`setFeature`). `GET /settings/features`,
`POST /settings/features {key, enabled}`.

**Azure DevOps integration (flag-gated)** — `src/lib/ado/mcp.ts`: when the **`ado`
feature flag** is on AND an org is configured (`ado.org`, `ado.authMode`), the
**official local Azure DevOps MCP server** (`npx -y @azure-devops/mcp <org>
--authentication <mode>`) is **auto-registered into the MCP registry** — so the
harnesses can operate repos/PRs/pipelines/work items. Local stdio variant (works
with any client). Auth: `azcli`/Entra (preferred, no secret), `pat`
(`PERSONAL_ACCESS_TOKEN` env), `envvar` (`ADO_MCP_AUTH_TOKEN` env) — keys via env,
shown in `GET /settings/keys`. `GET /ado` reports flag/org/auth-ready.
**Provers:** `src/lib/ado/mcp.test.ts` (feature parse, ado-config parse, server
builder).

**Skill launcher UI** — added to the console (`src/daemon/console.ts`, context
column): a **skill dropdown** (populated from `GET /skills`, shows use-count + ✎
for input + compat), a **text input**, **Run skill** (`POST /skills/:name/run`),
and **Import** (`POST /skills/import {url}` — team/public). Backs the endpoints
built earlier. Full suite 563/563 green; daemon bundles (857kb); scope-wall clean.

**MCP panel (console)** — added an MCP Servers panel to the console: lists
`GET /mcp` with a status dot (green reachable / red unreachable / grey configured,
detail on hover) and a **↻ restart** button (`POST /mcp/:name/restart`) for
restartable (HTTP/SSE) servers. Completes the skill+MCP management UI loop. 563/563.

## BUILD (2026-06-14) — deterministic code-graph layer

The "invisible 20%" fix from the enterprise-ADO strategy: embeddings find code that
*looks* alike, not code that's *architecturally* related. `src/lib/codegraph/` adds
a deterministic symbol layer — **one exact word-boundary fixed-string search
(ripgrep, else grep) + PURE classification** of each hit as a definition vs a
reference (`isDefinitionLine` — keyword/binding/assignment/signature patterns).
Answers "where is X defined AND every place it's used," which powers the strategy's
done-check (verify you changed every call site). Offline, lean (no new dep),
injection-safe (`isValidSymbol` gate). Exposed as the **`code_graph`** tool (new
`codegraph` connectivity capability, available every mode), `GET /codegraph?symbol=`,
and routed into the CLI executors (`/bee/code_graph`). The routing guide tells
agents to use it to verify all usages — not to trust semantic similarity for that.
**Provers:** `codegraph/contracts.test.ts` (validation, parse, def-vs-ref classify,
real temp-repo lookup, injection-safety). Full suite green; daemon bundles (865kb).

## BUILD (2026-06-14) — AGENTS.md (repo conventions) support

`src/lib/conventions/agents-md.ts` — reads the project's **AGENTS.md** (the
converged conventions standard) and injects it so every coding task follows house
style. Codex reads AGENTS.md natively; **Claude Code (reads CLAUDE.md) and the
local Qwen agent do NOT** — so HiveMatrix injects it for both (generic-agent system
prompt + Claude Code `--append-system-prompt`). Per the ETH Zurich finding we inject
the repo's *authored* file verbatim (bounded 8KB, cloud-stall-safe) — never
auto-generate one. **Provers:** `conventions/agents-md.test.ts`. 571/571 green;
daemon bundles (867kb).

## BUILD (2026-06-14) — compliance audit log (SIEM-exportable)

`src/lib/audit/` — append-only **JSONL** audit trail (daily files under
`~/.hivematrix/audit`) recording per task: prompt, agent/model, project, outcome,
turns, and a best-effort **diff stat** (`git diff --stat`). Written from the
task-completion handler (success + failure branches, non-blocking) — `recordTaskAudit`
+ `recordAudit`. Long fields clamped; secrets never logged. Surfaced via
`GET /audit` (filter by taskId/status/event/limit, newest-first) and
`GET /audit/export` (NDJSON download for Splunk/Elastic SIEM ingestion).
**Provers:** `audit/audit.test.ts` (append/read/filter, clamp, injected diff
capture, no-diff path). 575/575 green; daemon bundles (873kb); scope-wall clean.

**Remaining ADO enhancements parked** in brain doc
`2026-06-14-ado-remaining-enhancements.html` (on-prem ADO Server REST path for
air-gapped shops; monorepo affected-target detection; remote-MCP-for-non-MS-agents;
PR-review-as-required-status) — to revisit if those audiences come up.

## BUILD (2026-06-14) — skill UI + sharing strengthened

**Sharing safety (the key add):** skills now carry **`trusted`**. Distilled/manual
skills are trusted; **imported skills are UNTRUSTED** (a shared/public skill is
instructions an agent would follow — a prompt-injection vector) and are **filtered
OUT of the auto-injected agent index** until the operator approves them. So a
malicious shared skill can't silently influence agents; it's visible + explicitly
runnable, but not auto-fed to agents until trusted.
- Import accepts `{url}` OR `{content}` (paste), marks `trusted:false`.
- `POST /skills/:name/trust`, `DELETE /skills/:name`, `GET /skills/:name` (full +
  shareable markdown for export/copy).
- Store: `setSkillTrusted`, `deleteSkill`; `listSkills`/`readSkill` carry `trusted`.

**Console UI:** the skill panel gained **View** (inspect/verify), **Copy** (export
shareable markdown to clipboard), **Trust** (approve imported — shown only when
untrusted), **🗑 Delete**, and an **⚠ untrusted** badge in the meta line.

**Provers:** `skills/store.test.ts` (untrusted import → approve → delete; distilled
defaults trusted) + contracts round-trip. 577/577 green; daemon bundles (879kb).

## BUILD (2026-06-14) — script-skill class + deterministic release

**New skill class: `kind: script`.** Alongside instruction skills (LLM recipes),
a **script skill** is a deterministic executable run verbatim through its
`interpreter` (bash/node/python) — same result every time, no model in the loop;
AI-callable, sharable, and (being code) run ONLY when **trusted**. Runs in the
**background** with output streamed to a log (releases take minutes); status read
back from an exit marker. `src/lib/skills/run-script.ts` (`runScriptSkill` /
`getScriptRun`). Endpoints: `POST /skills/:name/run` executes scripts (returns a
`runId`) vs spawns a task for instruction skills; `GET /skills/runs/:id` polls;
`POST /skills` creates a skill (operator → trusted). Console: `⚙` marks scripts,
Run streams the live log. **Provers:** `skills/run-script.test.ts` (real bash exec,
exit codes, untrusted-refused, instruction-not-runnable).

**Deterministic release as the first script skill.** `scripts/release.mjs` — one
command: bump the 3 version files → typecheck + scope-wall + tests → commit + push
main → build signed/notarized .app + DMG (with the Tauri updater key) →
`publish-release.sh` (GitHub release + `latest.json` feed) → `release:verify`.
After it, installed users get the **update pill** and new users get a **DMG**.
Fails fast; preconditions checked (on main, updater key present, version not reused).
Wrapped by the `release-hivematrix` script skill (`<brain>/skills/`) so it's
AI-launchable. 582/582 green; daemon bundles (885kb).
**Can't test live from here** (needs signing cert/notary/Tauri/network) — the
orchestration is grounded in `docs/RELEASE.md` and syntax-checked.

**Ops scripts → script skills (2026-06-14).** Converted the operationally-useful
diagnostics/proofs/health/guard scripts into trusted bash script skills in
`<brain>/skills/` (all parse-verified, kind=script): `hive-soak` (soak scenarios),
`hive-qwen-readiness` (local-model probe), `hive-verify-release` (update-feed proof),
`hive-update-proof` (update-apply gate), `hive-desktopbee-proof` (helper), and
`hive-scope-wall` (architecture guard) — each wraps `npx tsx scripts/<x>.mts` /
`npm run <x>`. Now launchable from the skill dropdown or by an agent, and sharable.
Build sub-steps (build-app/dmg/sign/notary) left as release-internal, not standalone.

**Problem.** We have a *model* router (role → tier) but no *capability* router
(intent → lane). Channel lanes are wired as inbound pollers + post-exit side-effects, not
as outbound tools. A spawned agent has `bash/read/write/edit/search/list/create_task` +
`webbee_search/browserbee_run/desktopbee_action/termbee_*` and **no** `mailbee_send`,
`messagebee_send`, or LinkedIn action. So "send an email" reaches no Bee — the agent
improvises with bash/osascript/WebFetch. Same root cause behind the LinkedIn failure
(Browser Lane depends on Codex auth / Desktop Lane fallback) and "how does it use brain docs"
(no retrieval — memory bundle is pinned paths only).

**Proposed scope (no new public lane brand — scope wall respected).**
1. **Outbound tools** (TOP PRIORITY) — `mailbee_send`/`mailbee_draft`, `messagebee_send`,
   and a LinkedIn/browser action path, added to `bee-tools.ts` + executed in
   `executeBeeTool()`, gated by `classifyMailTrust` + ConnectivityPolicy. Surfaced in
   relevant agent profiles + a system-prompt routing table ("to send email use …").
2. **Brain retrieval** — `brain_search` tool (FTS5/keyword over `~/_GD/brain`) so docs
   are findable by relevance, not only by pinned path.
3. **Learning loop** — connect `directive-autonomy` reflection to the `feedback` backlog;
   add lightweight evals (later phase).

**Considered alternatives.** Adopting Hermes (`NousResearch/hermes-agent`) or OpenClaw
wholesale. Rejected for now — they lack our trust classification, offline/local-Qwen
connectivity policy, prover-gated Directive primitive, and signed-app updater. Possible
future: embed Hermes as an alternate agent runtime behind the daemon (it can run Claude
Code as a subagent) to get its self-improvement loop + browser + RAG without losing our
safety/offline/updater shell.

**Provers (when scheduled).** "send email to X" routes to Mail Lane draft/send under trust
gate (not bash); `brain_search` returns a doc not pinned in the directive; LinkedIn action
path reports a clear actionable error when Codex/Desktop Lane unavailable instead of silent
fallback.

## Console UI/UX — collapsible right panel, Setup auto-collapse, ops grouping (2026-06-14)

**Decision.** The console main screen's right "Context" panel is now collapsible and
the Setup block self-hides once onboarding is complete, removing the "sometimes just
extra" clutter without losing one-click access.

- **Collapsible right panel.** A `▦` header toggle (`toggleContext()`) adds/removes
  `main.ctx-collapsed`, which drops the third grid column (`300px 1fr` instead of
  `300px 1fr 320px`) and hides `.col.context`. State persists in
  `localStorage.hm_ctx_collapsed` and is re-applied on load via an IIFE; the toggle
  button lights (`.ctx-toggle.on`) when the panel is showing.
- **Setup auto-collapse.** Setup is wrapped in `<details class="ctx-sec" id="setupSec">`.
  When `renderOnboarding` sees `o.requiredComplete`, the summary becomes "Setup ✓" and
  the section auto-collapses once (guarded by `dataset.autocollapsed`) so it stops
  taking space after first-run, but stays one click away.
- **Ops grouping in the skill launcher.** `renderSkills` splits the dropdown into
  `⚙ Ops / scripts` (script-kind skills) and `Skills` (instruction skills) optgroups,
  surfacing the deterministic ops scripts as their own group.
- **One-click "run all proofs."** New script skill `hive-run-all-proofs` (brain/skills,
  kind:script, trusted) runs scope-wall → release:verify → qwen-readiness →
  update-apply-proof → desktopbee-proof in sequence, never stops on first failure, and
  exits non-zero if any fail. Appears under the Ops group; launchable from the dropdown.

**Verification.** `tsc --noEmit` clean, scope-wall 0 violations, daemon bundles, 582/582
tests pass, skill parses. Console JS itself can only be compiled/bundled here, not
browser-rendered.

## Settings refinement — tabbed reorg, Mixed-mode role models, Cloudflare clarity, panel icon (2026-06-14)

**Decision.** The Settings → Models tab had become a kitchen sink (appearance, location,
updates, remote access all crammed under "Models"). Split into focused tabs and made two
things first-class: per-role model selection in Mixed mode, and both Cloudflare tunnel modes.

- **Tabbed reorg.** Settings tabs are now **Models | Remote | General | Projects | Lanes**.
  - *Models*: default model, backends, frontier provider, Mixed-mode role models, local endpoint.
  - *Remote*: Cloudflare remote access (was buried in the Models tab).
  - *General*: appearance (theme/wallpaper/opacity), location, updates, version.
  All element IDs preserved, so `openSettings`/`loadTunnel` population is unchanged; only the
  containing tab `<div>`s and `switchSettingsTab` (now table-driven over 5 tabs) changed.
- **Mixed-mode role models.** New block in the Models tab with three selectors —
  🧠 Thinking (→ `frontier-premium` / `thinkModel`), ⌨️ Coding (→ `frontier` / `frontierModel`),
  ⚙️ Operational (→ `local-secondary` / new `operationalModel`). Shown only when a Mixed posture
  is available (local + frontier configured). Each defaults to "Default" (router fallback);
  Claude selectors disable with a note when the frontier provider is Codex (which overrides them).
  Wiring: `getRoleModels`/`setRoleModel` in `models/available.ts`, `operationalModel` honored by
  `routing/model-resolver.ts` for the local-secondary tier (override → Qwen secondary → primary),
  exposed via GET `/models` (`roleModels`) and set via POST `/settings` (`{roleModel:{role,modelId}}`).
- **Cloudflare: both modes visible.** The named/durable tunnel (hostname URL + Access creds +
  connector token) was hidden inside a collapsed "Advanced" `<details>`. It's now a clearly
  labeled **Named tunnel (durable · multi-user)** card sitting beside the **Temporary tunnel
  (quick test)** card — both always visible on the Remote tab. Matches the remote-access posture
  (named = durable/multi-user, trycloudflare = test-only). No endpoint changes.
- **Right-panel toggle icon.** Header toggle changed from `▦` (checkerboard) to `◨`
  (square with right half filled) — a recognizable "right panel" glyph.

**Verification.** `tsc --noEmit` clean, scope-wall 0 violations, 588/588 tests pass (added
resolver + role-model + console-UI coverage), daemon bundles. Console JS compiled/bundled here,
not browser-rendered.

## Desktop console: approval queue parity + remove dollar amounts (2026-06-14)

**Bug.** Approvals showed on hivematrix-ios but not on the desktop console. Root cause:
the daemon's unified approval queue (`GET /approvals/pending` — checkpoint/content/tool/
stuck gates, "W6.1") was consumed only by the mobile client. The desktop console never
fetched it; it surfaced only inline `needs_input` task replies, so checkpoint/content/
tool/stuck approvals were invisible on desktop.

**Fix (console-only — endpoints already existed).** Added an Approvals surface at the top
of the context column (`#approvals`):
- `renderApprovals()` renders the queue (kind badge, title, detail, one button per
  `options` entry — approve/deny, or stuck's retry/skip/abort).
- `resolveApprovalItem(idx, decision, btn)` POSTs `/approvals/resolve`
  `{taskId, timestamp, decision, kind}` (index-based to avoid HTML-attribute quoting),
  disables the buttons, then refreshes.
- Wired into `refresh()` (5s tick + SSE), so it stays live and at parity with mobile.
- Hidden (empty) when the queue is empty.

**Also: removed dollar amounts from the main screen** (operator request). The Frontier
Usage pill and breakdown no longer show `$` spend or per-model cost — they show task
counts + token totals (and subscription % remaining as before). Placeholders reworded
("No frontier usage yet — local Qwen work runs on-device").

**Verification.** tsc clean, scope-wall 0, 590/590 tests (added console coverage for the
approval queue + a guard that the main screen has no dollar amounts), daemon bundles.

## Observability — embedded, local-first, 3-provider normalized telemetry (2026-06-14)

**Decision.** Per the research/design doc (brain: 2026-06-14-hivematrix-observability-design),
we embed the idea rather than adopt a SaaS: an OpenTelemetry-GenAI-shaped telemetry layer in
the existing SQLite DB, surfaced in the console. No external dependency, works offline,
prompts never leave the Mac. Built P1 + P2.

**Data model.** New `task_telemetry` table (v17 migration): one normalized row per task-run,
`gen_ai.*`-shaped. NULL = unavailable, never a fake 0 (the correctness rule for trustworthy
totals). The dormant `usage_totals` table is now wired (daily rollup by provider + project).

**Normalizer** (`lib/observability/contracts.ts`, pure + unit-tested): `providerForModel`,
`normalizeRun` (latency, tokens/sec, unavailable-not-zero, cost provider-reported only — local
& Codex stay null), `summarizeTelemetry` (per-provider/model totals, latency p50/p95,
local-vs-frontier split). `lib/observability/store.ts` persists + rolls up;
`capture.ts` is called from agent-manager's success + failure exits (non-critical).

**3-provider solution.**
- Claude: maps directly from the result event (+ reasoning tokens now extracted in stream-parser).
- Qwen (local): OpenAI `usage` tokens; cost = null (free, on-device); tokens/sec computed.
- Codex: **token recovery** — `usage/codex.ts` now reads `info.total_token_usage` from
  `~/.codex/sessions/*.jsonl` (the file it already parsed for rate-limits), wired into
  `codex-agent`. Before recovery, tokens record as unavailable (null), not 0.
- TTFT: `firstTokenAt` captured on the first delta in all three runners.

**Surface.** `GET /observability` (totals + recent; `?taskId=` for one task). Console: a
per-task telemetry strip (model/provider/tokens/latency/tokens-per-sec/turns, no extra fetch)
and an Observability totals section (per-provider runs, tokens, latency p50/p95, local/frontier
split). **Cost is opt-in** (a toggle, off by default, persisted) and never on the main board —
honoring the earlier "no dollars on the main screen" change.

**Verification.** tsc clean, scope-wall 0, 609/609 tests (normalizer, store + rollup, Codex
recovery, console surface), daemon bundles. Not yet released.

## Codex arg bug fix + settings/console UX pass (2026-06-14)

**Bug: every Codex task failed with `unexpected argument '--- Outbound Channels …'`.**
`buildCodexPrompt` makes the prompt start with the routing guide ("--- Outbound
Channels (HiveMatrix) ---"); `codex exec`'s clap parser treats a leading-`--`
positional as an unknown flag and exits 2. Since Mixed mode routes code-critical →
Codex, those tasks couldn't run. Fix: pass the prompt after a `--` end-of-options
separator (`buildCodexExecArgs` extracted + unit-tested in codex-agent.ts).

**Console/settings UX (operator feedback):**
- **needs_input reply stands out** — the reply window gets a highlighted card
  (`.reply-section.needs`) with a "✋ Awaiting your reply" header; the submit is a
  labeled primary **Reply** button (was "↩ Send Reply"). (The "up arrow" the operator
  saw is the iOS app's send button — separate repo.)
- **Frontier provider vs role models** — evaluated: not a strict duplicate (provider =
  which provider; role models = which model within Claude), but when provider = Codex
  the Thinking/Coding rows were redundant disabled "Codex (provider override)" selects.
  Now those two rows are **hidden** when Codex is selected (replaced by a one-line note);
  only the local Operational role stays. With Claude, all three show.
- **About tab** added to Settings (version · build · released date · update status +
  Check-for-updates / Install buttons); version moved out of General.
- **Settings tab order** defined: **Models · Lanes · Projects · General · Remote · About**.
- Skills launcher already exists (right context panel → "Skills" section: dropdown + Run);
  no change, just confirmed.

**Verification.** tsc clean, scope-wall 0, 616/616 tests (codex args + new console
coverage), daemon bundles.

## Browser Lane: Codex Computer Use unavailable on ChatGPT-subscription accounts (2026-06-14)

**Investigation (LinkedIn "friend requests" task did nothing).** The parent agent created
a Browser Lane child task (model `codex:gpt-5.4-computer-use`) and reported "browser running,
I'll be notified." The child FAILED in ~10s with HTTP 400:
`"The 'gpt-5.4-computer-use' model is not supported when using Codex with a ChatGPT account."`
So Browser Lane's default "Codex Computer Use" backing (which is just `codex exec -m
gpt-5.4-computer-use` — no real browser harness) cannot run on a subscription Codex login.
The failure was silent; the parent's "you'll be notified" was false (no such notification).
(Confirmed the `--` arg fix works — the routing prompt showed as the user message, not an
arg error. Secondary: browserbee tasks got `projectPath: /`.)

**Fix.** The Browser Lane backing resolver now treats ONLY `api-key` Codex auth as usable for the
computer-use backing (was subscription|api-key). A subscription account routes to the
Desktop Lane fallback when enabled, else **refuses with a clear, actionable reason** instead
of creating a doomed task that 400s silently. The `browserbee_run` success message no longer
implies a push notification. Tests updated.

**Still open (operator choice):** to make browser tasks actually work on a subscription
account, enable the Desktop Lane fallback (`browserbee.desktopFallback=true`) so the local
model drives a real desktop browser via AppleScript/Accessibility — lower reliability, but
the only working path without an OpenAI API key.

**Verification.** tsc clean, scope-wall 0, 617/617 tests, daemon bundles.

## Reply to review/failed tasks (subtle box) (2026-06-14)

Operator feedback: a failed/review task where the agent asked a question (e.g. "tell me
which task failed") had only Retry/Archive/Delete — no way to *answer*. Added a Reply
affordance for review/failed/cancelled tasks, styled distinctly from the needs_input
standout:
- **Backend**: `POST /tasks/:id/reply` now accepts review/failed/cancelled (not only
  needs_input) — appends the reply via `appendReplyContinuation` and requeues the task
  so it re-runs with the operator's message in context.
- **Frontend**: a `↩ Reply` toggle appears on review/failed/cancelled tasks; opening it
  shows a **subtle** reply box (thin left rule, muted "your message is added and the task
  re-runs" subhead) — visually understated vs the needs_input card (highlighted card +
  "✋ Awaiting your reply"), exactly as requested.

Verification: tsc clean, scope-wall 0, 618/618 tests, daemon bundles.

## Fix false "unhealthy / fetch failed" on embedded bees (2026-06-14)

Review Lane, Memory Lane, and Browser Lane showed "unhealthy · fetch failed" though they run fine
(embedded in the daemon). Three-part bug in `service-manager` embedded health probe:
1. **Wrong port** — built the URL with `process.env.PORT || "4000"`; the daemon listens on
   `HIVEMATRIX_PORT` (3747), so it hit :4000 (nothing there) → "fetch failed". Now uses
   `HIVEMATRIX_PORT ?? PORT ?? 3747`.
2. **Wrong Browser Lane path** — probed `/api/browserbee/health` (404); the real route is
   `/browserbee/health`. Fixed (managerbee/brainbee `/api/*/health` aliases are correct).
3. **No auth on the loopback probe** — those routes are token-gated (401 without it), but
   `checkHealth` sent no header. Now passes the daemon shared secret (`readToken`) on the
   embedded probes; external launchagent probes (e.g. inventorbee :4014) still go unauthenticated.

Verification: tsc clean, scope-wall 0, 619/619 tests (added embeddedHealthRoute guard), daemon bundles.

## Terminal Lane + Desktop Lane showed "planned · No runtime registered" (2026-06-14)

Both are real, working lanes (Terminal Lane in-process; Desktop Lane = the Swift helper on :3748)
but were ABSENT from the service-manager descriptor map, so they fell through to the
default `runtimeMode: "planned"`. ("computerbee" — the retired ComputerBee compatibility name — was still
listed but unused.) Fixes:
- Added `termbee` (embedded; no health route → live with the daemon) and `desktopbee`
  (embedded) descriptors.
- New daemon route `GET /desktopbee/health` pings the Desktop Lane helper via probeDesktopBeeHelper →
  200 when up / 503 when unreachable; mapped `embeddedHealthRoute("desktopbee")` to it, so
  the lane status view shows Desktop Lane's real (green) health.

Verification: tsc clean, scope-wall 0, 620/620 tests, daemon bundles.

## Mail Lane: agent reached for Gmail MCP instead of Apple Mail (2026-06-15)

Two operator reports: asked to "delete emails matching Run failed" and to email wallpaper
files, HiveMatrix replied (by text/email) "run `/mcp` and authenticate claude.ai Gmail" —
impossible in the headless daemon, and the wrong tool (Mail Lane = Apple Mail). Root causes +
fixes:
1. **Routing guidance only covered SENDING.** Added to `outboundHttpRoutingPrompt`:
   - "Reading & managing email" → drive local Apple Mail via osascript; do NOT use a Gmail/
     Google MCP/web Gmail/IMAP; for bulk deletes, MOVE to the Trash mailbox (recoverable)
     and report count + criteria.
   - "Headless: never ask for interactive auth" → NEVER tell the user to run `/mcp`/`/login`
     or authenticate an MCP; use the local path or report the limitation.
2. **Mail Lane attachment path could not attach files** (so "email me the wallpapers" reached for Gmail). Added
   attachment support end-to-end: `applemail.ts` SEND_SCRIPT attaches via Apple Mail;
   `sendMail`/`draftMail` take `attachments[]`; `executeMailBeeSend/Draft` + the
   `mailbee_send`/`mailbee_draft` tool schemas accept `attachments`; `parseOutboundFields`
   collects repeated `attachment=` form fields / JSON `attachments[]`; `/mailbee/send` passes
   them; routing prompt documents `--data-urlencode "attachment=/ABSOLUTE/PATH"`.

Verification: tsc clean, scope-wall 0, 626/626 tests, daemon bundles.

## Q12 — Voice Lane un-deferred (voice ingress/egress lane) + video factory as a no-brand capability

Date closed: 2026-06-16. Phase 0 of the voice/video persona plan
(brain: `projects/hive/plans/2026-06-16-voice-and-video-persona-strategy.md`).

**Context.** The "virtual persona" strategy needs voice. Prior art kept the design
but scope-wall forbade the code (`projects/hive/bees/voicebee.md`, component map).

**Decision A — Voice Lane un-deferred** from "designs kept, no code" to an active
**local-first** voice lane (mirrors the Q8/Q9 Message Lane/Mail Lane un-defer):
configured STT command → Hive LLM → cloned-voice TTS (F5-TTS/Chatterbox) orchestrated by
Pipecat. Two surfaces — **conversation mode** (Mac/iPhone mic, fully local) and
**phone-answer mode** (Twilio/Telnyx SIP trunk → local pipeline). Hive stays the
control plane; voice notes/calls land as task artifacts. The only external seam is
the phone number (a dumb pipe, not an AI vendor). First ship is iMessage voice
replies (extends the Q9 Mail Lane attachment pattern to Message Lane `send file`).

**Decision B — Video factory is a no-brand capability.** The script→video pipeline
(Remotion + ffmpeg + Playwright screen-capture, cloned-voice voiceover) is a
capability/workflow, **not** a new public lane brand — same posture as the
YouTube-import-to-Browser-Lane recipe decision. Extends `content/pipeline.ts` + the `marketing`
role. The AI avatar is **demoted to an optional component** (HeyGen, used sparingly
for hero presenter shots only) per the 2026 trust-penalty evidence; default is
faceless screen + cloned voice. No `VideoBee`/`AvatarBee` brand is created.

> **SUPERSEDED 2026-07-05 (Decision B only):** The video factory / HeyGen video
> pipeline was removed entirely to simplify the codebase (worker models were
> confused by the unused surface). TTS collapsed to the single **Kokoro** voice
> (no cloned VoxCPM2 voice). The generic workflows infrastructure and the two
> independent content workflows (research brief, YouTube summary) stay. HeyGen
> remains only as a generic Browser-Lane-browsable site, not a video capability.
> See `docs/superpowers/specs/2026-07-05-voice-video-simplification-design.md`.
> The rest of Q12 (Voice Lane) stands.

**Scope wall + COMPONENT-MAP amended** in this change: removed the Voice Lane
hard-fail rule; `voicebee` compatibility id added to the no-new-brands allowlist; Voice Lane
listed as a Q12 lane and dropped from the deferred list.

**Persona identity (P0.4).** The virtual person is a **digital twin of the
founder** — the founder's own name, cloned voice, and (optional, sparing) likeness.
On-strategy with the authenticity thesis: the agent is the founder, scaled — not a
separate branded assistant.

Verification: scope-wall 0 violations for the Voice Lane compatibility id; docs
only — no runtime code yet (that's P1+).

## BUILD (2026-07-04) — W8 presence layer: Heartbeat + daily moments + operator modeling

Built the NEXT-LEVEL-SPEC W8 heartbeat natively into Flash Lane (no new public
brand; no OpenClaw runtime):

1. **Heartbeat pulse** (`src/lib/flash/heartbeat.ts`) — every N min (default 30,
   quiet-hours aware) one unprompted flash turn over `persona/HEARTBEAT.md`
   (seeded on first enable) + a live `composeBriefing()` status snapshot. The
   model must reply `HEARTBEAT_STAND_DOWN` unless something is genuinely worth
   doing/saying — silence is the default. The **Autonomy dial shapes each pass**:
   manual = observe/report only; standard = routine low-risk actions; autonomous
   = act freely inside the lanes' existing hard gates, no extra approval
   friction (operator decision 2026-07-04: fully-autonomous must skip extra
   approvals). Reports fan out via notify() AND land as replyable assistant
   turns in the operator console session — proactive pings are conversations.
2. **Daily moments** — persona-voice morning brief (default 8h; "what happened /
   what's blocked / the ONE decision today / what I suggest") and evening recap
   (default 21h; "what I did for you today"), APNs-first with notify() fallback.
   This replaces the retired Morning Briefing brand WITHOUT resurrecting it —
   `startMorningBriefingLoop` stays unused and the `index.test.ts` ban holds.
3. **Operator modeling** (`src/lib/flash/distill.ts`) — distillation now extracts
   durable operator facts into `persona/USER.md` ("Learned about the operator":
   dated, deduped, bounded 40). Operator-peer sessions only; every write is
   announced via `flash:persona_updated`. USER.md stops being a dead template.
4. **Surfaces** — `GET/POST /settings/heartbeat`, `POST /heartbeat/run`
   ({moment} optional); Settings → Heartbeat card (enable, interval, quiet
   hours, moment hours, run-now buttons). Delivery deps (notify/APNs/
   composeBriefing) are daemon-injected so flash/ keeps its import surface.

**Provers:** 18 new unit tests (heartbeat 12, distill merge 6); full suite
2582/2582 green; typecheck + scope-wall clean; daemon bundle builds (223.6 MB).

## BUILD (2026-07-04) — proactive-partner Tier 2: episodic planner, goal ledger, pattern detection, persona evolution

Continued the W8/W9 direction with four self-thinking increments (all keyless,
local-model or deterministic; autonomy-dial aware):

1. **Episodic directive planner** (`directive-engine.ts` + `directive-store.getRecentTerminalRuns`)
   — the plan prompt now carries the directive's recent run outcomes + last
   reflection, so each episode builds on the previous ("do not repeat an approach
   that already failed") instead of replanning blank. Deterministic fallback
   unchanged. The stale "intentionally deterministic v1" header was corrected.
2. **Goal ledger** (`distill.ts` → `persona/GOALS.md`) — distillation extracts
   stated operator goals/deadlines (distinct from facts) into GOALS.md, injected
   into every flash turn + the morning brief so proactive output anchors to real
   goals. Brain/persona doc ONLY — the scope wall forbids a personal Goals
   product surface; the Chief-of-Staff pack is the future sanctioned home.
3. **Pattern detection** (`src/lib/feedback/pattern-detection.ts`, daily via the
   learning loop) — clusters the recurring open backlog and files ONE deduped
   enhancement proposal per chronic pattern ("this keeps happening — root-cause it
   with a directive or skill"). Feeds the self-improvement directive. Proposing is
   free; acquiring stays gated.
4. **Persona evolution** (`src/lib/flash/persona-evolution.ts`, weekly) — turns the
   same chronic clusters into bounded, append-only SOUL.md operating notes.
   Autonomous → apply + announce (flash:persona_updated + `persona_evolved`
   audit + .bak backup); standard/manual → propose. A model never rewrites the
   soul (note generation is injected; default is deterministic synthesis).

**Provers:** 16 new tests (directive history 2, goals 3, pattern detection 5,
persona evolution 6); full suite 2605/2605; typecheck + scope-wall clean.

## BUILD (2026-07-04) — adaptive autonomy: trust ramp + capability self-assessment

Two increments answering "self-learning + add capabilities automatically" while
holding the ClawHavoc safety line.

1. **Trust ramp** (`src/lib/approvals/trust-ledger.ts`) — the autonomy dial is a
   blunt switch; this makes autonomy earn itself. Per action class, the ledger
   records operator approve/deny outcomes (`resolveApproval` folds in every real
   decision, skipping auto-decisions so the ramp can't train itself). Under
   AUTONOMOUS mode, a class with ≥3 clean approvals + 0 denials auto-approves
   without the operator flipping a toggle (`maybeAutoApproveRequest` consults it
   after the explicit policy, audit-logs `auto_approved`). A single denial revokes
   the class. **Hard floor:** only `checkpoint`/`lowRiskTool` are ever
   trust-eligible — content, external, risky-tool (bash/MCP), stuck, and every
   protected action can NEVER auto-approve at any trust level, even in autonomous
   (`trustKey` returns null, so no history accrues). Escape hatch: `resetTrust`;
   endpoints `GET /trust`, `POST /trust/reset`.
2. **Capability self-assessment** (`src/lib/feedback/capability-gaps.ts`) — reads
   the backlog for missing-capability friction, classifies the remedy
   (skill|lane|pack|unknown) + whether it's self-serviceable, and files one
   labeled proposal per gap. **Proposing is free; acquiring is gated.** Only
   skills are self-serviceable (first-party, sandboxed, already auto-distilled);
   lanes (credentials) and packs (must be signed) ALWAYS require operator
   approval, even under fully autonomous. The module never installs/enables
   anything. Runs daily in the flash learning loop next to pattern detection.

**Provers:** 13 new tests (trust 8, capability gaps 5); full suite 2618/2618;
typecheck + scope-wall clean.

## BUILD (2026-07-04) — Deep Think: test-time compute scaling on the local model

Researched 2026 agent test-time-scaling results (arXiv:2506.12928 "Scaling
Test-time Compute for LLM Agents" + self-certainty/best-of-N follow-ups). The
findings that matter for a keyless local stack: parallel sampling + simple
self-consistency beats external reward models; list-wise merging beats
per-candidate scoring; reflection helps only when applied selectively ("know
when to reflect"); diversified rollouts pay. Local DeepSeek tokens are free on
this Mac, so structured extra inference is the "smarter" lever — no cloud, no
bigger model.

**Built** `src/lib/models/deep-think.ts` on the keyless chat-client (uses the
0.1.133 per-request thinking toggle): N temperature-diverse parallel rollouts
with thinking ON → pairwise-agreement self-consistency signal → temperature-0
list-wise synthesis over all candidates → skeptical critique-revise pass ONLY
when candidates disagreed. Returns calibrated confidence (high/medium/low).
Budget-capped, degrades gracefully, injectable client for tests.

**Wired** as flash tool `deep_think` — the conversational agent self-selects it
for strategy/analysis/logic where a wrong answer is costly; the reply carries
the calibration metadata (attempts, agreement %, confidence, revised-or-not).

**Provers:** 10 unit tests (similarity/agreement math, prompt shapes, rollout
diversity, reflect-on-disagreement, partial/total failure paths, fallbacks);
full suite 2629/2629; typecheck + scope-wall clean.

**Future (not built):** deepThink for directive plan-phase (planner runs as a
spawned harness task today), POST /think endpoint, agreement-driven escalation
to a second local tier (Qwen cross-model ensemble).

## BUILD (2026-07-04) — voice beef-up: deep-think, goals, memory, heartbeat by voice

Four new capabilities on the push-to-talk command layer (`command-intent.ts` +
`command-turn.ts`) — the TS path every voice surface shares; the Python sidecar
is untouched (it carries a concurrent session's in-flight work):

1. **deepThink** — "think hard about X": immediate ack, background
   models/deep-think pass, answer read back via voice:result with honest
   confidence framing. Multi-attempt local reasoning from the phone.
2. **goals / addGoal** — "what are my goals" speaks persona/GOALS.md; "add a
   goal to X" / "my goal is X" appends dated + deduped. Voice-writable goal
   ledger. "standing goals" still → directives.
3. **remember** — "remember/note that X" → timestamped bullet in
   persona/memory/YYYY-MM-DD.md. "remember to X" stays a task.
4. **heartbeatNow** — "run a heartbeat / pulse now" fires one pass and speaks
   the report; runner daemon-injected via CommandTurnDeps (voice/ never imports
   flash/).

**Provers:** 10 tests (intent collisions incl. remember-that vs remember-to,
executor incl. async voice:result broadcast); suite 2639/2639; typecheck +
scope-wall clean. The server-side dep injection hunk rides in server.ts with
the pending /trust endpoints (entangled file, committed separately).

## REVIEW + HARDENING (2026-07-04) — adversarial pass over the proactive-partner stack

Ran an independent adversarial review over the day's ~15 commits; 9 verified
findings, all fixed same-day (commit 7b218ea). The two that mattered most:

1. **Heartbeat autonomy was prose-only** — the unprompted pulse carried the full
   outward tool set (mail_send/terminal_run/...) at every autonomy level, with
   operator-editable + inbound-derived text in its prompt. Now HARD-gated:
   `runFlashAgentLoop({allowedTools})` filters at offer AND dispatch; manual =
   read-only, standard = +escalate, autonomous = full (lane gates still inside);
   daily moments always read-only.
2. **Learning was once-per-lifetime** — cold-session selection excluded any
   session ever distilled, and sessions are everlasting per channel+peer, so
   USER.md/GOALS.md modeling fired exactly once. Now: re-distill when active
   since last distillation, consuming only new turns.

Also: section-safe persona writes via the new shared `brain/persona-section.ts`
(bullets were landing in — and evicting from — operator-authored sections);
anchored voice intents; trust spot-checks every 10th grant (denial-based
revocation was unreachable) + removed the dead lowRiskTool path; persisted
learning-loop throttles (restarts made "weekly" mean "every release"); count-free
SOUL notes (live counts defeated dedup); daily-moment enable-seeding and
manual-send marking; async voice pulse; atomic config writes; deep-think rollout
wall enforcement. Verdict on "redo completely": not warranted — architecture
follows the approved W8/W9 specs; the defects were seams, all now regression-tested.

**Provers:** 2647/2647 tests, typecheck + scope-wall clean.

## Q13 — The Inversion: local model does not write shipped code (2026-07-06)

**Decision:** In Mixed mode, code work routes to the frontier by default. The local
model's role is (a) 24×7 ambient cognition — heartbeat, distill, operator modeling,
accountability pulses, cheap-web, non-code extraction/file-ops — where its free, always-on tokens
are a real economic advantage; and (b) a draft/fallback stage inside the repair
ladder, never the owner of code that ships. Local coding remains only as an offline
fallback, and when it runs it accrues frontier-review-debt that auto-fires on
cloud-ok (already built — `frontier-debt.ts`). Rationale: coding is bursty,
quality-critical, latency-sensitive — the local model's weakest workload; frontier
wins on quality-per-dollar once rework and the operator's own review time are
counted. Chasing local code parity spends engineering hours the Solo-Founder plan
needs for revenue. Full analysis: `~/_GD/brain/2026-07-06-hivematrix-task-pipeline-review.html`.
**Code (verified 2026-07-06):** The inversion is ALREADY realized where it is safe.
User-dispatched coding (`model:"mixed"`) routes via `code-critical` → frontier in
cloud-ok (`subprocess.ts:374`); cloud-only posture forces frontier. The only role on
local is `execute`, which is the autonomous directive/ambient path
(`directive-engine.ts:622/651/691`) — accountability scorecards, audits, distill, file ops —
which SHOULD stay local per this decision. `execute` does not distinguish code from
non-code, so a wholesale `execute`→frontier flip is WRONG (it would push ambient
cognition onto frontier). The repair-ladder static stage shipped 2026-07-06
(`hive-verify-smoke.py` ruff Stage-0, `code-smoke.ts`, `generic-agent.ts` retries 2→4).
**Status:** policy decided AND already in force for the user coding path. Remaining
work is NOT a tier flip — it is a code/non-code signal on `execute`-role tasks so that
autonomous *coding* can escalate to frontier while ambient work stays local. Deferred.

## Q14 — Complexity budget: a five-concept kernel, no new stores without a decision (2026-07-06)

**Decision:** HiveMatrix is maintained by one person; complexity is the top predictor
of "things break as tweaks and enhancements land." The system is defined by five
concepts — **Event, Task, Directive, Policy, Persona/Memory** — and everything else
is an adapter over them. New concepts, orchestration primitives, or persistent stores
require a DECISIONS.md entry that names what gets deleted. The Subtraction Pass targets
(future work): fold Work Packages into Directives; retire the in-house local *coding*
harness (keep the conversational flash loop); collapse the router to a lookup table;
unify the four permission systems (autonomy dial + trust ledger + directive
approvalPolicy + bee-tool gates) into one `decidePolicy()` choke point WITH the
protected-action hard floor intact; converge lanes onto one channel-adapter interface.
The four operator personas (solo founder / 1-person dev / self-improver / small-biz
owner) are the same kernel with different directive packs, channels, and persona
content — differentiation is configuration, not code. Do NOT simplify: the directive
engine, telemetry, and the heartbeat/distill/persona stack — those are the product.
**Code:** scope-wall extended 2026-07-06 with a warn-only "new persistent store"
tripwire (`scripts/scope-wall.mjs`) — a CREATE TABLE outside `db/index.ts` /
`brain/index-db.ts` now flags for a decision.
**S4 permission unification — step 1 shipped 2026-07-06** (`src/lib/approvals/decide-policy.ts`):
the auto-approval decision (explicit policy → earned trust → hard floor) is extracted
from `approval.ts`'s I/O path into one pure, tested `decidePolicy()`; `maybeAutoApprove
Request` delegates. Hard floor unchanged (in `trustAllowsAutoApproval` +
`NEVER_AUTO_APPROVE`) and now pinned by an exhaustive floor-invariant test.
**What legitimately converges here — DONE:** the auto-approval (checkpoint-class)
decision. Directive checkpoints (`directive-engine.ts:164`) and content publication
(`content/pipeline.ts:104`) already flow through `decidePolicy` transitively via
`requestCheckpointApproval`.
**Verified NOT to unify (they are DIFFERENT decisions — collapsing them would ADD
complexity, not remove it):** mail/message recipient allowlists (`lane-tools.ts` — a
hard allowlist membership check, not a trust-ramp; mail drafts on miss, message errors
+ self-loop guard), work-package auto-land (`shouldAutoLand`, orchestrate.ts — risk/
executionMode-based), and desktop action tiers (`decideApproval`, desktopbee — app-
allowlist tiers). Each keeps its own hard floor. Do NOT force these into `decidePolicy`.
**WP→Directive fold — investigated 2026-07-06, NOT RECOMMENDED as a "fold".** The S1
framing ("a Work Package is just a short-lived directive whose criteria are its items")
does not hold against the code: Work Packages is a large live subsystem (~8,449 LOC,
~15 files, its own Flight-loop scheduler + coordinator, started at `daemon/index.ts:142,148`),
and the mapping is leaky — a WP *item* (`prompt`/`dependsOn`/`executionMode`/`createdTaskId`/
`commitHash`/`blocker`) is a unit of executable DAG work, whereas a directive *criterion*
(`description`/`proverId`/`proven`) is a prover-gated success condition. They are different
primitives with different lifecycles (WP = ephemeral one-shot DAG; Directive = standing,
episodic, prover-gated). Folding items→criteria would strip the DAG + execution-result
fields and break the Directive's "criteria = proven truths" model — relocating complexity,
not removing it. **Recommendation: keep both as separate primitives** (like the permission
gates that were verified NOT to unify). Revisit only if a concrete pain point (not concept
count) demands it; if so it is a multi-session migration on the live autonomous path, not a
tail-of-budget change.
**Status:** budget + tripwire live; S4 auto-approval unification effectively complete;
WP→Directive fold investigated and not recommended. The Subtraction Pass's safe wins are landed.

**Provers (2026-07-06 slice):** 26/26 verification-gate tests, typecheck + scope-wall clean.

## Q15 — Flights / Work Packages removed; broad prompts self-plan via Superpowers (2026-07-06)

**Decision:** The Flights / Work Packages decomposition-and-DAG subsystem is deleted
in full — `src/lib/work-packages/`, its `work_packages` / `work_package_items` /
`flight_loops` / `flight_loop_passes` tables, the orchestration + Flight-loop scheduler
loops, all `/work-packages/*` routes, the Task Intake classifier (`classify.ts`) and
model-advised `decompose.ts`, and the console Flights UI. Historical data does not matter
(no migration; the tables are simply no longer created or queried).
**Replacement:** broad, multi-step prompts dispatch as a **single task** with
`workflow: "work"`, which the `LEGACY_PREFIXES` map turns into a `/workflows:work`
Superpowers skill prefix so the frontier coding harness plans and executes its own
subtasks with full code context. Wired at `POST /tasks` (broad auto prompt → `workflow:"work"`)
and in Flash's `escalate_to_task` tool (formerly `escalate_to_work_package`, now creates a
`workflow:"work"` task). Breadth detection survives as `src/lib/intake/breadth.ts`
(`isBroadPrompt`). Scope-wall now forbids the Flights / Work-Package brand from returning.

## Note (2026-07-08) — DeepSeek/ds4 removal: documentation pointer

DeepSeek V4 Flash ("ds4" / DwarfStar) was removed in full on 2026-07-06 (see
`docs/superpowers/plans/2026-07-06-qwen-only-local-presets.md`). The local model
stack is now Qwen-only (Qwen3.6-35B-A3B via Rapid-MLX). Earlier entries in this
log that reference DeepSeek/ds4/DwarfStar as the current or primary local model
(e.g. Q2, the BUILD entries around 2026-07-04) are historical decisions kept
for record — they predate the removal and no longer reflect the live stack.

## Q16 — Delegation result read-back reinstated (narrow); Q15 decomposition stays dead (2026-07-09)

**Context.** The 14-profile agent roster (`src/lib/config/agent-profiles.ts`) has never
routed a task to anything but `developer` — verified against the live DB, 64/64 tasks.
The COO profile can call `create_task` but is architecturally blind: `executeCreateTask`
(`tool-bridge.ts:441-508`) POSTs a subtask and returns immediately; the parent agent's
process exits without ever reading what its child produced. A coordinator that cannot
observe outcomes cannot coordinate. Fixing that requires a parent to read its children's
results — which sits close enough to the decomposition-and-DAG shape of Q15 that it needs
its own explicit decision, not a quiet reopening.

**Decision — reinstated:** a parent task may read the outputs of its own already-completed
children, via a **continuation** (reusing the existing human-reply mechanism,
`appendReplyContinuation`, `server.ts:4073-4113`) — never by blocking a scheduler slot. The
scheduler additionally honors the pre-existing `dependsOn` column
(`src/lib/db/index.ts:50,793,818,831,1083`) for ordering, via the pre-existing, previously
unwired `dag-engine.ts` (Kahn cycle check). **No new persistent store is created** —
`parentTaskId`, `dependsOn`, and `reviewState` (as the state carrier, mirroring the existing
`needs_input` value) already exist.

**Decision — NOT reinstated, and still forbidden by the scope wall:** preflight
decomposition. There is no task-intake classifier, no `decompose.ts`, no
`work_packages`/`work_package_items`/`flight_loops` tables, no Flights UI, no Flight-loop
scheduler, and no Work Package brand. Broad prompts still self-plan as a single
`workflow:"work"` task via Superpowers, exactly as Q15 specifies. `missionId`,
`missionPhase`, `goalAncestry`, and `scheduledTaskId` remain removed.

**Why this is not Q15 returning.** Q15 removed decomposition performed *before the work
began, by a classifier that had never read the code* — a preflight splitter operating on
guesses. What this reinstates is synthesis performed *after the work is done, by an agent
that already had tools in hand and looked around* — the COO decomposes at runtime with full
context, and the only new capability is reading back what its own children, which it itself
spawned with that context, produced. The failure mode Q15 cited (planning without context)
is not reintroduced; nothing here plans on the system's behalf before an agent has started.

**Scope, explicitly bounded (see `docs/superpowers/specs/2026-07-09-coo-delegation-result-readback-design.md`):**
- Depth capped at 2 (no grandchildren), sibling cap 10 — both **fail closed** on any internal
  check error (previously fail-open, a latent bug fixed as part of this work).
- A parent may resume **at most once** per delegation round — the anti-runaway guard.
- No agent-to-agent messaging, group chat, blackboard, or free-form dialogue. Delegation is
  one-hop and structured: a subtask with a result, never a conversation.
- No DAG visualization UI, no automatic `dependsOn` inference — the COO sets it explicitly
  or not at all.
- The COO's lane-delegation verb must route through the existing typed dispatcher
  (`src/lib/coo/routing-rules.ts` / `dispatch.ts`) and its approval gates — it must never
  auto-approve `mail`/`message`/`desktop`, and must report `memory`/`review` as
  `unsupported` rather than improvising with `bash`.

**Provers (when implemented):** a coordinator task with children never holds a scheduler
slot while they run (verified at `slots = 1`, no deadlock); a coordinator resumes at most
once; depth/sibling caps hold under an induced internal-check failure; `npm run scope-wall`
stays clean (no Work-Package brand, no removed columns reappear).

## Q17 — Quick tunnel removed; remote access is two transport toggles (2026-07-09)

**Decision:** Settings → Remote access becomes two independent toggles instead of two
always-visible cards. **Tailscale** (for the iPhone) and **Cloudflare** (for the Apple
Watch) each drive their real transport when switched on — `tailscale serve --bg 3747` /
`tailscale serve reset`, and starting or adopting a named `cloudflared` connector — rather
than merely disclosing a settings panel. A failed enable does not persist as enabled; the
switch reflects what actually happened, not what was requested.

**Deleted, not deprecated:** the temporary/quick Cloudflare tunnel
(`*.trycloudflare.com`, `startQuickTunnel`, `TunnelMode: "quick"`, `POST /tunnel/start`).
It had carried a real security caveat (a random-but-not-secret-grade public URL) and had
no UI button wired to it for some time before this change. Cloudflare access is now
**permanent named tunnel only**.

**New persisted state** (`~/.hivematrix/remote-access.json`, no new store — extends the
existing file): `tailscaleEnabled`, `cloudflareEnabled`, `cloudflareConnectorToken`. No
new database table, no new concept class.

**The pairing QR (`GET /tunnel/qr`) now encodes the Tailscale URL, not Cloudflare's.** The
phone is the QR-scanning device and belongs on the mesh; the Apple Watch has no QR and is
paired manually from HiveMatrix on iPhone, unchanged. This closes a secret-exposure gap:
the QR no longer embeds the Cloudflare Access client secret, since the mesh never needed it.

**Code:** `src/lib/tunnel/remote-access-settings.ts` (persistence), `src/lib/tunnel/tailscale.ts`
(`startTailscaleServe`/`stopTailscaleServe`/`parseServeStatusJSON`, plus a test-only DI seam
`_setTailscaleServeDepsForTests` mirroring `_setMailbeeStatusDepsForTests`), `src/lib/tunnel/cloudflared.ts`
(quick-tunnel code deleted; `_setCloudflaredDepsForTests` added for the same reason),
`src/daemon/server.ts` (`POST /remote/tailscale/enabled`, `POST /remote/cloudflare/enabled`;
`POST /tunnel/start-named` kept as a deprecated shim for pre-2026-07-09 iOS builds),
`src/daemon/console.ts` (two `settingsSwitch`-driven cards replacing the always-open ones).
Spec: `docs/superpowers/specs/2026-07-09-remote-access-toggles-spec.md` (+ companion specs
in `hivematrix-ios` and `hivematrix-watch`).

**Provers:** `remote-access-settings.test.ts` proves boolean `false` survives persistence
(the truthiness-guard trap the spec called out explicitly); `tailscale.test.ts` proves
`parseServeStatusJSON` against real `tailscale serve status --json` shapes with no
subprocess; `server.test.ts` proves a failed Tailscale/Cloudflare enable does not persist
as enabled, and that disabling an externally-adopted (not-HiveMatrix-owned) Cloudflare
connector never calls `stopTunnel` on it. `grep -ri "trycloudflare\|startQuickTunnel" src/`
returns nothing.

## Q18 — "Weaver 🌀" reused as the accountability-auditor persona name (2026-07-10)

**Decision:** `src/lib/flash/weaver-audit.ts` (Capability Ratchet + Weaver Audit spec,
`docs/superpowers/specs/2026-07-10-ratchet-and-weaver-spec.md`) names its weekly
commitments-vs-activity audit persona **"Weaver 🌀"** — the string appears in the model
prompt and in the `notify()` text it produces (`"🌀 Weaver weekly: …"`). This is a
**distinct, sanctioned reuse** of the name, not a resurrection of the legacy AuthBee/session
internal codename `scope-wall.mjs` otherwise still forbids as a public brand ("AuthBee/Weaver
as public brand (internal only; use Session\* names)" — see Q-numbered entries above and
`COMPONENT-MAP.md`'s "legacy auth/browser public brands" line). The two have nothing to do
with each other beyond sharing a word: the old one was an internal session/auth component
name that must never leak into user-facing text; the new one is a deliberately-named
operator-facing accountability persona, specified by name in this spec.

**Scope-wall:** the `\bWeaver\b` rule in `scripts/scope-wall.mjs` is narrowed to allow exactly
`lib/flash/weaver-audit.ts` and `lib/flash/weaver-audit.test.ts` (plus this file and
`COMPONENT-MAP.md`) rather than banning the string outright. Any *other* new appearance of
"Weaver" in `src/` still hard-fails the gate — this decision authorizes one named file, not
a general re-opening of the brand.

## Q19 — Live skill acquisition: HiveMatrix learns new skills mid-turn (2026-07-11)

**Context.** The skill library was 70% of a self-improving loop: skills were distilled
from cold sessions (`distill.ts`), fanned out to the harness dirs (`fanout.ts`), and a
capability-gap detector (`capability-gaps.ts`) classified misses — but by design it
*never acquired anything*, and Flash could not even *run* a library skill (it ran with
`--tools ""`). Two live failures forced the close: a voice "what are my events today?"
opened Calendar.app and returned nothing (AppleScript needs an Automation TCC grant the
daemon never had), and "update HiveMatrix to do X" dead-ended (Flash had no doctrine or
tool for "acquire this capability").

**Decision.** Close the loop with skills as the ONLY self-serviceable capability unit
(the ClawHavoc line, unchanged): lanes (credentials) and packs (signed installs) stay
operator-gated forever; nothing here auto-enables either. New capability is acquired
exclusively as first-party skills that pass the existing scan gate plus a new
verification ladder.

- **`skill_run`** (lane tool) lets Flash/voice *run* a library skill live — instruction
  skills return their recipe in-turn, script skills execute in a new hard **sandbox**
  (`skills/sandbox.ts`: `sandbox-exec` network-deny on darwin, env-scrubbed of `HIVE_*`
  tokens, scratch cwd, timeout, output caps, per-run audit). Script execution is gated on
  `scanVerdict != block` AND (`trusted` or `probation`).
- **`learn_skill`** (flash-only tool) → **`skills/acquire.ts`**: mint (Sonnet) → ladder
  (`parseSkillFile` → `scanSkill` block=fatal → sandboxed evals → independent Haiku
  critic, fail-closed) → register. Instruction skills register trusted + fan out; script
  skills start on **probation** (runnable, promoted to trusted after 3 clean runs, never
  fanned out until trusted). Acquisition is async (10-min cap) with a deep_think-style
  speak-back. Failures **archive** the draft (DGM: never delete) + file a capability-gap
  proposal + speak honestly. ACE-style twin counters (`useCount`/`failures`) drive
  promotion/demotion; prune **archives** rather than deletes.
- **Calendar** reads/writes move to a Swift **EventKit** helper (`desktopbee-helper`
  `calendar` subcommand) so Calendar.app never launches and TCC is the helper's own
  clean prompt; PIM tools return a structured `PERMISSION_NEEDED` result so Flash speaks
  the fix instead of dead-ending.
- **Self-improvement** requests route through the *normal* task pipeline:
  `escalate_to_task` gains `kind:"self-improvement"` → `projectPath` = the configured
  HiveMatrix repo + a Superpowers/no-release description prefix. No self-modification
  outside the reviewed task pipeline.

**Complexity accounting (Q14 budget).** New product concepts: **0** — this is an adapter
over the five-concept kernel and existing seams (skills store, feedback, audit, flash
MCP, lane tools). New persistent stores: **0** — no `CREATE TABLE`; the acquisition
ledger is a plain `<brainRoot>/skills/ACQUISITIONS.md` file, drafts/archive are
directories. New modules: `skills/acquire.ts`, `skills/sandbox.ts`, the
`calendar-helper` subcommand; everything else is edits to existing files. New tools:
`skill_run` (lane), `learn_skill` (flash-only). **Not built** (scope wall): no vector
DB (description-based retrieval via the skill index is enough at this size), no runtime
native-tool registration, no autonomous lane/pack acquisition ever, no DGM-style
agent-code self-rewriting.

**Provers.** P0 `src/lib/voice/calendar-read-prover.test.ts`; P1
`src/lib/flash/skill-run-prover.test.ts` (real sandbox execution); P2
`src/lib/skills/acquire-prover.test.ts` (real fanout + already-have); P3
`src/lib/flash/self-improve-prover.test.ts` (repo projectPath + workflow work +
voice-origin). Full pipeline unit-tested with stubbed mint/critic (fake claude via
`_setExecFileForTests`). Design + plan: `docs/superpowers/specs/2026-07-11-self-learning-design.md`,
`docs/superpowers/plans/2026-07-11-self-learning.md`.
