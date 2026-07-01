# Claude Model Alias Selection — Design

Date: 2026-06-30
Status: Approved direction (aliases + drop version labels). Author: coding agent (Superpowers brainstorming phase).

## Problem

The HiveMatrix "New task" dialog and Settings offer Claude models labeled with
pinned versions — "Claude Opus 4.8", "Claude Sonnet 4.6" — and pass the pinned
full model IDs straight to the `claude` CLI:

- `src/lib/models/available.ts:15` — `CLAUDE_SONNET_ID = "claude-sonnet-4-6"`
- `src/lib/orchestrator/subprocess.ts:320` — `args.push("--model", input.model)`

The `claude` CLI's own model picker now shows **Opus 4.8 / Sonnet 5 / Haiku 4.5**.
Because HiveMatrix pins `claude-sonnet-4-6` (the *full name*), selecting "Sonnet"
locks the user to the **old** Sonnet 4.6 — not the current Sonnet 5. The labels
are also stale/misleading.

Operator's ask (verbatim): *"which Sonnet is being selected… the text needs
updated… should all the model versions be removed since sonnet is now sonnet 5?"*

## Key fact (verified against the installed CLI)

`claude --help`:

> `--model <model>` — Provide an **alias for the latest model** (e.g. `sonnet`
> or `opus`) or a model's full name (e.g. `claude-sonnet-4-6`).

So passing the alias `sonnet` / `opus` / `haiku` always resolves to the current
model for that tier. This is the mechanism that makes the fix "never stale."

## Decision

Use the **aliases** (`opus` / `sonnet` / `haiku`) as the canonical Claude model
IDs throughout HiveMatrix, and **drop version numbers** from the display labels.

- Selection always tracks the latest model (you get Sonnet 5 automatically).
- Labels never go stale again — no version bump needed at each Anthropic release.
- Matches the operator's stated preference to remove versions.

## Approaches considered

1. **Alias-as-canonical (CHOSEN).** Replace the pinned full IDs with the bare
   aliases everywhere (constants, catalog, resolver defaults). Labels become
   "Claude Opus" / "Claude Sonnet". Honest end-to-end; delivers "remove all
   versions" literally. Cost: three frontier-detection regexes and the display
   short-name lookup must learn the aliases (see Blast radius).

2. **Boundary translation only.** Keep `claude-sonnet-4-6` internally; map
   `claude-*` → alias only at the `--model` call site. Smallest blast radius, but
   the internal constant stays a versioned "lie" (maps to Sonnet 5 while named
   4.6) and does not satisfy "remove the versions" in the code. Rejected as a
   half-measure.

3. **Bump pinned IDs to current.** Relabel "Sonnet 5" and pin the new full ID.
   Requires knowing the exact new ID string and re-stales at the next release.
   Rejected — it's the treadmill we're trying to get off.

## Chosen design — details

### The one genuinely fragile matcher: display short name
`getTaskModelShortName` (`src/lib/models/task-display.ts:16`) looks up
`MODEL_SHORT_NAMES[modelId]` by **exact match**. The `claude` CLI reports the
*resolved* full ID in its stream init event (see
`src/lib/orchestrator/stream-parser.test.ts:8`), so telemetry will receive e.g.
`claude-sonnet-5-0`. Exact-match misses it and the label degrades to an ugly
suffix ("0"/"5"). Fix: match the Claude family by **prefix** —
`claude-opus*` → "Opus", `claude-sonnet*` → "Sonnet", `claude-haiku*` → "Haiku",
and also map the bare aliases. This makes the display robust to *any* future
version, which is the real "never stale" win.

### Frontier-detection regexes must learn the bare aliases
Three separate "is this a frontier (cloud) model?" predicates are anchored on
`claude-` / `claude`, so a bare `sonnet` would be misclassified as **local**:

- `src/lib/models/writer-role.ts:26` — `FRONTIER_RE` (misclassify → writer
  locked to free/local: a silent correctness bug)
- `src/lib/routing/model-resolver.ts:35` — `isFrontierOverride` (Cloud-only would
  drop an alias override)
- `src/lib/usage/frontier-usage.ts:44` — `isFrontierModel` (usage would treat an
  alias task as free)

Each must also accept `opus|sonnet|haiku`. `providerForModel`
(`observability/contracts.ts:22`) already matches `/^(claude|opus|sonnet|haiku)/`
— no change needed there.

### The effort gate
`src/lib/orchestrator/subprocess.ts:328` adds `--effort` only when
`!input.model || input.model.startsWith("claude-")`. A bare alias fails that
check, so Claude tasks would lose their effort level. Fix: gate on
"is this an Anthropic model" (accept the aliases too), not the `claude-` prefix.

### Wire value + internal classifier
- `subprocess.ts:320` sends `input.model`, which now *is* the alias → correct.
- `intent-classifier.ts:93,107` hardcode `--model claude-haiku-4-5-20251001` /
  `--model claude-sonnet-4-6`. Switch to `--model haiku` / `--model sonnet` so the
  internal classifier also tracks the latest and stops pinning stale IDs.

### Labels
- `catalog.ts` `MODEL_OPTIONS`: labels already "Opus"/"Sonnet"/"Haiku"; only the
  `modelId` values change to aliases. `MODEL_SHORT_NAMES` Claude keys move to the
  family-prefix logic.
- `available.ts` dialog + role labels: "Claude Opus 4.8 (claude-opus-4-8)" →
  "Claude Opus"; "Claude Sonnet 4.6 (…)" → "Claude Sonnet".

### Config back-compat
Existing `config.json` with `thinkModel: "claude-opus-4-8"` keeps working: the CLI
accepts full names and the (now alias-aware) regexes still match `claude-*`. No
migration needed.

## Blast radius (files)

Source: `catalog.ts`, `available.ts`, `task-display.ts`, `writer-role.ts`,
`model-resolver.ts`, `frontier-usage.ts`, `subprocess.ts`,
`orchestrator/intent-classifier.ts`, `docs/MODEL-ROUTING.md`.

Tests to update/extend: `available.test.ts`, `task-display.test.ts`,
`model-resolver.test.ts`, `frontier-usage.test.ts`, `writer-role.test.ts`,
`observability/contracts.test.ts` (add alias cases).

Out of scope: `video/news-script.mjs` (standalone, API-key path, separate posture)
— flagged, not touched.

## Risks & mitigations

- **Silent local-misclassification** of a bare alias → mitigated by the three
  regex fixes, each covered by a failing test first (TDD).
- **Ugly resolved-ID labels** → mitigated by family-prefix short names, with a
  test asserting `claude-sonnet-5-0` → "Sonnet".
- **Lost `--effort`** on alias tasks → mitigated by the effort-gate fix + test.

## Verification gates (AGENTS.md)

1. `npm run typecheck` — zero errors
2. `npm test` — all passing
3. `node scripts/scope-wall.mjs` — zero violations
