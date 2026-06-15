# HiveMatrix Design Decisions

Date closed: 2026-06-11. All six reset questions are closed.

## Q1 — DesktopBee naming

**Decision:** DesktopBee. ComputerBee name is retired everywhere.
**Code:** `src/lib/desktopbee/` — all types use `DesktopBee*` prefix.

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

## Q7 — Cloud-only run mode + Bee lanes for the local agent

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

**Decision B — Bee lanes available to the local (Qwen) agent.** The three
existing embedded lanes — WebBee, BrowserBee, DesktopBee — are exposed to the
local/generic agent tool loop as function tools (`webbee_search`,
`browserbee_run`, `desktopbee_action`). No new brands. Each is gated by the
ConnectivityPolicy capability matrix: a lane disabled in the current mode is
neither advertised to the model nor dispatched. BrowserBee jobs run as delegated
Codex Computer Use tasks. DesktopBee acts are auto-approved at dispatch (Irv's
explicit posture), with the Swift helper's server-side gate retained as
defence-in-depth.
**Code:** `src/lib/orchestrator/bee-tools.ts`, wired via
`src/lib/orchestrator/tool-bridge.ts` and `generic-agent.ts`.
**Provers:** `src/lib/orchestrator/bee-tools.test.ts`,
`src/lib/routing/router.test.ts` (noLocal cases),
`src/lib/models/available.test.ts` (cloud-only cases).

---

## Q8 — MessageBee un-deferred (SMS/iMessage channel lane)

Date closed: 2026-06-12.

**Decision.** MessageBee moves from "deferred beyond notification egress" to an
**active embedded channel lane** — the top channel priority for the autonomous
business operator, because SMS/iMessage is the founder's control surface
(approvals, `needs_input` replies, content sign-off by text). No standalone
runtime and no new HTTP brand service: it runs **inside the daemon**, like the
WebBee/BrowserBee/DesktopBee lanes (Q7-B pattern).

**Mechanism (self-contained — no external `imessage` CLI).**
- **Read:** poll `~/Library/Messages/chat.db` directly via better-sqlite3
  (read-only), high-water-marked by `message.ROWID`. Requires the daemon to hold
  **Full Disk Access** (a new optional onboarding step + System Settings
  deep-link, mirroring the DesktopBee TCC pattern).
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

## Q9 — MailBee un-deferred (email watch + trust-gated drafting)

Date closed: 2026-06-12.

**Decision.** MailBee becomes an **active embedded channel lane** (the founder's
inbox, watched and triaged). Self-contained via **Apple Mail (osascript)** — no
IMAP/SMTP creds, no OAuth; it reads/sends through accounts Mail.app already holds
(Gmail + Outlook both work). Same daemon-embedded pattern as MessageBee (Q8).

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
trust assessment; the agent drafts a reply; approval (e.g. via MessageBee text,
W1.3) sends it. Allowlist + "trusted domains" live in `message_identities` /
config (channel `email`). State in the v5 `message_channels`/`message_identities`
tables.

**Code:** `src/lib/mailbee/` (contracts incl. `classifyMailTrust`, applemail I/O,
store, handoff, poller). Endpoints `/mailbee/*`; onboarding `mailbee` step.
Scope wall + COMPONENT-MAP amended. **Provers:** `src/lib/mailbee/*.test.ts`
(trust classification + routing); live-Mac: real Mail.app read/draft.

---

## Q10 — TermBee becomes an owned embedded lane

Date closed: 2026-06-12.

**Decision.** TermBee is no longer "Canopy provider" — it's a **HiveMatrix-owned
embedded capability lane**: persistent terminal sessions the agent drives across
turns. Self-contained — **real shells managed in-process** (no node-pty native
addon, no tmux dependency); a per-command completion marker reads each command's
combined output + exit code back off the shared stdout stream. State (cwd, env,
shell vars) persists between commands like a real terminal.

**Availability: every connectivity mode** (cloud-ok / local-only / offline) —
TermBee is the offline workhorse, so it's added to the ConnectivityPolicy matrix
as always-available.

**Code:** `src/lib/termbee/` (contracts, session manager). Exposed to the agent
loop via `bee-tools.ts` as `termbee_session` (create/list/kill) and `termbee_run`
(run a command in a session). Capability `termbee` in `connectivity/policy.ts`;
catalog + COMPONENT-MAP updated. **Provers:** `src/lib/termbee/*.test.ts`
(marker parsing + a real multi-step session: cd persists, command output across
turns, runs offline).

