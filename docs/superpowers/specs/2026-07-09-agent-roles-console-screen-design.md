# Agent Roles — Console Screen (Browse, Customize, Learn)

> **Spec 2 of 3.** Depends on Spec 1 (`2026-07-09-agent-roles-activation-design.md`),
> which registers the feature flag, adds `GET /agents/profiles`, and gives profiles a
> model. **Do not build this screen until Spec 1 lands** — a roster UI over a roster that
> can never run is a museum exhibit.
> Spec 3 (`2026-07-09-coo-delegation-result-readback-design.md`) is independent of this one.

## Context

The operator wants a **Roles screen, structured like the Brain / Memory Review screen**:
browse each role, see what it is, what tools and model it has, **what it has learned**, and
customize its personality/prompt.

Three-pane layout, directly mirroring `mockup-brain-review.html` and its spec
(`2026-07-09-brain-memory-review-console-design.md`) so the two screens read as siblings:

- **Left** — the role roster (built-in + custom), each with icon, name, and a task-count badge.
- **Center** — the selected role's dossier: identity, model, tool allowlist, prompt depth,
  **what it has learned** (skills), and **insight** (real usage statistics).
- **Right** — the system prompt, with a **Rendered / Raw** toggle, and an **Edit** mode that
  writes a custom profile override.

## 0. Verified facts (checked 2026-07-09 against commit `1456319`)

**The roster.** 14 built-ins in `src/lib/config/agent-profiles.ts:20-393`. `AgentProfile` =
`{ id, name, description, systemPrompt, tools[], loadClaudeMd, icon }` (`:6-14`) — plus
`modelRole?` after Spec 1.

**Customization already has a backing store.** `CUSTOM_PROFILES_DIR = ~/.hivematrix/agents/`
(`:16`). `loadCustomProfiles()` (`:402-428`) reads every `*.json`, requires `id` +
`systemPrompt`, fills defaults. Customs **override** built-ins by id (`getAgentProfile`
`:430-440`; `getAllAgentProfiles` merges `:442-449`). **Re-read on every call — no restart.**
The directory does not exist yet. Editing = write `<id>.json`; **reset to default = delete
the file.** No new persistent store is needed (this matters: the scope wall forbids new
stores without a DECISIONS.md entry — `scripts/scope-wall.mjs:91`).

**Usage statistics are real and available.** `tasks` table has `agentType TEXT DEFAULT 'auto'`
(`src/lib/db/index.ts:54`) and `status`. Live DB today: **64 tasks, 100% `developer`** — so
every other role's stats legitimately render as "never run." After Spec 1 this fills in.

**"What a role learned" does NOT exist today. This is the honest gap.**
- Skills live at `<brain>/skills/*.md`, written by `upsertSkill` (`src/lib/skills/store.ts:121-178`),
  refined in place by `markSkillUsed` (`:186-215`, appends `## Refinement (date)`).
- Skills are tagged by **harness compatibility** — `SkillHarness = "claude" | "codex" | "qwen" | "all"`
  (`src/lib/skills/contracts.ts:13-14`), via `compat: SkillHarness[]`. **There is no role
  attribution anywhere.**
- The **only** runtime skill author is **Flash chat distillation** (`src/lib/flash/distill.ts:328-341`),
  which runs a local model over cold *conversation* sessions (6h threshold,
  `src/lib/flash/learning-loop.ts`). Flash sessions have **no `agentType`** — they are the
  voice/chat lane, not task agents.
- ⇒ **No agent profile has ever authored a skill, and none can.** A "Learned" panel built
  today would be empty for all 14 roles, forever.

**The dead positive signal.** `whatWorked` is a real retrospective field
(`src/lib/orchestrator/directive-autonomy.ts:68`), parsed from model output (`:232`), and
then **never consumed by anything** (grep: parsed and stored only). Meanwhile `whatDidnt` and
`followUpDirectives` *are* reused → feedback backlog (`src/lib/feedback/self-improvement.ts:39-67`),
and `playbookDeltas` → brain playbooks (`directive-autonomy.ts:275-300`). The system learns
from failure and discards success.

**The safety line.** `src/lib/feedback/capability-gaps.ts:11-23` — "THE CLAWHAVOC LINE":
gaps are detected and filed as *proposals*; nothing is ever auto-acquired. Only `skill`
remedies are self-serviceable (`remedyIsSelfServiceable`, `:73-75`); lanes and packs stay
operator-gated. **This line is correct. Preserve it exactly.**

**Console conventions.** Screens are center-pane render modes, not routes. Nav buttons are
`ov-nav` in `.col.board` (`console.ts:1679-1682`); each `show*()` clears the other flags,
sets its own, and writes `innerHTML` into `#session`; `updateOverviewNav()` (`:1985-1992`)
syncs `.active`. Helpers `api(path,opts)` (`:1883`), `hmToast(msg,kind)` (`:1895`).
Settings tabs at `console.ts:1017`.

