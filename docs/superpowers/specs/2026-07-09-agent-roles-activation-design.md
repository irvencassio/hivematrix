# Agent Roles — Activation, Per-Profile Model, and Provenance

> **Spec 1 of 3.** Order matters. This spec makes the existing role roster *reachable*.
> Spec 2 (`2026-07-09-agent-roles-console-screen-design.md`) gives it a UI.
> Spec 3 (`2026-07-09-coo-delegation-result-readback-design.md`) makes the COO real and
> **requires a DECISIONS.md entry** before it may be built.
> Do not start 2 or 3 before 1 lands.

## Context

HiveMatrix ships **14 agent profiles** (`src/lib/config/agent-profiles.ts`) — `developer`,
`qa`, `designer`, `coo`, `cto`, `founder`, `ceo`, `cfo`, `analyst`, `marketing`,
`researcher`, `inventor`, `trader`, `general`. Each carries a system prompt, a scoped
tool allowlist, and a `loadClaudeMd` flag. Three are deeply written (`designer` 58 prompt
lines, `trader` 49, `qa` 45).

**None of them except `developer` has ever run.** Verified against the live database on
2026-07-09: all 64 tasks in `~/.hivematrix/hivematrix.db` have `agentType = "developer"`.
Zero `designer`, zero `qa`, zero `coo`.

The roster is unreachable code. This spec fixes that, gives profiles a real model axis,
and surfaces which role handled a task. It is deliberately unglamorous: **without it,
every other role improvement is decoration.**

## 0. Verified facts (checked 2026-07-09 against commit `1456319`; do not re-derive)

**The activation bug — three independent breaks, all required to fix:**

1. **The gate flag is unreachable.** `scheduler.ts:336-350` reads
   `cfg.features?.agentSpecialization === true` **directly from `~/.hivematrix/config.json`**,
   bypassing the features module. The string `agentSpecialization` occurs in **exactly one
   place in the whole repo** (`scheduler.ts:343`). It is **not** in `KNOWN_FEATURES`
   (`src/lib/config/features.ts:14-17`, which lists only `ado`, `voice`,
   `openclaw.chatDock`, `promptWizardAlways`), so it is not exposed by
   `GET /settings/features` and **cannot be toggled from Settings → Features**. It is
   absent from the live config.

2. **The fallback is hard-coded.** When the flag is off, `scheduler.ts:349` sets
   `agentType = "developer"` unconditionally. `classifyTask()`
   (`src/lib/orchestrator/intent-classifier.ts`) is therefore **never invoked**.

3. **There is no manual override.** `grep agentType src/daemon/console.ts` → **no hits.**
   The New Task form never sends `agentType`. `POST /tasks` defaults it to `developer`
   (`server.ts:1616`, `:3453`). So the operator cannot pick a role even deliberately.

**Profile shape.** `AgentProfile` (`agent-profiles.ts:6-14`) =
`{ id, name, description, systemPrompt, tools: string[], loadClaudeMd: boolean, icon }`.
**There is no `model` field.** Model is chosen by a coarse map,
`resolveModelForAgentRole` (`scheduler.ts:136-148`): `developer|cto|qa → roleModels.coding`,
`marketing → roleModels.writer`, everything else → `undefined`. So `designer`, `coo`,
`founder`, `analyst`, `cfo`, `researcher`, `inventor`, `trader`, `ceo`, `general` get **no
model steer at all**.

**Custom profiles already work.** `CUSTOM_PROFILES_DIR = ~/.hivematrix/agents/`
(`agent-profiles.ts:16`); `loadCustomProfiles()` (`:402-428`) reads every `*.json`,
requires `id` + `systemPrompt`, fills defaults. Customs **override** built-ins
(`getAgentProfile` `:430-440`; `getAllAgentProfiles` merges `:442-449`). Read fresh on
every call — **no daemon restart needed**. The directory does not exist yet on this
machine. This is the backing store Spec 2's editor will write to.

**Profile depth (measured, prompt lines):** `designer` 58, `trader` 49, `qa` 45,
`developer` 11, `cto` 11, `ceo` 11, `coo` 11, `inventor` 10, and 9 each for `general`,
`researcher`, `marketing`, `founder`, `cfo`, `analyst`.

