# Local Engine (Rapid-MLX) Toggle + Model/Quant Picker Design

## Context

Settings → Models has first-class **per-provider toggles** for the two frontier
providers (`#s_provider_toggle_rows`, `console.ts:6163-6206`), backed by
`src/lib/config/frontier-providers.ts` and `GET|POST /providers*`
(`server.ts:801-861`). See `2026-07-09-frontier-provider-toggles-design.md`.

The local tier has no equivalent. Rapid-MLX is **always on** (`detectBackends()`
hardcodes `enabled: true` for the `local` backend, `backends.ts:73`) and **fixed
at 4-bit** (`DEFAULT_TIERS`, `local-engine.ts:36-39`; the provisioner pulls
exactly those, `provision.ts:234-237`).

The operator wants parity: a Rapid-MLX toggle in the same block as Claude and
Codex, and — when it is on — an explicit pick of which Qwen model(s) to install
and at which quantization, presented **the way HuggingFace presents quants**: a
list of options with their sizes, chosen by the operator. Not a solver.

---

## 0. Verified facts (probed on this machine, 2026-07-09 — do not re-litigate)

Everything below was confirmed by running the engine and reading the tree. Four
of these contradict what the code currently assumes.

### 0.1 `resolveRapidBinary()` cannot find the installed engine — **this is the bug**

Rapid-MLX **is** installed and both tiers have been serving for 82 hours:

```
$ command -v rapid-mlx
/Users/irvcassio/Library/Python/3.12/bin/rapid-mlx      # pip --user install

$ rapid-mlx ps
PID     PORT    MODEL                     UPTIME
8150    8000    qwen3.6-35b-4bit          82h15m
10289   8001    qwen3.6-27b-4bit          82h11m
```

`resolveRapidBinary()` (`local-engine.ts:125-135`) checks exactly five
candidates: `cfg.binary`, `$HIVE_RAPID_MLX`, `~/hivematrix/.rapidmlx-eval/.venv/bin/`,
`~/.local/bin/`, `/opt/homebrew/bin/`. It **never consults `PATH`**, and pip's
`--user` bin dir (`~/Library/Python/<ver>/bin/`) is not in the list. So it
returns `null` on a machine where the engine is installed and running.

Consequences, both live today:

- `serveCommand()` (`serving.ts:63-67`) returns `null` → `decideServeTick()`
  reports `unmanaged` → the supervisor never manages the tiers.
- `ensureRapidBinary()` (`provision.ts:196-215`) sees no binary and **builds a
  fresh venv and pip-installs a second copy of rapid-mlx** on every provision.

Fix in Phase 1, before any of this feature: add a `PATH` lookup (reuse
`findBinary` from `config/binary-detection.ts`, which already does this for
`claude`/`codex`) and add `~/Library/Python/*/bin/rapid-mlx` to the candidates.
Prefer `PATH` over the hardcoded list.

### 0.2 All six aliases exist; both naming forms are live

`rapid-mlx models` lists `qwen3.6-35b-{4,6,8}bit` and `qwen3.6-27b-{4,6,8}bit`
(plus `-ud`, `-dwq`, `-mxfp4`, `-nvfp4` variants that are **out of scope**). The
running servers advertise **both** the short alias and the full repo id as model
ids, so either resolves:

| tier | short alias | HF repo id |
|---|---|---|
| `fast` | `qwen3.6-35b-<q>` | `mlx-community/Qwen3.6-35B-A3B-<q>` |
| `coding` | `qwen3.6-27b-<q>` | `mlx-community/Qwen3.6-27B-<q>` |

Use the **short alias** as the stored `LocalTier.alias`. It is what
`DEFAULT_TIERS` and `install-local-model.sh:124-129` already write, so existing
configs and launchd agents keep working with no migration.

### 0.3 Sizes must come from a table, and `rapid-mlx ls` double-counts

Real download sizes (HuggingFace API, `sum(siblings[].size)`):

