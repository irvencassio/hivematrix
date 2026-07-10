# Task: Upgrade HiveMatrix observability — provider filtering, per-model breakdown, 1h window, KV cache

You are working in `/Users/irvcassio/hivematrix`, a Tauri macOS app. The daemon is Node/TypeScript and serves a hand-rolled HTML console.

Everything in the "Ground truth" section below was **verified against the live codebase and the live database** before this prompt was written. Trust it. Where a section says *verify*, actually run the command — do not assume.

**Do not start coding until you have read every file listed in Ground truth.**

---

## Ground truth

### The pipeline

One row per task-run is written to the SQLite table `task_telemetry` (`~/.hivematrix/hivematrix.db`).

| Concern | Location |
|---|---|
| Row schema (migration v17) | `src/lib/db/index.ts:308-340` |
| Migrations run via `PRAGMA user_version` | `src/lib/db/index.ts:723-735` |
| Row type `TaskTelemetry`, `Provider`, `providerForModel`, `isLocalProvider` | `src/lib/observability/contracts.ts:15-30`, `:59-84` |
| Aggregation `summarizeTelemetry` (returns `byProvider` **and** `byModel`) | `src/lib/observability/contracts.ts:273-296` |
| Time-bucketed series + cache rollups | `src/lib/observability/series.ts` |
| Store wrappers (`observabilitySummary`, `observabilityScorecard`, …) | `src/lib/observability/store.ts:104-139` |
| Capture on run completion | `src/lib/observability/capture.ts:14` |
| Claude token parsing | `src/lib/orchestrator/stream-parser.ts:53-87` |
| Codex token parsing | `src/lib/orchestrator/codex-agent.ts:125-141`, `src/lib/usage/codex.ts:152-174` |
| HTTP endpoints `/observability`, `/observability/series` | `src/daemon/server.ts:749-786` |
| Provider allowlist helper `obsProvidersFor` | `src/daemon/server.ts:53-60` |
| Codex on/off flag (`~/.hivematrix/config.json` → `providers.codex.enabled`) | `src/lib/config/frontier-providers.ts:64-83` |
| Inline panel `renderObservability()` | `src/daemon/console.ts:2827-2884` |
| Dashboard modal `renderObsDashboard()`, `obsStackedBars()` | `src/daemon/console.ts:2918-3020` |
| Window buttons (24h/7d/30d), `_obsWindow`, `setObsWindowModal()` | `src/daemon/console.ts:1447-1449`, `:2752`, `:2888` |
| Labels/colors/order | `src/daemon/console.ts:2753-2755` |

All UI lives inside `console.ts` as a template string. Charts are hand-drawn SVG. There is no framework and no chart library.

### What the live database actually contains

```
provider       | model                | rows
---------------+----------------------+-----
local-dwarfstar| deepseek-v4-flash    | 49
anthropic      | claude-sonnet-5      |  8
local-qwen     | qwen3.6-27b-4bit     |  4
local-qwen     | qwen3.6-35b-4bit     |  4
openai-codex   | codex:gpt-5.5        |  4
anthropic      | claude-opus-4-8[1m]  |  1
```

Read that table carefully. Four facts follow from it, and they define most of this task.

### The four bugs

**Bug 1 — the reported one. Disabled Codex still renders.**

`/observability` filters `scorecard` and `recent` by the enabled-provider set, but passes `totals: observabilitySummary()` through **unfiltered** (`src/daemon/server.ts:763`). The inline panel renders its provider table straight off `totals.byProvider` (`console.ts:2842`), so a disabled Codex still appears — as do its tokens in the `t.tokens.total` and `t.split.frontier` headline pills.

`/observability/series` *does* filter correctly (`server.ts:776-784`). Only the summary path is broken.

**Bug 2 — a dead provider is 70% of the telemetry and is silently dropped from every chart.**

`local-dwarfstar` / `deepseek-v4-flash` is the retired DeepSeek stack (removed 2026-07-06). Zero references to `dwarfstar` remain anywhere in `src/` — verify with `rg -ril dwarfstar src/`. But 49 rows persist on disk, and:

- `Provider` is the closed union `"anthropic" | "openai-codex" | "local-qwen" | "other"` (`contracts.ts:15`). `local-dwarfstar` is none of these — it is a legacy value that predates the union.
- `isLocalProvider(p)` is `p === "local-qwen"` (`contracts.ts:27`), so **all 49 rows are counted as frontier** in `split.frontier`. The frontier/local split on screen is wrong by a factor of ~6.
- `obsProvidersFor()` returns `{local-qwen, other, …}` (`server.ts:56`), so `local-dwarfstar` is **not** in the allowlist — the series endpoint filters it out entirely. **The "Tokens over time" chart is silently missing 70% of all runs.**
- It has no `OBS_LABELS` entry, so where it *does* leak through (the unfiltered inline table, Bug 1) it renders as the raw string `local-dwarfstar`.