---

## Approved Approach

Build the screen in the Brain-screen mould, and be **honest about emptiness**: a role that
has never run shows "never run"; a role that has learned nothing shows "nothing learned yet"
with a link explaining why. Then close the learning loop so those panels stop being empty.

Ordering principle: **browse (real today) → customize (real today) → learn (needs new
plumbing)**. Phases 1–2 ship value immediately against existing data. Phases 3–4 build the
attribution and the loop that make "what they learned" true rather than decorative.

**Non-goal:** per-role personas / per-role `SOUL.md`. Persona is one global identity for the
conversational surface (`<brainRoot>/persona/`, read by `flash/context.ts`, never by task
agents). Agents are interchangeable workers that **share skills, not souls**. Fourteen
identity trees is a maintenance burden with no evidence of better output.

---

## 1. Screen shell

Add a **👥 Roles** nav button as an `ov-nav` in `.col.board` (`console.ts:1679-1682`), after
Chat. `showRoles()` mirrors `showFlashPanel` (`console.ts:6368-6379`): clear the other
panel/selection flags, set `_rolesState.panelOpen`, render `rolesPanelHtml()` into `#session`,
add the `.active` toggle in `updateOverviewNav()`.

Three-column grid (200px / 1fr / 1fr) scoped under `.oc-center-pane`, using **console CSS
variables** (never the Brain mockup's hardcoded hex). Reuse `hmToast` and the app's existing
confirm-modal pattern.

`_rolesState = { panelOpen, role, viewMode: "rendered"|"raw", editing: bool, draft: string|null }`.

## 2. Left pane — roster, grouped by tier

From `GET /agents/profiles` (Spec 1 §4), which returns `tier: "core" | "coordinator" | "domain"`.
Each row: `{icon} {name}`, a **task-count badge**, and a subtle `custom` chip when overridden.
Roles that have never run show a muted `0` badge — **do not hide them; that emptiness is the
point.**

Three group headers, mirroring Spec 1 §5:

- **Core** (7) — `general`, `developer`, `qa`, `designer`, `researcher`, `founder`,
  `marketing`. These are what the classifier may choose. Sub-caption: *"Auto-routed."*
- **Coordinator** (1) — `coo`. Sub-caption: *"Explicit only until delegation ships."*
  (Spec 3 promotes it.)
- **Domain** (n) — `trader`, plus any subject areas the operator adds. Sub-caption:
  *"Explicit only — never auto-routed, so adding these costs no routing accuracy."*

A **"+ Add domain profile"** button sits under the Domain group. It creates a new custom
profile with `tier: "domain"` (§4 editor). This is the sanctioned, safe way to add subject
areas: they never enter the classifier's decision surface. **The UI must not offer to create
a `core` profile** — widening the core roster degrades routing for every other role, and is
a deliberate, reviewed decision, not a button.

A customized built-in shows the `custom` chip and a **Reset to default** affordance, in place
(do not move it to a separate group).

## 3. Center pane — the role dossier

Four blocks:

**Identity** — icon, name, description, `custom`/`built-in` provenance.

**Configuration** — resolved model (`modelRole` → concrete id via the same resolution
Settings → Models uses; show both, e.g. *"thinking → Claude Opus"*), `loadClaudeMd`
yes/no, and the **tool allowlist** as chips. An empty allowlist renders explicitly as
*"No tools — conversational only"* (that's `general`).

**Insight** (real data, from `GET /agents/profiles/:id/stats`):
- tasks run (all-time), split by status (review / archived / failed / cancelled)
- success rate = archived ÷ (archived + failed), shown only when ≥5 runs, else "not enough data"
- last run (relative), median wall-clock duration
- for `core` roles, the **routing-source split** from `output.roleProvenance`
  (explicit / classifier / keyword / default) — this is how the operator learns whether the
  classifier is actually working, or whether everything is still falling through to default
- **Never run** ⇒ a single honest line: *"This role has never run. Enable Specialist agents
  in Settings → Features, or pick it explicitly on a new task."* with a deep link.

This panel is the **promotion/demotion evidence**. A `domain` profile that the operator keeps
picking by hand, with a good success rate, is a candidate to promote to `core`. A `core` role
that is never chosen, or is chosen and fails, is a candidate to cut. **Do not add or promote a
role on instinct — use this data.**

**Learned** (from `GET /agents/profiles/:id/skills`) — the skills attributed to this role
(§5). Each: name, description, `useCount`, `revisions`, last-refined date, trusted/untrusted
chip. Clicking opens the skill in the render pane.
- **Empty state must tell the truth:** *"No skills learned yet. Roles begin authoring skills
  once retrospection is wired (see Phase 4)."* — not a bare "None."

## 4. Right pane — prompt viewer & editor

- **Rendered / Raw** toggle, exactly like the Brain screen. Rendered = markdown; Raw =
  `textContent` in a monospace block. Prompt comes from `GET /agents/profiles/:id`.
- **Edit** button → textarea seeded with the current prompt. **Save** writes a custom
  override; **Reset to default** deletes it (with confirm).
- Show `promptLines` and a quality hint: fewer than 20 lines ⇒ a muted note *"Thin prompt —
  the best profiles (designer 58, trader 49, qa 45 lines) state a mandate, a numbered
  method, deliverables, and a stop condition."*
- Editing writes **only** `~/.hivematrix/agents/<id>.json`. Since `loadCustomProfiles` re-reads
  on every call, the change is live on the next task with **no restart** — say so in a toast.

## 5. Skill → role attribution (net-new)

Add an optional `roles: string[]` to the skill frontmatter, parsed alongside `compat`
(`src/lib/skills/contracts.ts`). Semantics, mirroring `skillRunsOn` (`:98-99`):

- absent / empty / `["all"]` ⇒ available to **every** role (today's behavior for every
  existing skill — so this is backward compatible by construction)
- otherwise ⇒ the skill was authored by, and is surfaced under, those role ids

`GET /agents/profiles/:id/skills` returns skills whose `roles` includes `:id`. The screen's
Learned panel shows **authored-by-this-role** skills. (Do **not** also list the hundreds of
`all`-scoped skills there — that would drown the signal. Show a count: *"+ N shared skills
available to every role."*)

`roles` is **additive metadata only**. It must not affect which skills an agent may *use* —
tool/skill availability stays governed by `compat` (harness) and the profile's tool allowlist.

## 6. Close the learning loop — make "Learned" non-empty

Today only Flash chat authors skills. Give **task agents** the same ability, sourced from
the positive signal the system already computes and throws away.

**`whatWorked` → skill proposal.** In `directive-autonomy.ts` where retrospectives are
parsed (`:232`), pass `whatWorked` into a new `src/lib/skills/from-retrospective.ts`:

- Distil each `whatWorked` item into a candidate skill (name, description, body) using the
  **local model**, reusing the prompt shape of `flash/distill.ts:buildDistillPrompt` (`:91-134`).
- Write via the existing `upsertSkill` (`store.ts:121-178`) with
  `source: "retrospective:<taskId>"`, `roles: [<task.agentType>]`, and — critically —
  **`trusted: false`**.
- Untrusted skills already land in the review path used by URL import (`console.ts:1491-1492`).
  The operator reviews and trusts. **Nothing is auto-installed.**

**This preserves THE CLAWHAVOC LINE.** A skill is a *markdown procedure*, the one remedy
class already marked self-serviceable (`capability-gaps.ts:73-75`). Lanes and packs remain
operator-gated. Do not widen that.

Requires `agentType` to be readable from the task at retrospection time — it is (`db/index.ts:54`).

## 7. Endpoints

| Route | Purpose |
|---|---|
| `GET /agents/profiles` | roster (Spec 1) — no `systemPrompt` |
| `GET /agents/profiles/:id` | full profile **incl.** `systemPrompt`, `isCustom` |
| `PUT /agents/profiles/:id` | write `~/.hivematrix/agents/<id>.json`; validate `id` + non-empty `systemPrompt`; **reject unknown tool names** against the tool registry |
| `DELETE /agents/profiles/:id` | delete the custom override → revert to built-in; 404 if not custom |
| `GET /agents/profiles/:id/stats` | task counts by status, success rate, last run, median duration |
| `GET /agents/profiles/:id/skills` | skills whose frontmatter `roles` includes `:id`, + count of shared skills |

All behind the existing bearer auth. `PUT`/`DELETE` broadcast `agents:changed` so an open
screen re-renders. **Path-guard `:id`** — it becomes a filename; allow `^[a-z][a-z0-9_-]*$`
only, reject anything else (this route writes a file named from user input).

---

## Files touched

| File | Change |
|---|---|
| `src/lib/config/agent-profiles.ts` | `writeCustomProfile()`, `deleteCustomProfile()`, id validation |
| `src/lib/skills/contracts.ts` | optional `roles: string[]` in frontmatter + parse/render |
| `src/lib/skills/store.ts` | persist/read `roles`; filter helper `skillsForRole(id)` |
| `src/lib/skills/from-retrospective.ts` (new) | `whatWorked` → untrusted skill via `upsertSkill` |
| `src/lib/orchestrator/directive-autonomy.ts:232` | pass `whatWorked` + `agentType` into the above |
| `src/lib/orchestrator/role-stats.ts` (new) | task aggregates per `agentType` |
| `src/daemon/server.ts` | the six routes above; `agents:changed` broadcast |
| `src/daemon/console.ts` | `👥 Roles` nav, `showRoles()`, `rolesPanelHtml()`, three panes, editor, `agents:changed` handler |

## Build plan

**Phase 1 — Read-only roster + dossier (real data).**
Nav button, three panes, `GET /agents/profiles/:id`, `/stats`. Rendered/Raw prompt toggle.
Honest "never run" empty states.
**Checkpoint (in-app):** screen lists 14 roles; `developer` shows 64 tasks; the other 13 show
"never run"; clicking `designer` renders its 58-line prompt.

**Phase 2 — Customize.**
`PUT`/`DELETE`, edit mode, reset-to-default confirm, id path-guard, tool-name validation.
**Checkpoint:** edit `founder`'s prompt → `~/.hivematrix/agents/founder.json` appears → next
task using `founder` picks it up with **no restart**; Reset deletes the file and the built-in
returns.

**Phase 3 — Skill role attribution.**
`roles` frontmatter (absent ⇒ all-roles, proving backward compat on existing skills);
`skillsForRole`; `GET /agents/profiles/:id/skills`; Learned panel with truthful empty state.
**Checkpoint:** every pre-existing skill still resolves to every role; a hand-tagged
`roles: ["qa"]` skill appears only under QA.

**Phase 4 — Close the loop (`whatWorked` → untrusted skill).**
`from-retrospective.ts`; wire into `directive-autonomy.ts:232`; attribute `roles:[agentType]`;
`trusted:false`.
**Checkpoint:** a completed directive with a non-empty `whatWorked` produces an **untrusted**
skill attributed to the running role; it surfaces in that role's Learned panel with an
"untrusted — review" chip; **nothing is auto-trusted or auto-installed.**

## Acceptance criteria

1. A `👥 Roles` screen in the console, three-pane, themed with app CSS variables, sibling to
   the Brain screen.
2. Every role's dossier shows identity, resolved model, tool allowlist, prompt (rendered+raw),
   real usage stats, and learned skills.
3. Empty states tell the truth: "never run" and "no skills learned yet — here's why."
4. Editing a prompt writes only `~/.hivematrix/agents/<id>.json`; it takes effect on the next
   task **without a daemon restart**; Reset deletes it and restores the built-in.
5. `roles` frontmatter is additive and backward compatible — every existing skill remains
   available to every role, and `roles` never gates skill *usage*.
6. `whatWorked` produces skills attributed to the authoring role, always `trusted: false`.
7. **No capability is ever auto-acquired.** Lanes and packs remain operator-gated
   (THE CLAWHAVOC LINE holds).
8. No new persistent store is introduced (custom profiles = JSON files; skills = existing
   brain markdown).

## Guardrails

- **Path-guard the profile id.** `PUT /agents/profiles/:id` writes a file named from user
  input — allow `^[a-z][a-z0-9_-]*$`, reject `..`, slashes, absolute paths.
- **New profiles are `domain`-tier only.** The "+ Add" button must not be able to mint a
  `core` role. Promoting `domain` → `core` is a code change with review, justified by the
  stats panel — never a UI toggle. Every added `core` role costs classification accuracy for
  all the others.
- **Validate tool names** on save against the real tool registry; a typo'd tool must fail
  loudly at save, not silently disarm the agent at runtime.
- **Never auto-trust a generated skill.** `trusted: false`, always. Preserve
  `capability-gaps.ts` semantics verbatim; do not widen `remedyIsSelfServiceable`.
- **Do not add per-role personas / `SOUL.md`.** Persona stays one global identity for the
  Flash/voice surface. Agents share skills.
- **`roles` is metadata, not a gate.** Skill availability is `compat` (harness) + the
  profile's tool allowlist. Do not let `roles` restrict what an agent may run.
- **No new persistent store** — the scope wall (`scripts/scope-wall.mjs:91`) forbids it
  without a DECISIONS.md entry.
- **Do not show a "roles involved" plural pill here** — a task has one `agentType` until
  Spec 3 lands.
- Spec written against commit `1456319`. If the code has moved, stop and surface the delta.

## Out of scope

- COO delegation, child-result read-back, `dependsOn` scheduling (Spec 3).
- Per-role memory, per-role `SOUL.md`, per-role API keys (the Hermes multi-profile model —
  explicitly rejected).
- Auto-installing lanes/packs from detected capability gaps.
- Skill *editing* in this screen (view only; skills are edited in the brain tree).
