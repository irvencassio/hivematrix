# COO Delegation with Result Read-Back

> **Spec 3 of 3.** Depends on Spec 1 (`2026-07-09-agent-roles-activation-design.md`).
> Independent of Spec 2.
>
> ## ⛔ BLOCKED until a DECISIONS.md entry lands
> This spec **partially reopens DECISIONS.md Q15** (2026-07-06), which deleted the
> decomposition-and-DAG subsystem. It must not be implemented until a **Q16 entry** is
> written and merged, stating what is and is not being reinstated (§1). An implementer who
> finds no Q16 entry must **stop and say so**, not proceed.

## Context

HiveMatrix has a `coo` agent profile whose whole purpose is to decompose a goal and delegate
to specialists. It has a `create_task` tool. It works — and then the COO **never learns what
happened.** `executeCreateTask` (`src/lib/orchestrator/tool-bridge.ts:441-508`) POSTs the
subtask and returns the new id immediately. The parent agent's loop finishes and the process
exits (`generic-agent.ts:882-928`). It never reads a child's output. Nothing aggregates child
results anywhere.

So today the COO is a fire-and-forget dispatcher that cannot synthesize. That single missing
primitive — **a parent reading its children's results** — is the entire distance between what
exists and "the COO manages the direction."

This spec adds exactly that primitive, with the smallest possible surface, and **explicitly
refuses** to rebuild the subsystem Q15 removed.

## 0. Verified facts (checked 2026-07-09 against commit `1456319`)

**What exists.**
- `create_task` tool: definition `tool-bridge.ts:160-185` (params `description`, `agentType`
  ∈ `AGENT_PROFILE_IDS`, optional `project`); impl `executeCreateTask` `:441-508`.
- **Depth cap = 2** (`:458-472`): if the parent itself has a `parentTaskId`, reject —
  *"A subtask cannot create subtasks."* **Sibling cap = 10** (`MAX_SUBTASKS_PER_PARENT`,
  `:439`; enforced `:474-487`). Both **fail open** if the internal HTTP check errors.
- Context wired at `generic-agent.ts:860-865` (`ToolContext{ parentTaskId, currentAgentType }`).
- `parentTaskId` is a real column (`src/lib/db/index.ts:42,521,783,1073`; `types.ts:87`) and
  is queryable (`/tasks?parentTaskId=…`).
- **`dependsOn: string[]` already exists** as a column (`db/index.ts:50,793,818,831,1083`;
  `types.ts:90`), and a complete, tested pure DAG module exists at
  `src/lib/orchestrator/dag-engine.ts` (Kahn cycle check `validateDag`).
  **It has zero non-test importers.** The scheduler claims
  `{status:"backlog", executor:"agent"}` ordered by `position` (`scheduler.ts:282,328`) and
  **never consults `dependsOn`**.

**What does not exist.** No agent→agent messaging, blackboard, shared scratchpad, handoff, or
child-result aggregation. Grep confirms the only "reply" path is
`POST /tasks/:id/reply` (`server.ts:4073-4113`) — **human → task**, for tasks parked in
`reviewState: "needs_input"`, resolved via `appendReplyContinuation` / `resolveStuck`.
**That continuation mechanism is the thing to reuse** (§3).

**The deadlock trap.** The scheduler fills **all available slots per tick**
(`scheduler.ts:320-438`), default **4 slots** (`:49`). A COO that *blocks* while waiting for
children would hold a slot. Four concurrent COOs ⇒ all 4 slots held by waiters ⇒ **no child
can ever be claimed** ⇒ permanent deadlock. **Blocking or polling-in-process is forbidden.**

**Two orthogonal delegation axes (do not conflate).**
- `create_task(agentType, …)` → spawn a **specialist role** (developer, qa, designer…).
- The **COO dispatcher** `src/lib/coo/` → route a request to a **lane** (browser, terminal,
  mail…). `routing-rules.ts:124-133` `rejectPromptLikeKeys` *forbids* prompt text in rules —
  it is deliberately typed. `dispatch.ts:121-150` `LANE_DISPATCH_POLICY`: `browser` and
  `terminal` are **executable**; `mail`/`message`/`desktop` are **approval_required**;
  `memory`/`review` are **`unsupported`** ("has no COO execution bridge yet", `:143-149`).