**Bug 3 — per-model data is computed and thrown away.**

`summarizeTelemetry()` already returns `byModel` (`contracts.ts:281,287`). **Nothing renders it.** (`console.ts:5170` is `u.byModel` from the unrelated `/usage` frontier-spend view — not this.) Meanwhile `series.ts:115-128` groups only `BY bucket, provider`, so the charts *cannot* split by model at all.

The live DB has two distinct Claude models and two distinct local models. This is exactly the breakdown the operator is asking for, and the data has been sitting there unrendered.

**Bug 4 — the local prompt-cache label is false.**

`series.ts:66` declares `CACHE_SUPPORTED = new Set(["anthropic", "openai-codex"])`, and the UI prints **"on-device — no prompt cache"** for local (`console.ts:2991-2994`).

This is wrong. Verify it yourself right now:

```bash
curl -s http://127.0.0.1:8000/metrics | rg 'prefix_cache|kv_cache|requests_(running|waiting)'
```

rapid-mlx exposes a full Prometheus endpoint (`text/plain; version=0.0.4`, 64 metrics) including a real prefix cache with hits, misses, and tokens-saved counters. HiveMatrix has never scraped it. The only endpoints ever touched are `/v1/models` (health, `local-engine.ts:277`) and `/v1/chat/completions`.

---

## Reference: what to build against

### rapid-mlx `/metrics` — verified metric names

Two tiers serve concurrently (`src/lib/models/local-engine.ts:40-43`), each with its own `/metrics`:

- `fast` → `qwen3.6-35b-4bit` → port **8000**
- `coding` → `qwen3.6-27b-4bit` → port **8001**

Both were live and returned `200` when this prompt was written. Per-model local metrics therefore means **one scrape per port**, not one scrape with a model label. (`rapid_mlx_prompt_tokens_total` carries no model label; only `rapid_mlx_build_info` does.)

Metrics worth surfacing:

| Metric | Type | Use |
|---|---|---|
| `rapid_mlx_prefix_cache_hits_total` / `..._misses_total` | counter | hit rate = `hits / (hits + misses)` |
| `rapid_mlx_prefix_cache_tokens_saved_total` | counter | **local analog of `cache_read_input_tokens`** |
| `rapid_mlx_prefix_cache_current_bytes` / `..._cap_bytes` | gauge | KV utilization % |
| `rapid_mlx_prefix_cache_evictions_total` | counter | churn |
| `rapid_mlx_prefix_cache_pressure_evictions_total` | counter | **cache thrashing under memory pressure** — the alarm signal |
| `rapid_mlx_kv_cache_dtype{dtype=…}` | gauge | active dtype = the label whose value is `1` |
| `rapid_mlx_turboquant_mode{mode=…}` | gauge | active KV-compression mode, same 1-of-N encoding |
| `rapid_mlx_requests_running` / `rapid_mlx_requests_waiting` | gauge | queue depth |
| `rapid_mlx_metal_active_memory_bytes` / `..._peak_…` / `..._cache_…` | gauge | memory |
| `rapid_mlx_prompt_tokens_total` / `rapid_mlx_completion_tokens_total` | counter | throughput |
| `rapid_mlx_spec_decode_accept_ratio` | gauge | speculative-decode efficiency |
| `rapid_mlx_uptime_seconds` | gauge | **counter-reset detection** |

Full list: `curl -s http://127.0.0.1:8000/metrics | rg '^# TYPE'`.

Three traps:

1. **Counters are cumulative since process start.** A rate requires deltas between two polls. Store snapshots; do not render a counter as if it were a per-window value.
2. **Detect resets.** If `uptime_seconds` decreases between polls, the engine restarted and every counter reset to zero — discard that delta rather than emitting a negative rate.
3. **`/metrics` is a rapid-mlx feature.** `LocalEngineKind` is `"rapid-mlx" | "lmstudio" | "ollama"` (`local-engine.ts:22`). Guard on engine kind and handle `404`/`ECONNREFUSED` as "unavailable", not as zero. The engine is frequently down.

### Anthropic cache accounting

`stream-parser.ts:55-56` reads only the flat `cache_creation_input_tokens`. The API also returns the split, which the flat field hides:

```json
"usage": {
  "input_tokens": 12,
  "output_tokens": 300,
  "cache_creation_input_tokens": 248,
  "cache_read_input_tokens": 1000,
  "cache_creation": { "ephemeral_5m_input_tokens": 148, "ephemeral_1h_input_tokens": 100 }
}
```

Invariant: `cache_creation_input_tokens == ephemeral_5m + ephemeral_1h`.

Without the split, cache-write cost cannot be computed, because the two tiers price differently:

| Token class | Multiplier on base input price | Field |
|---|---|---|
| uncached input | 1.0× | `input_tokens` |
| 5-minute cache **write** | **1.25×** | `cache_creation.ephemeral_5m_input_tokens` |
| 1-hour cache **write** | **2.0×** | `cache_creation.ephemeral_1h_input_tokens` |
| cache **read** | **0.1×** | `cache_read_input_tokens` |
| output | 1.0× of output price | `output_tokens` |

```
cost = input_tokens        * base_in
     + ephemeral_5m_tokens * base_in * 1.25
     + ephemeral_1h_tokens * base_in * 2.00
     + cache_read_tokens   * base_in * 0.10
     + output_tokens       * base_out
```

Derived metrics worth showing, in ascending order of usefulness:

- **hit rate** = `cache_read / (cache_read + cache_creation + input)`
- **savings** = `cache_read_tokens × base_in × 0.9` (what a 1.0× read would have cost, minus the 0.1× actually paid)
- **write overhead** = `ephemeral_5m × base_in × 0.25 + ephemeral_1h × base_in × 1.0`
- **net cache benefit** = savings − write overhead ← *the number that actually answers "is caching helping?"*. Caching is a loss until reads exceed the write premium (5m breaks even after 1 read; 1h after ~2).

Note `stream-parser.ts:58` sets `inputTok = baseInput + cacheCreate + cacheRead`, so the stored `inputTokens` is the **full** prompt side, and `hitRatePct = cacheRead / inputTokens` (`series.ts:41`) is already the correct denominator for Claude. **Do not "fix" it.** But Codex populates `inputTokens` from a different source (`codex-agent.ts:125-141`, `usage/codex.ts:152-174`) and always sets `cacheCreationTokens: 0`. **Verify whether the Codex `inputTokens` already includes `cachedInputTokens` before trusting a cross-provider hit-rate comparison.** If the conventions differ, normalize at capture time and say so in a comment.

### Time ranges

Grafana-style adaptive bucketing targets ~120-200 points per chart. Current: `24h`→hourly, `7d`/`30d`→daily (`series.ts:77-82`).

For the new `1h` window, use **5-minute buckets (12 points)** — *not* the 1-minute buckets a general-purpose dashboard would use. Justification: HiveMatrix task runs are minutes apart, so 60 one-minute buckets would be ~95% empty and the stacked bars would read as noise. Put this reasoning in a code comment so the next reader doesn't "correct" it.

`strftime` has no native 5-minute bucket. You need:

```sql
strftime('%Y-%m-%dT%H:', createdAt, 'localtime')
  || printf('%02d', (CAST(strftime('%M', createdAt, 'localtime') AS INTEGER) / 5) * 5)
```

and the JS `bucketLabel()` (`series.ts:87-90`) must produce a **byte-identical** string, or the axis join silently yields all-zero buckets. This is the single most likely place to introduce a bug. Write the unit test for it first.

### Disabled-provider UX

The established pattern (Grafana null-vs-zero; matches the Anthropic/OpenAI consoles):

- **Provider disabled, has history in window** → keep the series, render it, stop at the last real datapoint. Do **not** extend a zero line forward. Grey it and append `(disabled)` to the legend.
- **Provider never used in window** → hide the series entirely. Don't render an all-null flatline.
- **Provider enabled, zero usage this bucket** → plot a real `0`. A genuine gap in usage is signal.

Never conflate "no data" with "zero".

---

## What to build

Six phases. **Each phase ends green** — `npm run typecheck && npm test` must pass before you move on. Commit per phase.

### Phase 1 — Provider identity (fixes Bug 2)

1. Widen `Provider` to admit any `local-*` value. Preferred shape: keep the named union members and add a `` `local-${string}` `` template member, or introduce `type Provider = KnownProvider | LocalProvider`. Do **not** silently coerce unknown values to `"other"`.
2. `isLocalProvider(p)` → `p.startsWith("local-")`. Add a unit test asserting `local-dwarfstar` is local. This alone corrects the frontier/local split for 49 rows.
3. `obsProvidersFor()` (`server.ts:53-60`) must keep **every** `local-*` provider, not just `local-qwen`. Local providers are not gated by the Claude/Codex toggles.
4. `OBS_LABELS` / `OBS_COLORS` / `OBS_ORDER` need a fallback for unknown keys. Label `local-dwarfstar` honestly — e.g. `"Local (retired)"` — and give unknown providers a deterministic color rather than `undefined`.

