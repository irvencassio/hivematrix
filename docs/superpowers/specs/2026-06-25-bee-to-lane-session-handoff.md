# Bee→Lane Rename — Session Handoff (2026-06-25)

Self-contained handoff for a fresh prompt. Summarizes everything completed in this
session, the patterns used, how to verify, and exactly what's left.

## TL;DR

The HiveMatrix Bee→Lane rename is **functionally complete and safe**. Nine commits
landed on `main` (`4d097bc..39487d2`), all behaviour-preserving and additive. Every
gate is green: `npm run typecheck`, `npm test` (965 passing), `node scripts/scope-wall.mjs`
(0 violations). The whole user-facing brain guide set was also refreshed.

What remains is deliberately deferred: a low-value/high-risk persisted-DB value rename,
a signed-bundle rename (recommended: don't), and an optional cosmetic module-dir sweep.
None are blocking; all need a human decision before starting.

## Guiding pattern (apply this to any remaining work)

Every change followed the same **additive, staged** rule — never a blind search-and-replace:

1. **Add the lane-native shape** (new name/module/field/id).
2. **Read both old and new**; **keep old working** (facade modules, dual-read config,
   alias maps, `lane ?? bee`).
3. **Write the new shape only where safe**; **never delete the old** in the same pass.
4. Persisted values, wire contracts, route paths, signed-bundle names, and tool-call
   history are treated as compatibility surfaces — left intact, accepted forever on read.

## Commits this session (oldest → newest)

| Commit | What |
|---|---|
| `c716eb9` | Operator copy stragglers: voice/console Talk status `bee:`→`assistant:`; user guide documents `GET /lanes` primary, `/bees` compat alias; added `scripts/remaining-operator-lane-copy.test.mjs`. |
| `b517437` | Moved kind-level service layer `src/lib/bees/*` → `src/lib/lanes/*` (`LaneDefinition`/`LaneRole`, `LaneWorkerStatus`, `listLaneWorkerStatuses`, `setLaneWorkerAutoStart`, `getLaneWorkerRuntimeDescriptor`, `restartLaneWorkerService`). `src/lib/bees/*` kept as thin alias facades. Config writes `laneServices`, reads `laneServices ?? beeServices`. Added `selectLaneServices`/`applyLaneServices` + migration tests. |
| `842a169` | Added `LANE_TOOL_ALIASES` + `resolveBeeToolName` so the dispatcher accepts lane-native tool ids (staged). |
| `f5c7c1d` | Flipped **advertised** tool ids to lane-native (`desktop_action`, `terminal_session`/`terminal_run`, `mail_send`/`mail_draft`, `message_send`). Legacy bee ids now reverse-alias to lane ids (persisted calls + `/bee/:tool` route still resolve). User-guide tool cell + date updated. |
| `0459801` | Corrected stale "Message Lane inbound deferred" claim in the user guide — verified inbound is live (`startMessageBeePoller` in `src/daemon/index.ts`). Now documented as two-way. |
| `17bdd1e` | User guide uses canonical `browserLane.desktopFallback` config key (legacy `browserbee.desktopFallback` still read by `src/lib/browser-lane/jobs.ts`). |
| `5ac52ed` | Central worker protocol accepts lane vocabulary on input: `normalizeWorkerKind` maps `message`/`mail`/`browser`/`desktop`/`terminal`/`memory`/`review` → persisted kind; external parsers read `lane ?? bee`. No persisted data/wire/old-worker change. (`traderbee` is intentionally NOT in the alias map — it is not a registered `WorkerKind`.) |
| `3c5d38a` | Spec for the remaining destructive migration (see "What remains"). |
| `39487d2` | Renamed `src/lib/orchestrator/bee-tools.ts` → `lane-tools.ts` with lane-native generic API (`executeLaneTool`, `isLaneTool`, `availableLaneTools`, `LANE_TOOL_DEFINITIONS`, `resolveLaneToolName`, `LaneToolContext`). `bee-tools.ts` is a facade. Consumers (`generic-agent`, `tool-bridge`, daemon routes) import `lane-tools` directly. |

## Authoritative Bee→Lane mapping (use this everywhere)

| Legacy bee | Lane (display) | Lane id | Persisted `WorkerKind` (unchanged) |
|---|---|---|---|
| WebBee + BrowserBee | **Browser Lane** (read/search + authenticated/workflow) | `browser` | `webbee`, `browserbee` |
| DesktopBee | **Desktop Lane** | `desktop` | `desktopbee` |
| TermBee | **Terminal Lane** | `terminal` | `termbee` |
| MailBee | **Mail Lane** | `mail` | `mailbee` |
| MessageBee | **Message Lane** (two-way SMS/iMessage) | `message` | `messagebee` |
| BrainBee | **Memory Lane** | `memory` | `brainbee` |
| ManagerBee | **Review Lane** | `review` | `managerbee` |
| TraderBee | **Market Insight Lane** (analysis/alerts only, never trades) | — | `traderbee` (NOT in `WORKER_KINDS`) |

- Tool ids: `desktopbee_action`→`desktop_action`, `termbee_run`→`terminal_run`,
  `termbee_session`→`terminal_session`, `mailbee_send`→`mail_send`, `mailbee_draft`→`mail_draft`,
  `messagebee_send`→`message_send`. Browser tool is `hivematrix_browser`; removed ids
  `webbee_search`/`browserbee_run` stay **rejected**.
- Status API: `GET /lanes`, `POST /lanes/:kind/autostart|restart` are primary; `/bees*` are compat aliases.
- Canonical source of truth in code: `src/lib/lanes/contracts.ts` (`LANE_IDS`, `LANE_DISPLAY_NAMES`,
  `LEGACY_CAPABILITY_TO_LANE`).

## Brain guide set (Google Drive `~/_GD/brain`, NOT the repo)

Whole set refreshed to **2026-06-25** dated files (06-14/06-15 originals left as history),
all cross-links updated to point within the 06-25 set:

- `2026-06-25-hivematrix-quick-start.html` (front door)
- `2026-06-25-hivematrix-user-guide.html` (synced from repo `docs/USER-GUIDE.html`)
- `2026-06-25-hivematrix-architecture-guide.html`
- `2026-06-25-hivematrix-explained-simply.html`
- `2026-06-25-run-your-business-with-hivematrix.html`
- `2026-06-25-run-your-marketing-with-hivematrix.html`
- `2026-06-25-hivematrix-terminal-browser-lane-credentials.html` (RENAMED from `...-termbee-browserbee-credentials`)
- `2026-06-25-hivematrix-skills-guide.html`

Note: the `explained-simply` guide had a **Review Lane card added** that wasn't in the
original (completeness) — flagged for review, easy to drop if unwanted.

## How to verify (run from repo root)

```
npm run typecheck            # tsc --noEmit, clean
npm test                     # node --test, 965 passing
node scripts/scope-wall.mjs  # 0 violations
```

## What remains (all deferred — needs a human decision; do NOT blind-sweep)

Full plan: `docs/superpowers/specs/2026-06-25-bee-to-lane-destructive-migration-design.md`.

1. **Persisted `WorkerKind` value flip** (`messagebee`→`message` as the *stored* string).
   Requires an idempotent, version-gated backfill of the live `~/.hivematrix/hivematrix.db`
   (worker tokens + task rows + events), read-old-forever, `/lane/*` route aliases, DB backup
   first. **Engineering recommendation: probably not worth it** — the stored kind is an internal
   id the user never sees, and every user-facing surface already says "Lane." High risk, low value.

2. **`DesktopBeeHelper.app` bundle rename**. Touches signing/notarization/launchd/auto-update.
   **Recommendation: keep the compatibility bundle name.** Only rename as an isolated,
   `scripts/release.mjs`-validated build change if the product label genuinely needs it.

3. **Internal module-dir sweep** — the ~9 remaining `src/lib/<x>bee/` dirs (`mailbee`,
   `messagebee`, `termbee`, `desktopbee`, `brainbee`, `traderbee`, `inventorbee`, …) and their
   bee-named symbols. Safe (code organization only; persisted `kind` strings stay) but large
   cosmetic churn. If pursued, use the SAME facade pattern as `lib/bees → lib/lanes` and
   `bee-tools → lane-tools`: `git mv` the dir, rename exported symbols to lane names, leave a
   thin facade at the old path, update importers, keep persisted string literals (`"mailbee"`
   etc.) intact, run all three gates after each module.

## Gotchas a fresh prompt should know

- Persisted `WorkerKind` string values (`"mailbee"`, `"messagebee"`, …) and route paths
  (`/mailbee`, `/messagebee`, `/traderbee`) are compatibility surfaces — do not rename them
  without the staged DB migration above.
- `scope-wall.mjs` flags retired brands (TubeBee, ComputerBee, GoalsBee) and warns on new bee
  brands; keep it green.
- Several tests are **source-content tests** (`scripts/*-lane-copy.test.mjs`, `service-build-lane-copy`)
  that grep specific files for exact wording — moving a file means repointing its `read(...)` path.
- `tsx` strips types at test-run time, so a failing `npm run typecheck` can hide behind passing
  tests — always run both.