---

## Q11 — TraderBee un-deferred (market-data watch + alerts) + env-var key pattern

Date closed: 2026-06-14.

**Decision A — TraderBee as a market-insight lane. ANALYSIS & ALERTS ONLY; it
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

## PROPOSAL/BUILD (2026-06-14) — YouTube playlist watcher (no new Bee brand)

Status: **Implemented 2026-06-14.** Owner: Irv.

**Need.** Watch a YouTube playlist; on a new video, summarize (transcript-based)
into an HTML brain doc with thumbnail + link, and notify.

**Constraint that shaped it.** YouTube "Watch Later" is NOT reachable via the
Data API (Google removed it). Decision: operator saves videos to a normal
private/unlisted playlist; the watcher polls THAT via `playlistItems.list`. (The
alternative — browser-scraping WL — was rejected: fragile + depends on the weak
Codex/DesktopBee browser-auth path. COMPONENT-MAP's "TubeBee → BrowserBee recipe"
note is superseded for this case by the cleaner API path.)

**Shape (scope-wall respected — no "TubeBee" brand).** Self-contained
`src/lib/youtube/` module + a daemon poll loop (mirrors the MessageBee poller
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
3. **BrowserBee health endpoint.** `GET /browserbee/health` surfaces
   `buildBrowserBeeHealthSnapshot` (codex auth mode, desktop-fallback enabled,
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
- **loopHealth surfaced** in the ManagerBee control-plane report
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
the scenarios are compositions of existing capabilities (channel Bees + Directives
+ Content + Approval + Brain) plus this session's adds (outbound send, brain_search,
embeddings, skills, YouTube watcher, failure escalation). **Genuine gaps (each needs
a decision, not a guess):**
1. **TraderBee market watch/alerts** (guide §M, "Proposed, not yet built") — analysis
   already works via the trader profile; live watch needs a quotes data source +
   watchlist + alert directive, and is a **new Bee brand → scope-wall proposal**.
2. **Content publishing execution** — X/Twitter has no posting path (needs X API or
   BrowserBee recipe); newsletter/email send is now possible via MailBee (this
   session) but the content→MailBee send step isn't wired (in-scope follow-on).
3. **On-demand "digest this URL"** (#43 article path) — composable via a task today;
   a thin `POST /digest` would make it one-tap (low priority, no external dep).

## BUILD (2026-06-14) — on-demand digest (scenario #43, the article path)

Built the one decision-free gap: `src/lib/digest/` + `POST /digest {url, note?}`
(creates a `source:"digest"` task that fetches the page via WebBee/BrowserBee,
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
Newsletter *send* still needs a recipient list + content→MailBee wiring.

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
(intent → Bee). Channel Bees are wired as inbound pollers + post-exit side-effects, not
as outbound tools. A spawned agent has `bash/read/write/edit/search/list/create_task` +
`webbee_search/browserbee_run/desktopbee_action/termbee_*` and **no** `mailbee_send`,
`messagebee_send`, or LinkedIn action. So "send an email" reaches no Bee — the agent
improvises with bash/osascript/WebFetch. Same root cause behind the LinkedIn failure
(BrowserBee depends on Codex auth / DesktopBee fallback) and "how does it use brain docs"
(no retrieval — memory bundle is pinned paths only).

**Proposed scope (no new Bee brand — scope wall respected).**
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

**Provers (when scheduled).** "send email to X" routes to MailBee draft/send under trust
gate (not bash); `brain_search` returns a doc not pinned in the directive; LinkedIn action
path reports a clear actionable error when Codex/DesktopBee unavailable instead of silent
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

- **Tabbed reorg.** Settings tabs are now **Models | Remote | General | Projects | Bees**.
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
- **Settings tab order** defined: **Models · Bees · Projects · General · Remote · About**.
- Skills launcher already exists (right context panel → "Skills" section: dropdown + Run);
  no change, just confirmed.

**Verification.** tsc clean, scope-wall 0, 616/616 tests (codex args + new console
coverage), daemon bundles.

## BrowserBee: Codex Computer Use unavailable on ChatGPT-subscription accounts (2026-06-14)

**Investigation (LinkedIn "friend requests" task did nothing).** The parent agent created
a BrowserBee child task (model `codex:gpt-5.4-computer-use`) and reported "browser running,
I'll be notified." The child FAILED in ~10s with HTTP 400:
`"The 'gpt-5.4-computer-use' model is not supported when using Codex with a ChatGPT account."`
So BrowserBee's default "Codex Computer Use" backing (which is just `codex exec -m
gpt-5.4-computer-use` — no real browser harness) cannot run on a subscription Codex login.
The failure was silent; the parent's "you'll be notified" was false (no such notification).
(Confirmed the `--` arg fix works — the routing prompt showed as the user message, not an
arg error. Secondary: browserbee tasks got `projectPath: /`.)

**Fix.** `resolveBrowserBeeBacking` now treats ONLY `api-key` Codex auth as usable for the
computer-use backing (was subscription|api-key). A subscription account routes to the
DesktopBee fallback when enabled, else **refuses with a clear, actionable reason** instead
of creating a doomed task that 400s silently. The `browserbee_run` success message no longer
implies a push notification. Tests updated.

**Still open (operator choice):** to make browser tasks actually work on a subscription
account, enable the DesktopBee fallback (`browserbee.desktopFallback=true`) so the local
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

ManagerBee, BrainBee, BrowserBee showed "unhealthy · fetch failed" though they run fine
(embedded in the daemon). Three-part bug in `service-manager` embedded health probe:
1. **Wrong port** — built the URL with `process.env.PORT || "4000"`; the daemon listens on
   `HIVEMATRIX_PORT` (3747), so it hit :4000 (nothing there) → "fetch failed". Now uses
   `HIVEMATRIX_PORT ?? PORT ?? 3747`.
2. **Wrong BrowserBee path** — probed `/api/browserbee/health` (404); the real route is
   `/browserbee/health`. Fixed (managerbee/brainbee `/api/*/health` aliases are correct).
3. **No auth on the loopback probe** — those routes are token-gated (401 without it), but
   `checkHealth` sent no header. Now passes the daemon shared secret (`readToken`) on the
   embedded probes; external launchagent probes (e.g. inventorbee :4014) still go unauthenticated.

Verification: tsc clean, scope-wall 0, 619/619 tests (added embeddedHealthRoute guard), daemon bundles.

## TermBee + DesktopBee showed "planned · No runtime registered" (2026-06-14)

Both are real, working lanes (TermBee in-process; DesktopBee = the Swift helper on :3748)
but were ABSENT from the service-manager descriptor map, so they fell through to the
default `runtimeMode: "planned"`. ("computerbee" — the retired DesktopBee name — was still
listed but unused.) Fixes:
- Added `termbee` (embedded; no health route → live with the daemon) and `desktopbee`
  (embedded) descriptors.
- New daemon route `GET /desktopbee/health` pings the helper via probeDesktopBeeHelper →
  200 when up / 503 when unreachable; mapped `embeddedHealthRoute("desktopbee")` to it, so
  the Bees view shows DesktopBee's real (green) health.

Verification: tsc clean, scope-wall 0, 620/620 tests, daemon bundles.

## MailBee: agent reached for Gmail MCP instead of Apple Mail (2026-06-15)

Two operator reports: asked to "delete emails matching Run failed" and to email wallpaper
files, HiveMatrix replied (by text/email) "run `/mcp` and authenticate claude.ai Gmail" —
impossible in the headless daemon, and the wrong tool (MailBee = Apple Mail). Root causes +
fixes:
1. **Routing guidance only covered SENDING.** Added to `outboundHttpRoutingPrompt`:
   - "Reading & managing email" → drive local Apple Mail via osascript; do NOT use a Gmail/
     Google MCP/web Gmail/IMAP; for bulk deletes, MOVE to the Trash mailbox (recoverable)
     and report count + criteria.
   - "Headless: never ask for interactive auth" → NEVER tell the user to run `/mcp`/`/login`
     or authenticate an MCP; use the local path or report the limitation.
2. **MailBee couldn't attach files** (so "email me the wallpapers" reached for Gmail). Added
   attachment support end-to-end: `applemail.ts` SEND_SCRIPT attaches via Apple Mail;
   `sendMail`/`draftMail` take `attachments[]`; `executeMailBeeSend/Draft` + the
   `mailbee_send`/`mailbee_draft` tool schemas accept `attachments`; `parseOutboundFields`
   collects repeated `attachment=` form fields / JSON `attachments[]`; `/mailbee/send` passes
   them; routing prompt documents `--data-urlencode "attachment=/ABSOLUTE/PATH"`.

Verification: tsc clean, scope-wall 0, 626/626 tests, daemon bundles.