| model | 4-bit | 6-bit | 8-bit |
|---|---|---|---|
| Qwen3.6-35B-A3B (`fast`) | **19.0 GiB** | **27.1 GiB** | **35.2 GiB** |
| Qwen3.6-27B (`coding`) | **15.0 GiB** | **21.2 GiB** | **27.5 GiB** |

Two traps:

- `rapid-mlx ls` reports **exactly 2× these numbers** (`35b-4bit → 38.0 GiB`,
  `35b-8bit → 70.3 GiB`, `27b-4bit → 29.9 GiB`) because the HF cache holds both
  the blob and the snapshot. Do **not** surface `ls` sizes as download sizes.
  They are fine as *disk-reclaimed* estimates for `rapid-mlx rm`.
- `rapid-mlx info <alias>` does **not** report size, for cached or uncached
  models. There is no offline per-alias size source. ⇒ Ship a **static table**
  (§2) with a provenance comment. It is six numbers for two models; it does not
  need to be dynamic.

### 0.4 The dead code you must not build on

- `TIER_FOOTPRINT_GB` (`local-engine.ts:216`) and `HEADROOM_GB` (`:218`) are
  declared and **read by nothing** in `src/` or tests. They are also *wrong*:
  they claim `fast: 20 GB`, `coding: 15 GB` at 4-bit. Delete them — §2 replaces
  them with measured sizes.
- `ensureTier`, `ensureLocalEngine`, `stopLocalEngine` (`local-engine.ts:157-191`)
  have **zero callers**. The live supervisor is `serving.ts`, driven by
  `decideServeTick()` (`:85-98`), and it only ever serves `qwen.primary` — the
  `coding` tier is served by the launchd agents from
  `install-local-model.sh`, which the in-app provisioner does not write.
  ⇒ The toggle gate belongs in `decideServeTick`, not in `stopLocalEngine()`.
- `LocalMemoryPreset.quant` holds **llama.cpp/GGUF** strings (`"UD-Q4_K_M"`,
  `"Q8_0"`) for an engine that uses MLX quants. Its only reader is a test
  asserting its own literal (`local-engine.test.ts:66`). The real quant is
  carried by the alias. Do not route the picker through this field.

---

## Approved Approach

A **Rapid-MLX toggle** rendered in the same Settings block as the frontier
toggles, and — when on — a **HuggingFace-style model/quant picker**: each
available model lists its 4/6/8-bit options with download sizes, and the
operator picks. No fit solver, no recommendation engine, no headroom math.

Availability is gated by detected RAM alone, in three bands:

| detected RAM | local engine | models offered |
|---|---|---|
| **< 32 GB** | unavailable — toggle renders `disabled` | none; all tasks route to a frontier provider |
| **≥ 32 GB** | available | Qwen3.6-35B-A3B (`fast`) — quant 4/6/8 |
| **≥ 64 GB** | available | Qwen3.6-35B-A3B (`fast`) **and** Qwen3.6-27B (`coding`) — quant 4/6/8 each |

`fast` is the first and mandatory model: at ≥ 32 GB it is what gets installed.
`coding` is an optional addition at ≥ 64 GB. Neither is auto-selected beyond
that; the operator chooses the quant.

Behavior, mirroring the frontier toggle where the analogy holds and breaking
from it where local genuinely differs:

| | Frontier (Claude/Codex) | Local (Rapid-MLX) |
|---|---|---|
| Toggle ON, not installed | Opens **Terminal** — login is interactive | Runs the **in-app background provisioner**: installs Rapid-MLX **and** pulls the selected model(s). No Terminal, nothing to sign into. |
| Toggle OFF | Gate in HiveMatrix; CLI stays installed + signed in | Gate in HiveMatrix; **weights stay on disk**, engine stays installed |
| Toggle OFF, resources | No-op | **Must stop the serve process** — a resident tier holds tens of GB of RAM |

**Quant is a reversible choice.** The operator can switch a model up or down
(4 ↔ 6 ↔ 8) at any time after install. Switching pulls the new weights, restarts
that tier's server on the same port, and **leaves the old weights on disk** —
switching back must never re-download. Reclaiming that disk is a separate,
explicitly-confirmed action (§6).