These are different axes — "which worker" vs "which capability." The COO needs both. Today it
has only the first, which is why (per `DECISIONS.md:641`) *"'send an email' reaches no Bee —
the agent improvises with bash/osascript."*

**Q15 (`DECISIONS.md:1206`)** deleted `src/lib/work-packages/`, the `work_packages` /
`work_package_items` / `flight_loops` tables, the Flight-loop scheduler, `/work-packages/*`
routes, the Task Intake classifier (`classify.ts`), model-advised `decompose.ts`, and the
Flights UI — because a **preflight splitter never had full code context**, and a single
self-planning task beat it. The **scope wall enforces this**
(`scripts/scope-wall.mjs`: Flights/Work-Package brand; removed task columns
`missionId`/`missionPhase`/`goalAncestry`/`scheduledTaskId`; new persistent store without a
DECISIONS entry).

---

## 1. The DECISIONS.md Q16 entry (write this FIRST)

Nothing in this spec may be implemented until `DECISIONS.md` gains a Q16 entry saying, in
substance:

> **Reinstated:** runtime delegation *result read-back* — a parent task may read the outputs of
> its own completed children, and the scheduler honors the pre-existing `dependsOn` column for
> ordering. Both use columns and a DAG module that **already exist** (`parentTaskId`,
> `dependsOn`, `dag-engine.ts`). **No new persistent store is created.**
>
> **NOT reinstated:** preflight decomposition. There is no task-intake classifier, no
> `decompose.ts`, no `work_packages`/`work_package_items`/`flight_loops` tables, no Flights UI,
> no Flight-loop scheduler, and no Work Package brand. Broad prompts still self-plan as a single
> `workflow:"work"` task via Superpowers.
>
> **Why this is not Q15 returning:** Q15 removed *decomposition by a classifier that had never
> read the code*. This adds *synthesis by an agent that has already done the work* — the COO
> decomposes at runtime with tools in hand, and the only new capability is reading back what its
> children produced. The failure mode Q15 cited (planning without context) is not reintroduced.

If that reasoning does not hold up on review, **this spec should be abandoned, not softened.**

## 2. Approved Approach

Add one primitive — **a parent reads its children's results** — via a **continuation**, never
a block. Wire the dormant `dependsOn` for ordering. Give the COO both delegation verbs. Keep
every existing cap.