**Task provenance pills already exist.** Commit `0252d06` added colour-coded pills to the
task detail view for `output.modelsUsed`, MCP servers (derived from `mcp__<server>__`
tool_use log entries), and `output.command`. `renderProvenancePills`-style code lives near
`console.ts:2705`. Adding a **role** pill follows the identical pattern — no new tracking.

**Dead flag.** `config.json` contains `taskIntakeModelDecomposition: true`, a leftover of
the Work Packages subsystem deleted in DECISIONS.md Q15 (2026-07-06). Nothing reads it.

**The prompt wizard is coding-biased and runs on every task.**
`src/lib/intake/enhance-prompt.ts:21-31` `SYSTEM_PROMPT` says *"a prompt wizard for a
**coding-agent** task queue"*, *"that **a coding agent** can execute"*, *"infer likely
**file paths**"*. It returns `{ enhanced, rationale, title }` — **no role**. It runs on
local Qwen (temp 0.3, `reasoningEffort:"low"`, 30s timeout) and every failure path returns
`passthrough(raw)` (`:33-35`), never blocking creation. `promptWizardAlways: true` is set
in the live config, so it fires on **every** task. `acceptEnhancedPrompt()` replaces
`t_desc` with the rewritten text (`console.ts` ~`:8030`) — and `classifyTask` reads that
rewritten text. **Consequence: the wizard launders every prompt into coding-agent language
before classification runs.** See §6.

**Cutting profiles is safe (verified).** The ids `ceo`, `cto`, `cfo`, `analyst`,
`inventor`, `trader` appear in **only** `agent-profiles.ts` and
`src/lib/orchestrator/keyword-classifier.ts` — zero other non-test files.
`getAgentProfile()` falls back to `developer` on an unknown id (`:430-440`). The live DB
has 64 tasks, all `developer`. No migration is required.

**Scheduler.** Claims `{status:"backlog", executor:"agent"}` ordered by `position`
(`scheduler.ts:282,328`); default 4 concurrent slots (`:49`, actual from
`agentManager.getSlots()`). `effectiveModel` computed at `:353` and written onto the task
(`:411-418`); spawn path `agentManager.spawnAgent(..., model?, ...)`
(`agent-manager.ts:235`) → `spawnGenericAgent(..., modelId, agentType, ...)`
(`generic-agent.ts:829-841`).

---

## Approved Approach

Make the roster reachable, real, and visible — in that order. Three changes:

1. **Activate routing** — register the flag properly, add a manual role picker, and let
   `classifyTask` actually run.
2. **Give profiles a model** — a `model?` field on `AgentProfile` that wins over the
   coarse role map.
3. **Show the role** — a provenance pill on the task card, reusing the existing pill
   mechanism.

Plus: rewrite the nine thin profiles. Explicitly **do not touch** `designer`, `qa`, or
`trader` — they are the best-written prompts in the codebase.

**Non-goal:** delegation, inter-agent messaging, or anything that reads a child task's
result. That is Spec 3 and is gated on reversing DECISIONS.md Q15.

---

## 1. Activate role routing

### 1a. Register `agentSpecialization` as a real feature

Add to `KNOWN_FEATURES` (`features.ts:14-17`):

```ts
{ key: "agentSpecialization",
  label: "Specialist agents",
  description: "Route each task to a specialist role (developer, QA, designer, COO…) instead of always using the developer role. Off = every task runs as developer." }
```

Then **change `scheduler.ts:336-350` to read the flag via `isFeatureEnabled("agentSpecialization")`**
(`features.ts:81`) instead of hand-parsing `config.json`. The direct `readFileSync` of
`config.json` in the scheduler is the bug — delete it. Keep the fail-closed default
(absent ⇒ off ⇒ `developer`), so behavior is unchanged until the operator opts in.

### 1b. Manual role picker in New Task

The New Task form (`console.ts`, the `#taskForm` block ~`:1683-1745`) has an **Advanced**
`<details>` containing Model and Mode selects. Add a **Role** select immediately above
Model:

- Options: `Auto` (default, value `"auto"`) + one option per `getAllAgentProfiles()` entry,
  rendered as `{icon} {name}`, value = `id`.
- Populate from a new `GET /agents/profiles` (§4), same lifecycle as `loadModels()`.
- Send `agentType` in the `createTask()` POST body (`console.ts:8067` area, alongside
  `route`). Omit/`"auto"` ⇒ current behavior.
- Copy under the select: *"Auto picks a specialist when 'Specialist agents' is enabled in
  Settings → Features; otherwise every task runs as developer."*

This gives the operator an override **even when the feature flag is off** — an explicit
`agentType` on the task must always be honored. Guard in `scheduler.ts`: only the literal
`"auto"` goes through the classify/fallback branch; any explicit id is used as-is.

### 1c. Make `classifyTask` reachable and safe

`classifyTask` (`intent-classifier.ts`) already: builds descriptions from
`getAllAgentProfiles()`, calls the Claude CLI (Haiku) with an 8s timeout, falls back to
`classifyByKeywords`, then to `"developer"`. Leave that pipeline intact. Two hardening
requirements:

- It shells out to the `claude` binary. If Claude is **disabled as a frontier provider**
  (see the shipped provider-toggle work, commit `7ce9120`) or the binary is absent,
  classification must **skip the CLI and go straight to keywords**, never blocking the
  scheduler for 8s per task.
- Record the classification outcome on the task so it is auditable:
  `output.roleProvenance = { agentType, source: "explicit" | "classifier" | "keyword" | "default" }`.
  This is what the pill in §3 reads and what Spec 2's roster stats aggregate.

---

## 2. Per-profile model

Add `model?: string` to `AgentProfile` (`agent-profiles.ts:6-14`) and to the
`loadCustomProfiles` mapping (`:410-418`). Semantics:

**Precedence (highest first):** explicit `task.model` → `profile.model` →
`resolveModelForAgentRole(...)` → daemon default.

Thread it at the single point where the model is resolved — `scheduler.ts:353`:

```ts
const profile = getAgentProfile(agentType);
const effectiveModel =
  task.model ?? profile.model ?? resolveModelForAgentRole(undefined, agentType);
```

Everything downstream (`:411-418` writing the task, `agent-manager.ts:235`,
`generic-agent.ts:829-841`) already accepts a model id and needs no change.

**Do not** change `routeByRole` / `ModelRole` (`policy.ts:82`). Those are the *workload →
tier* taxonomy (`think`/`execute`/`code-critical`) used by the directive engine and the
Claude subprocess path. They are a different concept that happens to share the word
"role." Leave them alone; a comment at the `AgentProfile.model` field should say so.

**Sensible defaults** (set `model` on the built-ins; a thinking-heavy role should not run
on the operational tier):

| Profile | model | rationale |
|---|---|---|
| `developer`, `cto`, `qa` | `roleModels.coding` (unchanged) | code correctness |
| `designer` | `roleModels.coding` | writes HTML prototypes |
| `founder`, `ceo`, `coo`, `analyst`, `inventor` | `roleModels.thinking` | judgement work |
| `marketing` | `roleModels.writer` (unchanged) | prose |
| `researcher`, `cfo`, `trader`, `general` | leave unset → existing fallback | |

Express these as role-model *references*, not hard-coded model ids, so Settings → Models
still governs. If that indirection is awkward, store a `modelRole: "coding"|"thinking"|"writer"|"operational"`
field instead of a raw `model` — **prefer this**, it composes with the existing settings.

## 3. Role provenance on the task card

Reuse the existing pill renderer (`console.ts` ~`:2705`, the `modelsUsed` / MCP / command
pills added in `0252d06`). Add a **role pill**:

- Label: `{icon} {profile.name}` (e.g. `🎨 UX / UI Designer`).
- Tooltip: how it was chosen — from `output.roleProvenance.source`
  (`explicit` → "you picked it", `classifier` → "auto-classified", `keyword` →
  "keyword-matched", `default` → "default (specialist agents off)").
- Distinct pill class from the model pill; do not overload it.