---

## 1. Config schema

Extend the existing `localEngine` block in `~/.hivematrix/config.json`:

```jsonc
{
  "localEngine": {
    "engine": "rapid-mlx",
    "enabled": true,                              // NEW — the operator toggle
    "binary": "/Users/…/Library/Python/3.12/bin/rapid-mlx",
    "tiers": [
      { "key": "fast",   "alias": "qwen3.6-35b-8bit", "quant": "8bit", "port": 8000, "reasoning": false },
      { "key": "coding", "alias": "qwen3.6-27b-6bit", "quant": "6bit", "port": 8001, "reasoning": false }
    ]
  }
}
```

- A tier's **presence in `tiers[]`** means "installed and served". Removing
  `coding` from the array is how the operator deselects it. There is no separate
  `install: false` flag.
- `quant` is stored alongside the alias so the UI renders the current pick
  without parsing, but the **alias stays the serving source of truth** —
  `tierForAlias`, `resolveProvider`, and `buildServeArgs` all key off it.

**Why `localEngine.enabled` and not `providers.local.enabled`.** The top-level
`providers` key is already double-booked: `config/providers.ts` owns it for
*model* provider ids (`ollama`, `mlx`, `lmstudio`, `vllm`, `nanai`, `openai`) and
`config/frontier-providers.ts` owns it for `claude`/`codex` — a collision that
module's header comment explicitly calls out (`frontier-providers.ts:6-12`).
Adding a third meaning under the same key (and `mlx` is *already an id there*)
would make that comment a lie. `localEngine` is the engine's config home and is
already read by `getLocalEngineConfig()`.

## 2. The model catalog (`src/lib/models/local-quant.ts`, new)

Pure data plus two lookups. No I/O, no arithmetic on RAM.

```ts
export type LocalQuant = "4bit" | "6bit" | "8bit";
export const LOCAL_QUANTS: LocalQuant[] = ["4bit", "6bit", "8bit"];

export interface LocalModelOption {
  tier: TierKey;              // "fast" | "coding"
  quant: LocalQuant;
  alias: string;              // qwen3.6-35b-8bit  — what we store + serve
  repo: string;               // mlx-community/Qwen3.6-35B-A3B-8bit — display only
  downloadGiB: number;        // §0.3 — HF API, 2026-07-09. NOT `rapid-mlx ls`.
}

/** Minimum detected RAM (GB) for a tier to be offered at all. */
export const TIER_MIN_RAM_GB: Record<TierKey, number> = { fast: 32, coding: 64 };
```

`LOCAL_MODEL_CATALOG: LocalModelOption[]` — the six rows of the §0.3 table,
written out literally. Add a comment recording that the sizes came from the
HuggingFace API on 2026-07-09 and that `rapid-mlx ls` double-counts.

- `optionsForRam(ramGB): LocalModelOption[]` — filter by `TIER_MIN_RAM_GB`.
  Below 32 GB this returns `[]`, which is what makes the toggle unavailable.
- `optionFor(tier, quant): LocalModelOption | null`
- `quantForAlias(alias): LocalQuant | null` — `/-([468])bit$/` matches the short
  **and** long forms identically; used to display a pre-existing config.

**Delete `TIER_FOOTPRINT_GB` and `HEADROOM_GB`** (§0.4). They have no callers and
their numbers are wrong. Nothing replaces them: we are not computing fit.

RAM banding reuses the existing `localEngineCapability()` /
`memoryTierForGB()` (`local-engine.ts:354-392`) for the `< 32 GB → cloud-only`
decision and its `reason` string — that logic and `LOCAL_MEMORY_PRESETS` stay as
they are. The picker only *adds* the quant dimension the presets never had.

## 3. Serving gate (where toggle-off frees RAM)

Per §0.4 the live supervisor is `serving.ts`. Extend `decideServeTick()`:

```ts
export type ServeTickDecision =
  | { action: "disabled" }   // NEW — operator turned the local engine off
  | { action: "unmanaged" } | { action: "healthy" } | { action: "starting" }
  | { action: "throttled" } | { action: "spawn" };
```

- Add `enabled: boolean` to the input; return `{ action: "disabled" }` **first**,
  before the `location` / `hasCommand` / `healthy` checks. The tick handler kills
  any live child on `disabled` and does not respawn.
- The caller passes `isLocalEngineEnabled()`. `decideServeTick` stays pure — the
  flag is an input, never a config read inside the function.
- `GET /local-model/status` reports `enabled: false` so the console can say
  "off" rather than "not running", which today means "crashed".

Once §0.1 is fixed, `serveCommand()` starts returning a real command and the
supervisor will begin managing tiers it previously reported as `unmanaged`.
**Verify it adopts the already-running 82h servers rather than double-spawning
on the same port** — `decideServeTick` returns `healthy` when the port answers,
so it should, but this path has never once executed on this machine.

## 4. Backends

`detectBackends()` (`backends.ts:68-82`) hardcodes the `local` row's
`enabled: true`. Bring it into line with the frontier rows immediately below:

```ts
installed:  localConfigured,
enabled:    isLocalEngineEnabled(),
configured: localConfigured && isLocalEngineEnabled(),
```

Same leverage point the frontier spec used: `configured` is what the model
registry (`available.ts:80-147`) and routing already gate on, so a disabled local
engine drops out of the default-model list and the role selectors for free.

## 5. Endpoints

**Keep `GET /providers` frontier-only.** Its three consumers all treat every row
as a frontier provider — onboarding (`console.ts:4290`), Usage
(`console.ts:5062`), and the toggle block (`console.ts:6167`). A `local` row
would leak into onboarding and Usage, and `authPresent` is meaningless for it.
The visual unity the operator asked for is a **rendering** concern (§7), not a
payload concern.

- `GET /local-engine` → the picker's whole state in one read:
  ```jsonc
  {
    "enabled": true,
    "installed": true,          // rapid-mlx binary resolves (post-§0.1 fix)
    "capable": true,            // ramGB >= 32 && arm64
    "reason": null,             // set when !capable, from localEngineCapability()
    "ramGB": 137,
    "ready": true,              // fast tier answering
    "selection": { "fast": "8bit", "coding": "6bit" },   // null-valued when not installed
    "options": [
      { "tier": "fast", "quant": "8bit", "alias": "qwen3.6-35b-8bit",
        "downloadGiB": 35.2, "cached": true }
    ]
  }
  ```
  `cached` comes from `rapid-mlx ls` (alias → on-disk), so the UI can label an
  option **"already downloaded"** vs **"35.2 GiB download"**. That is the single
  most useful thing on the screen for someone switching quants.
- `POST /local-engine/enabled` `{ enabled }` → persist `localEngine.enabled`,
  broadcast `local-engine:changed`. On `false` the next serve tick reaps the
  child.
- `POST /local-engine/selection` `{ fast: "8bit", coding: "6bit" | null }` →
  reject (400) any tier whose `TIER_MIN_RAM_GB` exceeds detected RAM; persist;
  return `{ pullRequired: string[] }` (aliases not yet cached).

`POST /local-engine/provision` (`server.ts:1227`) already runs as a background
job with a polled log. **Reuse it unchanged as the transport** for both first
install and quant switches; only `planLocalEngine()` beneath it learns about
selection (§6).

## 6. Provisioner: install engine + selected models; switch quants

`planLocalEngine(env)` (`provision.ts:69-81`) ignores operator choice. Give it a
second argument:

```ts
export function planLocalEngine(
  env: Partial<HardwareProbe> = {},
  selection: LocalSelection | null = readSelection(),
): ProvisionPlan
```