Explicitly: **no group chat, no free-form agent conversation, no message bus.** If the COO
needs an answer from the developer, that is a subtask with a result — not a dialogue. Free-form
inter-agent chat multiplies token cost, invites loops, and blows the context budget (Hermes
literally refuses to boot when its 62-tool prompt exceeds a model's context). Bounded, one-hop,
structured delegation only.

---

## 3. Result read-back via continuation (never blocking)

**The lifecycle.** A coordinator task that has spawned children:

1. COO agent calls `create_task` N times (existing caps apply), then **ends its turn normally**
   with a `delegated` marker in its output. It does **not** wait. Its slot is released.
2. The task moves to a new terminal-ish state **`waiting_children`** (a `reviewState` value,
   *not* a new status column — reuse the existing `reviewState` string field the way
   `needs_input` does). It is **not claimable** by the scheduler.
3. A **reaper** (a small pass in the existing scheduler tick, not a new loop) finds tasks in
   `waiting_children` whose every child (`/tasks?parentTaskId=…`) has reached a terminal status
   (`archived` | `failed` | `cancelled`).
4. For each, it appends a structured **children-results block** to the parent's continuation
   input and returns the parent to `backlog` — **reusing `appendReplyContinuation`**
   (`server.ts:4073-4113`), the exact mechanism a human reply already uses.
5. The scheduler claims the parent again. The COO now sees its children's outputs in context and
   synthesizes. This is its second and final turn.

**Why this shape:** it adds no new scheduler loop, no new table, no blocking, and it reuses a
continuation path that is already proven in production for human replies.

**The children-results block** (appended as a system/user message, bounded):
```
## Results from delegated subtasks
### [qa] Verify checkout flow — archived
<first 2000 chars of child output.summary or last log>
### [designer] Landing page mock — failed
<failure reason>
```
Cap: **2000 chars per child, 10 children** ⇒ ~20k chars worst case. If a child's output exceeds
the cap, truncate with a marker and include its task id so the COO can decide to look further.

**Guards.**
- **A parent may resume at most once.** Record `output.continuations = 1`; a second attempt is
  refused. This is the single most important anti-loop guard — without it a COO can re-delegate
  forever.
- **Depth cap 2 already prevents grandchildren** (`tool-bridge.ts:458-472`). Keep it. A child
  therefore never enters `waiting_children`.
- **Timeout:** a parent in `waiting_children` for > 24h is force-resumed with whatever children
  finished, the rest marked "did not complete." Never strand a task.
- **Fail-open caps become fail-closed.** `executeCreateTask`'s depth/sibling checks currently
  *fail open* when the internal HTTP check errors (`:458-487`). With read-back in play, a failed
  check must **fail closed** (reject the `create_task`), or a network blip lets a COO exceed its
  caps.

## 4. Wire `dependsOn` (minimal ordering)

The scheduler's claim query (`scheduler.ts:282,328`) gains one clause: **skip any task whose
`dependsOn` contains an id that is not yet terminal.** That is the whole change. Use
`dag-engine.ts`'s `validateDag` at `create_task` time to reject a cycle.

Do **not** build a DAG executor, a graph UI, or dependency inference. `dependsOn` is set only
when the COO explicitly passes it to `create_task` (new optional param `dependsOn?: string[]`,
restricted to ids of its own siblings).

## 5. Give the COO both delegation verbs

- **Role delegation** — `create_task(agentType, description, dependsOn?)`, as today plus ordering.
- **Lane delegation** — a new `dispatch_capability(request)` tool that calls the **existing typed
  dispatcher**: `resolveCooRoute()` (`routing-rules.ts:186`) → `dispatchCooRequest()`
  (`dispatch.ts:237`). This gives delegation the risk tiers, approval gates, and backend policy
  that raw `create_task` bypasses. It must honor `LANE_DISPATCH_POLICY` exactly: `browser`/
  `terminal` execute; `mail`/`message`/`desktop` return an **approval envelope** the COO surfaces
  to the operator (it must **not** auto-approve); `memory`/`review` return `unsupported` and the
  COO must say so plainly rather than improvising with `bash`.

Update the `coo` profile (`agent-profiles.ts:300-318`): generate the roster line from the
**core** roster — `getAllAgentProfiles().filter(p => p.tier === "core")`, per Spec 1 §5b —
so the COO delegates only to auto-routable specialists and never to a `domain` profile it
was not told about. Document both verbs, state the caps (≤10 subtasks, one synthesis pass,
no grandchildren), and require a final synthesis that cites each child by id.

**Promote `coo` from `tier:"coordinator"` to `tier:"core"`** as the last step of this spec —
it becomes classifier-routable only once it can actually observe outcomes (Spec 1 §5c gated
it precisely until now).

Grant `coo` the tools: `create_task`, `dispatch_capability`, `read_file`, `bash`. **Not**
`write_file`/`edit_file` — a coordinator that edits code is a developer wearing a hat.

## 6. Plural role pills on the task card

Spec 1 left a `renderRolePills(task, childTasks)` seam. Fill it: a coordinator task's card shows
its own role pill plus one pill per distinct child `agentType`, each linking to the child task.
This is the operator's requested *"which roles were involved with helping on that task."*

Source: `/tasks?parentTaskId=<id>`. For a task with no children, unchanged (one pill).

---

## Files touched

| File | Change |
|---|---|
| `DECISIONS.md` | **Q16 entry (prerequisite)** |
| `src/lib/orchestrator/tool-bridge.ts:439-508` | `dependsOn?` param; caps **fail closed**; cycle check |
| `src/lib/orchestrator/tool-bridge.ts` (new tool) | `dispatch_capability` → `resolveCooRoute`/`dispatchCooRequest` |
| `src/lib/orchestrator/scheduler.ts:282,328` | skip tasks with unmet `dependsOn`; `waiting_children` reaper pass |
| `src/lib/orchestrator/children-results.ts` (new) | build the bounded results block |
| `src/daemon/server.ts:4073-4113` | reuse `appendReplyContinuation` for child results; `continuations` guard |
| `src/lib/config/agent-profiles.ts:300-318` | COO prompt: two verbs, caps, synthesis requirement; tool set |
| `src/daemon/console.ts` | plural role pills; `waiting_children` board state |

## Build plan

**Phase 0 — Write and merge the Q16 DECISIONS.md entry.** No code. If review rejects the
reasoning, stop here.

**Phase 1 — Harden the existing caps.** Make depth/sibling checks **fail closed**; add
`validateDag` cycle rejection. Tests: HTTP-check failure ⇒ `create_task` rejected, not allowed.
**Checkpoint:** no behavior change for happy paths; caps hold under induced failure.

**Phase 2 — `dependsOn` in the claim query.** One clause + tests (a task with an unmet dep is
never claimed; becomes claimable when the dep terminates).
**Checkpoint:** two tasks, B depends on A ⇒ B never runs before A terminates.

**Phase 3 — `waiting_children` + continuation read-back.**
`reviewState:"waiting_children"`, reaper in the scheduler tick, `children-results.ts`, reuse
`appendReplyContinuation`, `continuations = 1` guard, 24h force-resume.
**Checkpoint (the money test):** a COO task spawns 2 children; the COO's slot is released while
they run; when both terminate, the COO resumes **exactly once** with both outputs in context and
writes a synthesis. **Assert no deadlock with `slots = 1`.**

**Phase 4 — `dispatch_capability` + COO prompt.**
Wire the typed dispatcher as a tool; rewrite the COO prompt; adjust its tool set.
**Checkpoint:** COO asked to "email the investor update" returns an **approval envelope**, never
runs `osascript`; asked to "check memory lane" reports `unsupported` honestly.

**Phase 5 — Plural role pills.**
**Checkpoint:** a coordinator task's card shows `🧭 COO` + `🎨 Designer` + `🔍 QA`, each linking
to the child.

## Acceptance criteria

1. A Q16 DECISIONS.md entry exists and precisely scopes what is/isn't reinstated.
2. A parent task **never blocks a scheduler slot** while children run. Verified with `slots = 1`.
3. A coordinator resumes **at most once**, with a bounded (≤2000 chars × ≤10 children) results
   block, and produces a synthesis citing each child.
4. Depth ≤ 2 and ≤ 10 siblings hold **even when the internal check errors** (fail closed).
5. A `waiting_children` task older than 24h is force-resumed, never stranded.
6. `dependsOn` is honored by the scheduler; cycles are rejected at `create_task`.
7. `dispatch_capability` honors `LANE_DISPATCH_POLICY` verbatim — never auto-approves
   mail/message/desktop; reports `memory`/`review` as unsupported.
8. Completed coordinator cards show every role involved.
9. **No new tables. No new persistent store.** `parentTaskId`, `dependsOn`, `reviewState` all
   pre-exist. `npm run scope-wall` passes.

## Guardrails

- **Never block, never poll in-process.** The 4-slot scheduler deadlocks if a parent waits.
  Continuation only.
- **One resume per parent.** This is the anti-runaway guard. Enforce it before anything else.
- **Do not build group chat, a message bus, a blackboard, or free-form agent dialogue.**
  Bounded one-hop delegation with structured results. If the COO needs an answer, that's a
  subtask.
- **Do not resurrect Q15.** No `work_packages` tables, no `decompose.ts`, no intake classifier,
  no Flights UI/brand, no `missionId`/`goalAncestry` columns. The scope wall will catch you;
  do not "work around" it.
- **Do not let the COO auto-approve.** Approval envelopes go to the operator.
- **Do not give the COO write/edit tools.**
- **Truncate child outputs.** An un-capped results block will blow the context window — the
  Hermes failure mode.
- Spec written against commit `1456319`. If the code has moved, stop and surface the delta.

## Out of scope

- Agent-to-agent messaging, group chat, shared scratchpad, A2A protocol.
- Grandchildren / arbitrary-depth hierarchies (depth cap 2 stands).
- Automatic `dependsOn` inference — the COO sets it explicitly or not at all.
- A DAG visualization UI.
- Building a COO execution bridge for the `memory`/`review` lanes (they stay `unsupported`;
  report honestly).