**Do not delete, rewrite, or migrate away the 49 `local-dwarfstar` rows.** They are real history. The model was `deepseek-v4-flash`; relabelling it as Qwen would be a lie in the data.

Verify: `sqlite3 ~/.hivematrix/hivematrix.db "select provider, count(*) from task_telemetry group by 1;"` — the dashboard's total run count must now equal the sum of that output.

### Phase 2 — Filter the summary (fixes Bug 1, the reported symptom)

1. Give `observabilitySummary()` (`store.ts:104`) an optional provider-allowlist parameter, and filter rows before `summarizeTelemetry()`. Filtering after the fact would leave `tokens.total` and `split` wrong — the whole point of the bug.
2. `server.ts:763` passes `enabledObsProviders`.
3. Return a `hiddenProviders: Array<{ key, runs }>` field alongside `totals`, listing enabled=false providers that **do** have rows in scope.
4. The inline panel renders that as a muted footnote: `Codex — 4 runs hidden (disabled)`. Silently dropping data is what made this bug invisible for so long; don't reintroduce it one layer up.

Verify end to end: set `providers.codex.enabled = false` in `~/.hivematrix/config.json`, restart the daemon, `curl -s localhost:<port>/observability | jq '.totals.byProvider[].key, .hiddenProviders'`. No `openai-codex` in `byProvider`; it appears in `hiddenProviders`. Then re-enable and confirm it returns.

### Phase 3 — Per-model breakdown (fixes Bug 3)

1. **Series**: add a second query to `observabilitySeries()` grouped by model, window-scoped, returning `models: Array<{ model, provider, runs, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, costUsd, latencyP50Ms, latencyP95Ms, tokensPerSec }>`. Keep the existing per-provider bucket query as-is; **do not** add a `model` dimension to `SeriesPoint.byProvider` — that nests two group-bys into one payload for no benefit.
2. **Chart**: add a `Group by: provider | model` toggle to the dashboard modal. When `model`, `obsStackedBars()` (`console.ts:2918`) stacks by model id, colored by a hash-derived shade of the parent provider's color so Claude models stay in the Claude family visually.
3. **Inline panel**: render the already-computed `totals.byModel` (`contracts.ts:287`) as rows nested under each provider.
4. **Model display names.** Two real cases from the live DB:
   - `claude-opus-4-8[1m]` — the 1M-context variant. Keep it a **distinct row**; it prices differently from `claude-opus-4-8`. Label it `Opus 4.8 (1M ctx)`. Do not strip the suffix to merge them.
   - `codex:gpt-5.5` — strip the `codex:` prefix **for display only**; it is the stored id (`codex-agent.ts:5,75`).
5. Local models (`qwen3.6-35b-4bit`, `qwen3.6-27b-4bit`) must appear as two distinct rows. This is the operator's explicit ask.

### Phase 4 — 1h window

1. `SeriesWindow` → `"1h" | "24h" | "7d" | "30d"`; `unit` → `"minute" | "hour" | "day"`.
2. `specFor()` gains `1h` → 12 buckets × 5 min. Use the SQL and JS shown above.
3. **Write the SQL-label ↔ JS-label agreement test before the implementation.** Insert a row at a known `createdAt`, query the bucket, assert it equals `bucketLabel(new Date(thatTime), "minute")`. This test is the whole reason Phase 4 is separable.
4. `server.ts:774` currently whitelists only `24h`/`30d` and defaults everything else to `7d` — a bare `?window=1h` would silently return 7 days of data. Add `1h`.
5. Add the `1h` button to the modal (`console.ts:1447`) and to `setObsWindowModal()`.
6. X-axis tick labels must format minute buckets as `HH:MM`, not the date.

### Phase 5 — KV cache (fixes Bug 4)

**5a. Claude cache-write split.**

- Migration **v18** (next after v17 — confirm with `PRAGMA user_version` before writing it): add `cacheCreate5mTokens INTEGER` and `cacheCreate1hTokens INTEGER`, nullable. Existing rows stay `NULL`, which means *unknown*, not zero. Render unknown as `—`.
- `stream-parser.ts:53-87`: read `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`. Absent → `null`. Assert the invariant `5m + 1h === cache_creation_input_tokens` when both are present; log a warning on mismatch rather than throwing (never break task completion — see the try/catch contract at `capture.ts`).
- Thread through `RunTelemetryInput` → `normalizeRun` → `recordTaskTelemetry` → `TaskTelemetry`.
- Implement the cost formula and the four derived metrics above. Surface **net cache benefit** prominently; it is the only one that answers the operator's actual question.