**Honest scope note.** A task has exactly one `agentType`, so today this pill is always
singular — and, until §1 ships, always `developer`. The operator's request to see *"which
roles were involved"* (plural) only becomes meaningful once a coordinator spawns subtasks
with different roles. That is **Spec 3**. This spec renders one pill correctly and leaves
a `renderRolePills(task, childTasks)` seam that accepts an array, so Spec 3 fills it in
without a rewrite.

## 4. Endpoint

- **`GET /agents/profiles`** → `[{ id, name, description, icon, tools: string[], loadClaudeMd, modelRole?, isCustom: boolean, promptLines: number }]`.
  Built from `getAllAgentProfiles()`. **Never return `systemPrompt` here** (it is large;
  Spec 2 adds a detail route). `promptLines` lets the UI show depth at a glance.

## 5. Reduce the roster: 14 → 7 core + 1 coordinator + a domain tier

Fourteen profiles is not fourteen specializations. Five are C-suite cosplay that duplicate
each other's tools, model, and deliverable — and every duplicate widens the classifier's
decision surface, because **a misrouted specialist is strictly worse than the generalist it
displaced**.

### 5a. The admission test

A role earns a slot only if it differs from every other role on **at least one** of:

1. **Tool asymmetry** — a materially different allowlist (not a subset by accident).
2. **Deliverable** — a different artifact at the end.
3. **Model** — a different `modelRole` tier.

Applying it:

| id | tools | deliverable | model | verdict |
|---|---|---|---|---|
| `developer` | full write | working code | coding | **keep** (baseline) |
| `qa` | read-only + bash | verification report | coding | **keep** — tool asymmetry: *a verifier that cannot write cannot "fix" the test to make it pass*. This separation is the single most valuable one in the roster. |
| `designer` | write | mockup / prototype | coding | **keep** — deliverable |
| `researcher` | read + search | cited brief (**states facts, does not recommend**) | thinking | **keep** — deliverable |
| `founder` | read + search | recommendation with risks (**takes positions**) | thinking | **keep** — deliverable |
| `marketing` | read + write | copy | **writer** | **keep** — model |
| `general` | **none** | an answer | fast | **keep** — no-tools conversational fallback |
| `coo` | `create_task` | plan + synthesis | thinking | **keep, gated** (§5c) |
| `cto` | full write | code | coding | **cut** → `developer`. Identical on all three axes. |
| `ceo` | read + search | strategy | thinking | **cut** → `founder`. Identical. |
| `cfo` | read | analysis | thinking | **cut** → `founder`. |
| `analyst` | read + search | analysis | thinking | **cut** → `researcher`. Identical. |
| `inventor` | read + search | *(none stated)* | — | **cut** → `founder`. No distinct deliverable. |
| `trader` | read + search | trade thesis | thinking | **move to domain tier** (§5b) — a *subject*, not a work role. |

**Net core roster (classifier-routable): `general`, `developer`, `qa`, `designer`,
`researcher`, `founder`, `marketing`.** Seven. `coo` is an eighth, gated.

`researcher` vs `founder` are the closest pair; their prompts must make the boundary
explicit and enforceable: **researcher gathers and cites and refuses to recommend; founder
recommends, takes a position, and names the risks.** If a classifier still confuses them,
merge them — do not add a third.

### 5b. The domain tier — how to add subject areas safely

The operator's instinct to add subject areas is right, but adding them to the *routable*
roster degrades classification for everyone. Add a `tier` field to `AgentProfile`:

```ts
tier: "core" | "coordinator" | "domain"   // default "core"
```

- **`core`** — offered to `classifyTask` and shown in the Auto path.
- **`coordinator`** — `coo`; see §5c.
- **`domain`** — **excluded from the classifier's choice set entirely.** Selectable only by
  an explicit `agentType` (the New Task role picker, §1b, lists them under a "Domain"
  group). Zero routing cost, zero classifier confusion.

`trader` becomes the first `domain` profile — this **preserves its 49 well-written prompt
lines** rather than deleting them, and it is referenced in `DECISIONS.md` as a live path.
Future subject areas (legal, annuity, medical, whatever) land here. A domain profile may
be promoted to `core` later if the stats screen (Spec 2 §3) shows it earning its keep.