- `selection === null` → `fast` at `4bit` (today's default), plus `coding` at
  `4bit` when RAM ≥ 64 GB. Identical to current behavior.
- Otherwise → one `LocalTier` per selected tier:
  `{ key, alias: optionFor(key, quant).alias, quant, port, reasoning: false }`.
  Ports stay `8000` / `8001` (`DEFAULT_TIERS`) so a quant switch reuses the port.
- `provisionLocalEngine()` (`provision.ts:218`) needs no change beyond the plan
  it is handed — it installs the engine if missing (`ensureRapidBinary`, now
  correct per §0.1) and `rapid-mlx pull`s each `plan.tiers[].alias`. That single
  call is exactly the "toggle on installs both Rapid-MLX and the model" flow.

**Switching quant** is the same code path: new selection → new plan → pull (skip
if `cached`) → rewrite `localEngine.tiers` → the supervisor sees a changed alias
on the port and restarts the tier onto it. Because ports are stable and the old
weights are retained, switching back is a restart, not a download.

Two things that will bite:

- `qwenProfileForProvisionPlan()` (`provision.ts:83`) derives `qwen.primary` from
  `plan.tiers[fast]`, so a quant change repoints the supervisor automatically —
  **but** `syncLocalModelProfilesForProvisionPlan()` only overwrites a profile it
  considers *managed*, and `isManagedRapidTierRef()` (`provision.ts:136-140`)
  tests membership in `knownTierAliases()`, which is built from `DEFAULT_TIERS`
  — i.e. **only the 4-bit aliases**. An 8-bit tier reads as operator-authored,
  the provisioner silently declines to update `qwen.primary`, and the supervisor
  keeps serving the old 4-bit model while the UI claims 8-bit. Widen
  `knownTierAliases()` to the full catalog. **This is the easiest bug to ship
  here and it is silent.**
- `tierForAlias()` (`local-engine.ts:107`) matches against `cfg.tiers` then
  `SUPPORTED_LOCAL_TIER_PRESETS` (= `DEFAULT_TIERS`, 4-bit only). A 6/8-bit alias
  in a fresh config resolves via `cfg.tiers`, but a *bare* lookup fails — and
  `config/providers.ts:108` uses exactly that to route a model id to the `mlx`
  provider. Back it with `LOCAL_MODEL_CATALOG`.

**Never delete weights implicitly.** Offer disk reclamation as an explicit,
confirmed action: a "Free N GiB" link next to a cached-but-unselected option,
calling `rapid-mlx rm <repo>`. Size it from `rapid-mlx ls` (the 2× number is the
right one *here* — it is what actually leaves the disk).

## 7. Console UI

In `#s_provider_toggles` (`console.ts:1027-1031`), relabel the section from
"Frontier providers" to **"Providers"** and render three rows: Claude, Codex,
Rapid-MLX. `renderProviderToggles()` (`console.ts:6163`) fetches `/providers`
and `/local-engine` in parallel and concatenates — reuse `settingsSwitch()`
(`console.ts:6376`) and the existing row markup verbatim so the rows are
pixel-identical.

Rapid-MLX status chip, mirroring `providerStatusChip()` (`console.ts:6155`):

| state | chip |
|---|---|
| `!capable` | `Unavailable · <reason>` — switch `disabled`, per §Approach band 1 |
| `!enabled` | `Off` |
| `enabled && !installed` | `Enabling — installing engine + model` (live provision log) |
| `enabled && installed && !ready` | `On — starting` |
| `enabled && ready` | `On` |

When enabled and capable, the row expands into the picker — one block per model
offered at this RAM band, HuggingFace-style:

```
Qwen3.6-35B-A3B                                    fast · port 8000
  ( ) 4-bit    19.0 GiB      ✓ downloaded
  ( ) 6-bit    27.1 GiB        download
  (•) 8-bit    35.2 GiB      ✓ downloaded

Qwen3.6-27B                                     coding · port 8001    [ Remove ]
  (•) 4-bit    15.0 GiB      ✓ downloaded          Free 29.9 GiB
  ( ) 6-bit    21.2 GiB        download
  ( ) 8-bit    27.5 GiB        download
```

- Radio per model (quants are mutually exclusive); all three always enabled —
  the operator picks, we do not judge. Show size and cached-state, nothing more.
- The `coding` block renders only at ≥ 64 GB, with `[ + Add Qwen3.6-27B ]` when
  absent and `[ Remove ]` when present.
- Changing a radio calls `POST /local-engine/selection`; if `pullRequired` is
  non-empty, show `Apply — downloads N GiB` which calls the existing
  `POST /local-engine/provision` and streams into `#provisionLog`
  (`console.ts:5507`, `pollProvision()`). If empty, apply is instant (restart
  only) — that is the switch-back case.

`renderProvisionUI()` (`console.ts:5501`) hardcodes
`"Installs Rapid-MLX + pulls " + recommendedTiers.join(" + ")`. Repoint its
caption at the **selection** so it stops lying once the operator picks something
other than the default.

## Files touched (map)

| Area | File | Change |
|---|---|---|
| **Detection fix** | `src/lib/models/local-engine.ts:125-135` | `resolveRapidBinary` consults `PATH` + `~/Library/Python/*/bin` (§0.1) |
| Catalog | `src/lib/models/local-quant.ts` (new) | `LocalQuant`, `LOCAL_MODEL_CATALOG`, `TIER_MIN_RAM_GB`, `optionsForRam`, `optionFor`, `quantForAlias` |
| Engine cfg | `src/lib/models/local-engine.ts:36-41,107-111,216-218` | `quant` on `LocalTier`; `isLocalEngineEnabled`/`setLocalEngineEnabled`; `tierForAlias` backed by catalog; **delete** `TIER_FOOTPRINT_GB` + `HEADROOM_GB` |
| Serving | `src/lib/local-model/serving.ts:77-98` | `disabled` decision + `enabled` input; reap child |
| Backends | `src/lib/models/backends.ts:68-82` | `enabled` from config; `configured = installed && enabled` |
| Provision | `src/lib/models/provision.ts:69-81,128-140,218-244` | selection-aware plan; `knownTierAliases()` spans the catalog |
| Server | `src/daemon/server.ts` | `GET /local-engine`, `POST /local-engine/enabled`, `POST /local-engine/selection`; `/local-model/status` reports `enabled` |
| Console | `src/daemon/console.ts:1027,5501,6163` | third toggle row; HF-style picker; provision caption reads selection |

## Testing

- **Detection (§0.1)** — `resolveRapidBinary` finds a binary that is only on
  `PATH`; finds `~/Library/Python/3.12/bin/rapid-mlx`; still prefers
  `cfg.binary` and `$HIVE_RAPID_MLX` over both. **Write this test first — it
  fails on `main` today.**
- **Catalog** — `optionsForRam(24)` → `[]`; `optionsForRam(32)` → 3 `fast` rows
  only; `optionsForRam(64)` → all 6; `quantForAlias` parses `qwen3.6-35b-8bit`
  *and* `mlx-community/Qwen3.6-35B-A3B-8bit`, returns `null` for `bge-small`.
- **Enablement** — absent `localEngine.enabled` ⇒ default from detection
  (binary present && capable); explicit `false` beats detection.
- **Serving** — `decideServeTick({ enabled: false, healthy: true, … })` ⇒
  `disabled` (the gate precedes *every* other branch, including `healthy`).
- **Backends** — the four `(installed × enabled)` quadrants of the `local` row,
  matching the existing frontier truth table.
- **Provision** — a `coding@8bit` selection yields a plan whose alias is
  `qwen3.6-27b-8bit` on port `8001`; `syncLocalModelProfilesForProvisionPlan`
  **still overwrites** a managed `qwen` profile whose stored alias is 8-bit
  (the §6 trap — red before the `knownTierAliases()` widening, green after),
  and still refuses to touch an operator-authored one.
- **Server** (grep-invariant, cf. `server.test.ts`) — `GET /local-engine` shape;
  `POST /local-engine/selection {coding}` on a 32 GB probe returns 400;
  `POST /local-engine/enabled {false}` ⇒ `local` absent from `/models`'
  selectable list.
- **Regression** — with `localEngine.enabled` absent and a 4-bit config, every
  existing local test passes unchanged.

## Out of scope / non-goals

- **No fit calculation, no recommendation engine, no headroom math.** RAM gates
  *which models are offered* (32 / 64 GB bands); the operator picks the quant.
- **No weight deletion except via the explicit "Free N GiB" action.** Never on
  toggle-off, never on quant switch.
- **No `-ud` / `-dwq` / `-mxfp4` / `-nvfp4` variants** — they exist in
  `rapid-mlx models` but the picker offers 4/6/8-bit only.
- **No third model, no other engine** — LM Studio / Ollama stay
  `LocalEngineKind` values this picker does not manage.
- **No per-quant context retuning** — `defaultContext` keeps coming from
  `LOCAL_MEMORY_PRESETS`. Arguably an 8-bit model on a 64 GB Mac wants a smaller
  context. Future work.
- **No cleanup of the dead `ensureTier`/`ensureLocalEngine`/`stopLocalEngine`
  trio or the decorative `LocalMemoryPreset.quant` strings** (§0.4) — flagged so
  the implementer does not build on them, not so they get deleted mid-feature.

## Open risks

- **Supervisor adoption of the 82h-old servers** (§3). Fixing §0.1 makes
  `serveCommand()` non-null for the first time; if `decideServeTick` mis-sequences,
  it could spawn a second server on an occupied port. Verify against the live
  processes before shipping.
- **`isManagedRapidTierRef` false-negative** (§6) — silent, and the worst failure
  mode here: UI says 8-bit, engine serves 4-bit. Has a red-then-green test.
- **Static sizes drift.** If `mlx-community` re-uploads a repo the table goes
  stale. Acceptable: six numbers, cosmetic, and `cached` state comes from the
  engine at runtime.
- **Both frontier providers off *and* local off** = no model provider at all.
  Allow it (operator autonomy), but the console must show a blocking banner and
  task creation must fail with "no model provider enabled", not a routing error.
- **A < 32 GB Mac with an existing local config.** The band rule says
  frontier-only, but `localEngine.tiers` may already be populated from an older
  install. Render the toggle `disabled` and leave the config untouched; do not
  silently wipe it.

---

## Build plan for the implementing session

Each phase is independently committable. Run `npm run build` and `node --test`
after every phase.

**Phase 1 — Fix `resolveRapidBinary()` (§0.1). Ship this alone.**
It is a live bug: on this machine the engine is installed and serving, the
supervisor reports `unmanaged`, and every provision rebuilds a redundant venv.
Test-first (the test fails on `main`). Nothing else in this spec is trustworthy
until binary detection is honest.
**Checkpoint:** `resolveRapidBinary()` returns
`/Users/irvcassio/Library/Python/3.12/bin/rapid-mlx`; `/local-model/status`
reports `managed: true` and does **not** spawn a second server on 8000.

**Phase 2 — Catalog (`local-quant.ts`), pure, no callers.**
Six rows, `TIER_MIN_RAM_GB`, `optionsForRam`, `optionFor`, `quantForAlias`.
Delete `TIER_FOOTPRINT_GB` / `HEADROOM_GB`.
**Checkpoint:** catalog tests green; the build still passes with the two
constants gone (proving §0.4's "zero callers").

**Phase 3 — Enablement + serving gate.**
`isLocalEngineEnabled`/`setLocalEngineEnabled`; `LocalTier.quant`; `tierForAlias`
backed by the catalog; `decideServeTick` `disabled` branch; `backends.ts`
`configured = installed && enabled`.
**Checkpoint:** with `localEngine.enabled: false`, the supervisor reaps its child
and `local` drops out of `/models`; with the key **absent**, every pre-existing
test passes unchanged.

**Phase 4 — Selection-aware provisioner.**
`planLocalEngine(env, selection)`; widen `knownTierAliases()`.
**Checkpoint:** a `coding@8bit` selection produces a plan pulling
`qwen3.6-27b-8bit` and repoints `qwen.primary` at it. The §6 trap has a
red-then-green test.

**Phase 5 — Endpoints.**
`GET /local-engine` (with `cached` from `rapid-mlx ls`),
`POST /local-engine/enabled`, `POST /local-engine/selection` (RAM-band
rejection); `/local-model/status` reports `enabled`.
**Checkpoint:** `curl /local-engine` on this 137 GB Mac lists all six options,
marks `35b-4bit`, `35b-8bit`, `27b-4bit` as `cached: true` (per §0.3's real
cache), and reports `selection: {fast: "4bit", coding: "4bit"}`.

**Phase 6 — Console UI.**
Third toggle row; per-model quant radios with sizes and cached badges;
`+ Add Qwen3.6-27B` / `Remove` at ≥ 64 GB; `Free N GiB`; `Apply` → existing
provision job + `#provisionLog`; fix `renderProvisionUI`'s caption.
**Checkpoint (manual, in-app):** toggle Rapid-MLX off → both serve processes
exit, RAM drops, `local` leaves the default-model list, the header `local` pill
hides; toggle on → engine + models install, tiers return. Switch `fast` to 8-bit
→ `Apply` shows "already downloaded", restart only, no download. Switch to 6-bit
→ 27.1 GiB download. Switch back to 8-bit → instant.

### Global acceptance criteria

1. `resolveRapidBinary()` finds a `PATH`-installed engine; the supervisor manages
   the already-running tiers instead of reporting `unmanaged`.
2. A Rapid-MLX toggle sits in the same Settings block as Claude and Codex, with
   identical markup, and persists across daemon restart.
3. Toggling **on** with nothing installed installs Rapid-MLX **and** pulls the
   selected model(s) in one background job, with a live log.
4. Toggling **off** stops the serve processes and frees their RAM, removes local
   from the model registry and routing, and **leaves weights and engine on
   disk**. Toggling back on restores service with no re-download.
5. Below 32 GB (or non-arm64) the toggle renders `disabled` with the existing
   `cap.reason`, and every task routes to a frontier provider.
6. At ≥ 32 GB, Qwen3.6-35B-A3B is offered at 4/6/8-bit with sizes
   (19.0 / 27.1 / 35.2 GiB) and cached badges. At ≥ 64 GB, Qwen3.6-27B is
   additionally offerable at 4/6/8-bit (15.0 / 21.2 / 27.5 GiB).
7. The operator can switch any model's quant up or down at will. A switch to an
   already-downloaded quant is a restart with no download. Old weights are kept
   until explicitly freed.
8. An existing config carrying `qwen3.6-35b-4bit` keeps working untouched and
   displays as `fast · 4-bit · downloaded`.
9. No regression with `localEngine.enabled` absent: default is
   "capable && installed ⇒ enabled".

### Guardrails for the implementer

- **Fix binary detection first** (§0.1) and confirm no double-spawn on 8000/8001.
- **Never delete model weights** except behind the explicit "Free N GiB" action.
- **Do not build on `ensureTier` / `ensureLocalEngine` / `stopLocalEngine`** —
  zero callers, they serve nothing (§0.4). The gate belongs in `decideServeTick`.
- **Do not add a `local` row to `GET /providers`** — it leaks into onboarding and
  Usage (§5). Unify at the render layer.
- **Do not surface `rapid-mlx ls` sizes as download sizes** — they are 2× (§0.3).
- **Do not reintroduce a fit solver.** RAM picks the band; the operator picks the
  quant.
- **Do not treat `LocalMemoryPreset.quant` as meaningful** — dead GGUF vocabulary
  (§0.4). The alias carries the quant.
- If any assumption here conflicts with what you find in the code, **stop and
  surface it** rather than guessing. Written against the tree at `edaf99d`
  (0.1.162), with the engine probed live on 2026-07-09.