**5b. Local KV cache — new capability.**

- New module `src/lib/local-model/metrics.ts`:
  - A ~30-line Prometheus text-format parser. **Add no npm dependency.** It must handle `# HELP` / `# TYPE` comment lines, labelled series (`name{k="v",k2="v2"} 1.0`), and floats including `0.0`.
  - `scrapeTierMetrics(port)` → typed struct, `null` on 404/ECONNREFUSED/timeout. Timeout ≤ 1s.
  - Decode 1-of-N gauges (`kv_cache_dtype`, `turboquant_mode`) to the single active label.
  - Snapshot + delta with reset detection via `uptime_seconds`.
- Poll on an interval and cache with a short TTL. **Never scrape inside an HTTP render path** — the engine is often down and a 1s timeout per request per tier will visibly hang the dashboard.
- Guard on `LocalEngineKind === "rapid-mlx"`. lmstudio/ollama have no such endpoint.
- Fold both tiers into `/observability/series`'s `cache` rollup so local rows carry real data.
- **Delete `CACHE_SUPPORTED`** (`series.ts:66`) and the string `"on-device — no prompt cache"` (`console.ts:2991-2994`). Replace with, per local model: prefix-cache hit rate, tokens saved, KV utilization %, evictions, active dtype + turboquant mode, queue depth. When the engine is down, render `engine offline` — never `0%`.

The local cache section is not cosmetic. `prefix_cache_pressure_evictions_total` climbing means the KV cache is thrashing against the 128GB unified-memory ceiling, and that is the single most actionable local-inference signal on the box.

### Phase 6 — Verify against reality

Not a test-suite pass. Actually exercise it:

1. Run a task on Claude, one on each local tier (8000 and 8001), one on Codex.
2. Open the dashboard. Confirm: 1h window renders non-empty; every model appears as its own row; Claude cache reads/writes are non-zero with a 5m/1h split; local shows a real prefix-cache hit rate.
3. Disable Codex. Confirm it vanishes from `byProvider` and appears under `hiddenProviders` with its run count. Re-enable; confirm it returns.
4. Stop the rapid-mlx server. Confirm the dashboard renders `engine offline` for local cache and does not hang, throw, or show `0%`.
5. Confirm total runs on screen equals `SELECT COUNT(*) FROM task_telemetry` for the window — including the 49 `local-dwarfstar` rows, which are currently missing from every chart.

---

## Constraints

- **No new npm dependencies.** No chart library, no Prometheus client, no date library. The console is a hand-rolled HTML string with hand-drawn SVG; match that.
- **Never delete or rewrite telemetry rows.** Disabling a provider hides it from a rendered view; it is never a data delete (see the contract comment at `server.ts:747-748`). This applies especially to `local-dwarfstar`.
- **Telemetry must never break task completion.** `capture.ts` wraps everything in try/catch. Preserve that. A `/metrics` scrape failure, a cache-invariant mismatch, and a migration hiccup must all degrade to `null`, not throw.
- **`null` ≠ `0`.** Unknown renders as `—`. Measured-zero renders as `0`. Engine-down renders as `engine offline`.
- Every new pure function gets a unit test beside it (`*.test.ts`, `node --test`, existing convention).
- `npm run typecheck && npm test` green at the end of **every** phase, not just the last.
- Write the migration so it is idempotent and matches the existing style at `src/lib/db/index.ts:723-735`.

## Explicitly out of scope

- OpenTelemetry `gen_ai.*` semantic conventions. They're the right long-term vocabulary but the spec is at Development stability and still moving. Not now.
- vLLM / llama.cpp metric names. Not the engine here. rapid-mlx uses its own `rapid_mlx_*` namespace, listed above.
- Exporting to any external observability backend. Everything stays local to the Mac.
- Changing the `/usage` frontier-spend view (`server.ts:794-800`, `console.ts:5170`). Different surface, unrelated `byModel`.

## Where to start

```bash
cd /Users/irvcassio/hivematrix
sqlite3 ~/.hivematrix/hivematrix.db "select provider, model, count(*) from task_telemetry group by 1,2 order by 3 desc;"
curl -s http://127.0.0.1:8000/metrics | rg '^# TYPE'
rg -ril dwarfstar src/   # expect zero hits — that's Bug 2
```

Then read `contracts.ts`, `series.ts`, `store.ts`, and `server.ts:740-790` end to end before touching anything.