`classifyTask` must therefore build its choice set from
`getAllAgentProfiles().filter(p => p.tier === "core")`, **not** all profiles
(`intent-classifier.ts` `VALID_TYPES`, and `keyword-classifier.ts`).

### 5c. `coo` is gated until Spec 3

COO's `create_task` is fire-and-forget: it dispatches and **can never read what came back**
(`tool-bridge.ts:490-503`). A coordinator that cannot observe outcomes cannot coordinate.
Until Spec 3 lands, `coo` is `tier: "coordinator"` — **excluded from the classifier**,
selectable only explicitly, and its prompt must state the limitation plainly ("you may
decompose and dispatch, but you will not see the outcomes; say so in your final message").
Spec 3 promotes it to routable.

### 5d. Deletion is safe (verified)

The five cut ids are referenced **only** in `agent-profiles.ts` and `keyword-classifier.ts`
— zero other non-test files. `getAgentProfile()` falls back to `developer` for any unknown
id (`agent-profiles.ts:430-440`). All 64 existing tasks are already `developer`. **No
migration, no backfill.** Still: keep a `LEGACY_PROFILE_ALIASES` map
(`cto→developer, ceo→founder, cfo→founder, analyst→researcher, inventor→founder`) so an
old `agentType` on a replayed/imported task resolves sensibly instead of silently becoming
`developer`.

### 5e. Rewrite the surviving thin prompts

Bring each to the bar set by `qa` / `designer`: a stated mandate, a numbered methodology,
explicit deliverables, and a "when to stop / escalate" clause. Target 25–45 lines.

**Rewrite:** `founder`, `researcher`, `marketing`, `coo`.
**Keep short on purpose:** `general` (12–15 lines — it is the no-tools fallback).
**Lightly extend:** `developer` (11 lines → ~25, add an explicit verification/handoff step),
preserving every existing rule verbatim.
**Do not touch:** `designer`, `qa`, `trader`. They are the reference quality bar.

**`coo`'s roster string is hard-coded** (`agent-profiles.ts:300-318`: *"Available agent
types: developer, researcher, …"*) and will rot the moment this spec lands. Generate it at
prompt-assembly time from the **core** roster in `generic-agent.ts:buildSystemPrompt`
(~`:121-193`).

## 6. The prompt wizard must stop assuming every task is code

**This section is load-bearing for Spec 1's success.** Without it, turning the classifier on
will appear to do nothing.

`src/lib/intake/enhance-prompt.ts` rewrites the operator's rough ask via local Qwen before
the task is created. Its `SYSTEM_PROMPT` (`:21-31`) hard-codes three coding assumptions:
*"a prompt wizard for a **coding-agent** task queue"*, *"that **a coding agent** can
execute"*, *"infer likely **file paths**"*. It runs on **every** task when
`promptWizardAlways` is on (it is, in the live config).

`acceptEnhancedPrompt()` then **replaces** `t_desc` with the rewritten text
(`console.ts` ~`:8030`), and that rewritten text is what `classifyTask` later reads. So the
wizard launders every prompt into coding-agent language *before* classification sees it.
Flip the flag with this unfixed and every task still routes to `developer` — for a reason
that has nothing to do with routing.

**Three changes:**

1. **De-bias.** Rewrite `SYSTEM_PROMPT` to be role-neutral. The output structure must not
   presume code: no "file paths", no build-shaped done-checklist by default.
2. **Suggest the role.** Return `agentType` in `EnhanceResult` alongside
   `title`/`enhanced`/`rationale`, constrained to the **core** roster ids, defaulting to
   `"auto"` on any doubt. The wizard has already parsed intent to write the objective —
   this costs nothing extra.
3. **Condition the rewrite on the chosen role.** Once a role is known, rewrite in that
   role's idiom: a `designer` task's done-checklist is annotated mockups and a prototype;
   a `qa` task's deliverable is a verification report; a `founder` task must not mention
   file paths. This is where output quality actually moves.

**UI.** The wizard's preview box (`console.ts:1773-1779`) already has editable `title` and
`enhanced` fields plus a `rationale` line. Add the **role select from §1b into that same
preview**, pre-filled with the suggestion — *they are the same control*. Classification
then happens **while the human is present to correct it**, instead of silently in a
scheduler tick five minutes later.

**Invariants.** The wizard *suggests*; it never decides. An explicit `agentType` always
wins (§1b). Every failure path — no local model, HTTP error, bad JSON, unknown role id —
returns `passthrough(raw)` with `agentType: "auto"` and **never blocks task creation**
(the existing `passthrough` contract at `enhance-prompt.ts:33-35`). `classifyTask` remains
the fallback for tasks born outside the console (voice, iOS, API).

A local Qwen choosing among seven roles will be imperfect. That is acceptable **precisely
because a human reviews it in the preview** — and it is the strongest argument for keeping
the core roster small.

---

## Files touched

| File | Change |
|---|---|
| `src/lib/config/features.ts:14-17` | register `agentSpecialization` in `KNOWN_FEATURES` |
| `src/lib/orchestrator/scheduler.ts:136-148,336-353` | use `isFeatureEnabled`; honor explicit `agentType`; profile-model precedence |
| `src/lib/config/agent-profiles.ts:6-14,20-393,410-418` | `modelRole?` + `tier` fields; cut 5 profiles; `trader`→domain; `LEGACY_PROFILE_ALIASES`; rewrite surviving thin prompts; COO roster de-hardcoded |
| `src/lib/orchestrator/intent-classifier.ts` | choice set = `tier === "core"` only; skip CLI when Claude disabled/absent; emit `roleProvenance` |
| `src/lib/orchestrator/keyword-classifier.ts` | drop keywords for cut ids; core-tier only |
| `src/lib/intake/enhance-prompt.ts:21-31` | **de-bias `SYSTEM_PROMPT`**; return `agentType`; role-conditioned rewrite; passthrough ⇒ `agentType:"auto"` |
| `src/lib/orchestrator/generic-agent.ts:121-193` | inject generated **core** roster line for `coo` |
| `src/daemon/server.ts` | `GET /agents/profiles` (incl. `tier`); accept + persist `agentType` on `POST /tasks`; `/tasks/enhance` returns `agentType` |
| `src/daemon/console.ts` (~`:1773-1779`, `:1683-1745`, `:2705`, `:8067`) | role select **inside the wizard preview**; Domain group in the picker; send `agentType`; role pill via `renderRolePills` seam |

## Build plan

**Phase 1 — Flag + explicit override (no classifier yet).**
Register the feature; replace the scheduler's `readFileSync` with `isFeatureEnabled`;
honor an explicit `agentType` even when the flag is off. Tests: flag off + explicit
`agentType:"qa"` ⇒ task runs as `qa`; flag off + `"auto"` ⇒ `developer`.
**Checkpoint:** `agentSpecialization` appears in `GET /settings/features`; a task POSTed
with `agentType:"designer"` records `designer`.

**Phase 2 — `modelRole` on profiles.**
Add the field, precedence chain, and built-in assignments. Tests: precedence truth table
(task.model wins; else profile; else role map; else default).
**Checkpoint:** a `founder` task resolves to the thinking model; `developer` unchanged.

**Phase 3 — Role picker + provenance pill.**
New Task select (default `Auto`); `GET /agents/profiles`; `roleProvenance` recorded; pill
rendered with `renderRolePills(task, [])`.
**Checkpoint (in-app):** create a task as `🎨 designer`; card shows the designer pill with
tooltip "you picked it".

**Phase 4 — Reduce the roster.**
Add `tier`; cut `ceo`/`cto`/`cfo`/`analyst`/`inventor`; move `trader` → `domain`; gate `coo`
→ `coordinator`; add `LEGACY_PROFILE_ALIASES`; restrict both classifiers' choice sets to
`tier === "core"`; Domain group in the role picker.
**Checkpoint:** `GET /agents/profiles` returns 7 core + 1 coordinator + 1 domain;
`classifyTask` can never return `trader` or `coo`; an imported task with `agentType:"cto"`
resolves to `developer` via the alias map, not the silent fallback.

**Phase 5 — De-bias the prompt wizard + role suggestion.**
Rewrite `SYSTEM_PROMPT` role-neutral; return `agentType`; role-conditioned rewrite; render
the role select **inside the wizard preview**.
**Checkpoint (the one that matters):** "write the launch blog post" no longer comes back as
a coding task with inferred file paths, and is suggested as `marketing`; "verify the
checkout flow" is suggested as `qa`; a local-model failure still passes through untouched
with `agentType:"auto"` and does not block Create.

**Phase 6 — Turn the classifier on.**
Harden `classifyTask` (skip CLI when Claude is disabled/missing); enable the flag; verify a
UI-ish prompt routes to `designer`, a test-ish prompt to `qa`, a code prompt to `developer`.
**Checkpoint:** with the flag on, ≥3 different `agentType` values appear across varied
prompts, each with `source:"classifier"` or `"keyword"`.

**Phase 7 — Rewrite the surviving thin prompts.**
`founder`, `researcher`, `marketing`, `coo`; lightly extend `developer`. One commit per
1–2 profiles. Prompt text only.
**Checkpoint:** every core profile ≥25 prompt lines except `general`;
`designer`/`qa`/`trader` byte-identical to before.

## Acceptance criteria

1. `agentSpecialization` is a first-class feature flag, toggleable in Settings → Features,
   read via `isFeatureEnabled` (no `readFileSync` of `config.json` in the scheduler).
2. An explicit `agentType` on a task is **always** honored, regardless of the flag.
3. With the flag on, `classifyTask` actually runs and produces ≥3 distinct roles across
   varied prompts; with it off, behavior is byte-identical to today (`developer`).
4. Classification never blocks the scheduler when the Claude CLI is absent or disabled.
5. `AgentProfile.modelRole` is honored with the documented precedence; `routeByRole` /
   `ModelRole` untouched.
6. Every completed task card shows exactly one role pill with a truthful source tooltip.
7. Core roster is exactly 7 (`general`, `developer`, `qa`, `designer`, `researcher`,
   `founder`, `marketing`); `coo` is `coordinator`; `trader` is `domain`. Neither classifier
   can ever return a non-`core` id. Surviving thin prompts ≥25 lines; `designer`, `qa`,
   `trader` byte-identical.
8. `GET /agents/profiles` never leaks `systemPrompt`, and exposes `tier`.
9. **The wizard is role-neutral.** A non-coding request ("write the launch blog post")
   produces a non-coding rewrite — no inferred file paths — and suggests a non-`developer`
   role. Every wizard failure path passes through with `agentType:"auto"` and never blocks
   Create.
10. The wizard *suggests*; the operator's explicit choice always wins.

## Guardrails

- **Fail closed.** Absent flag ⇒ off ⇒ `developer`. Never silently start routing tasks to
  new roles on upgrade.
- **Do not conflate the two "role" taxonomies.** `AgentProfile` (developer/qa/coo) and
  `ModelRole` (think/execute/code-critical) are different. Don't merge, don't rename.
- **Do not implement delegation, result read-back, or agent-to-agent messaging here.**
  That's Spec 3 and it needs a DECISIONS.md entry first.
- **Do not rewrite `designer`, `qa`, or `trader`.** They are the reference quality bar.
- **`create_task` stays fire-and-forget in this spec.** Do not add blocking or polling.
- **Do not re-add the cut roles**, and do not add new `core` roles. Subject areas go in the
  `domain` tier, which the classifier never sees. Every `core` role added costs accuracy
  for all the others.
- **The wizard must never tag *parts* of a prompt with different roles.** Per-part role
  tagging is preflight decomposition by a local model that has read no code — the exact
  failure DECISIONS.md Q15 (2026-07-06) removed. One suggested role for the whole task.
  Multi-role work is decomposed at **runtime** by the COO (Spec 3), never at typing time.
- **The wizard suggests, it never decides,** and it never blocks Create.
- Spec written against commit `1456319`. If the code has moved, stop and surface the delta.

## Out of scope

- The roles console screen (Spec 2).
- COO delegation / child-result read-back / `dependsOn` scheduling (Spec 3).
- Per-role personas or per-role memory (explicitly rejected: persona is one global identity
  for the Flash/voice surface; agents share skills, not souls).
- Removing the dead `taskIntakeModelDecomposition` flag — note it, don't chase it.
