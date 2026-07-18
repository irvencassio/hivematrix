# Task Reply Panel Shows No Choice Buttons — Design

## Problem

When a task is awaiting operator input, the per-task detail panel (`taskActionsHtml()`,
`src/daemon/console.ts:2616`) renders exactly one textarea + one "Reply" button — never
any clickable choice buttons — regardless of whether the question behind it actually had
predefined options. The operator has to read the question text and type a guess at the
expected answer (e.g. "retry", "Implement") instead of clicking it.

Traced two distinct backend sources that carry structured options today, and confirmed
each is dropped or stranded before it reaches that panel:

1. **`AskUserQuestion` (agent-asked, e.g. "Implement / Defer / Skip").** `turn-builder.ts`'s
   `parseAskUserQuestion()` (line 99) correctly parses `options` off the tool call into
   `QuestionContent.options`. `derive-output.ts`'s `deriveOutput()` correctly preserves
   `options` on each entry in `view.questions[]` (line 63-64) and even pre-computes a
   `resultStatus` classification (`needs_confirmation` for 2 options, `needs_selection`
   for >2, `constants.ts:100-107`) — infrastructure that was clearly built to distinguish
   these cases. But when it builds `view.headline` — the one summary object
   `agent-manager.ts` actually reads — it copies only `.text` (derive-output.ts:147-160),
   never `.options`. `agent-manager.ts`'s exit handler (line ~704-768) then flattens that
   into a plain string, `` `❓ Awaiting your reply:\n\n${view.headline.text}` ``, and
   persists only that string into `task.output.summary` (line ~785-790). The options
   array — computed twice over, never wrong — is thrown away before it's ever written
   anywhere the UI can read it. **This is a pure bug: data computed, then discarded.**

2. **"Stuck" watchdog nudges (e.g. retry / skip / abort).** `stuck.ts`'s `raiseStuck()`
   already carries an `options: string[]` array end to end, and it's **already rendered
   as real clickable buttons** — just not in this panel. `buildApprovalQueue()`
   (`src/lib/approvals/queue.ts:50-57`) forwards `StuckRequest.options` into the global
   "Approvals" dock (`renderApprovals()`, console.ts ~5646-5651, using the existing
   `.appr-btn` button family, console.ts:209-221), which the phone/dashboard already
   consume correctly. But the per-task panel this bug report is about only ever sees
   `row.pendingQuestion = latest.reason` (server.ts:4276) — the *text* of the reason, with
   `latest.options` left off the row entirely. An operator looking at the task itself (not
   the separate Approvals dock) still only sees a bare textarea.

Net effect: no matter which of the two mechanisms is asking, the task detail view itself
never shows buttons. Confirmed (via a full-file audit) that `taskActionsHtml`/`selectTask`
never read any options/choices array off `t` or `t.output`, and no CSS class scoped to the
reply section renders a button row — the only precedent (`.appr-btn`) lives entirely
inside the separate Approvals dock. Also confirmed this repo's console (served over
`http://127.0.0.1:3747/console`, loaded verbatim by the Tauri shell's `ui/index.html`) is
the only operator-facing UI in this repo — no separate iOS surface lives here.

## Options considered

1. **Fold AskUserQuestion answers into the existing Approvals dock, since it already
   renders option buttons correctly.** Rejected as the primary fix. The Approvals dock
   resolves everything through `resolveStuck()`'s decision-file protocol; an
   `AskUserQuestion` answer instead needs to become continuation text appended to the
   task's `description` via `appendReplyContinuation` so the *same task* resumes with the
   answer in hand (`server.ts`'s `/tasks/:id/reply`, no-pending-stuck branch, line
   4600-4626). Routing it through the Approvals dock would mean that dock growing a
   second, different resolution mechanism — more moving parts, not fewer (this is the
   same shape of non-unification Q14 already flagged: "different decisions — collapsing
   them would ADD complexity"). It would also still require operators to leave the task
   they're looking at to answer it. A follow-up idea worth keeping (not actioned here):
   also surface a *compact entry* for AskUserQuestion tasks in the Approvals dock for a
   global view, additive to the fix below rather than instead of it.

2. **New DB column (`pendingOptions`) + a new `/tasks/:id/choices` endpoint.** Rejected.
   `output` is already the sanctioned flexible JSON store for exactly this kind of
   per-task derived data (`db/index.ts`'s `output TEXT DEFAULT '{}'`, JSON-parsed on read,
   stringified on write) — a new column is a new persistent store, which per Q14's
   scope-wall tripwire requires its own DECISIONS.md entry naming what it replaces, for a
   problem that doesn't need one. A new endpoint would also just duplicate what
   `/tasks/:id/reply` already does (append continuation text / resolve the stuck file) —
   the "selection" is just specific text being submitted through the existing pipe.

3. **Thread `options` through the existing `output` blob and the existing
   `pendingQuestion`-style runtime-attached row field; render buttons client-side in the
   existing reply section; clicking a button submits through the existing `replyTask()`
   pipeline.** **Chosen.** No schema change, no new endpoint, no new concept — purely
   completes wiring that was already half-built on both the AskUserQuestion side (the
   data already flows as far as `view.headline`) and the stuck side (the data already
   flows as far as `getPendingStuck()`). Naming mirrors the existing `pendingQuestion`
   convention (`pendingOptions`) and the existing `ApprovalQueueItem.options` convention
   (`queue.ts:23`), so it reads as "the same kind of thing" wherever it shows up.

## Design

**Data plumbing (two independent sources, one client-side field):**

- `turn-types.ts`: `OutputView.headline` gains `options?: string[]`.
- `derive-output.ts`: both places that build `view.headline` from a `"question"`-kind
  turn (derive-output.ts:147-153) also copy `options: latestQuestion.content.options`.
  Pure-function change, directly unit-testable.
- `agent-manager.ts`: at both places that construct the persisted `output` object on task
  exit (the success path ~line 785 and the failure/legacy-fallback path), when
  `view.headline?.options` is present, include it as `output.pendingOptions`. This rides
  along in the same JSON blob as `summary` — no separate write, no new column.
- `server.ts`'s GET `/tasks/:id` (line ~4270-4277): alongside the existing
  `row.pendingQuestion = latest.reason`, also attach
  `row.pendingOptions = latest.options?.length ? latest.options : null` from the same
  `StuckRequest` — `latest.options` already exists there today and was simply never
  copied over.

**Rendering (`src/daemon/console.ts`):**

- `taskActionsHtml(t)` → `taskActionsHtml(t, out)`, matching the sibling calls right next
  to it at the one call site (`taskProvenancePills(t, out, ...)`, `taskTelemetryStrip(t,
  out)`, `selectTask()` line 2712-2715) — `out` is already parsed there, so this avoids a
  second `JSON.parse` rather than adding one.
- Compute one unified list: the stuck-sourced `t.pendingOptions` if present, else the
  AskUserQuestion-sourced `out.pendingOptions`. These two sources are not expected to be
  simultaneously present for one task (each represents a different reason `reviewState`
  became `needs_input`), so a simple precedence, not a merge, is correct.
- When that list is non-empty, render a row of buttons directly under the existing
  question text (the `q` div, console.ts:2651) and above the existing textarea, in both
  the standout (`needs`) and subtle reply-section branches. Clicking a button fills
  `#replyText` with that exact option string and immediately calls the existing
  `replyTask(id)` — one click, matching the Approvals dock's own no-intermediate-step
  button behavior, and requiring no new submit path: an AskUserQuestion answer flows
  through the existing continuation-append branch, a stuck answer flows through the
  existing `resolveStuck(..., "reply", "console", text)` branch, exactly as a hand-typed
  answer does today. The buttons are a faster way to fill the same box, not a new
  mechanism.
- The textarea stays visible and functional alongside the buttons — a fallback for
  anything not covered by a listed option. Both backend paths already accept arbitrary
  free text regardless of predefined options, so hiding the textarea when options exist
  would be a functional regression, not just a UI simplification.
- New CSS scoped to the reply section (`.reply-choices` row container,
  `.reply-choice-btn` button) rather than reusing `.appr-btn` — that class's `.yes`/`.no`
  color variants encode approve/deny semantics that don't generalize to arbitrary labels
  like "Implement"/"Defer"/"Skip"; a neutral bordered-pill style (matching this function's
  existing `.secondary-action` visual weight) is the correct fit here.

## Scope

- `src/lib/orchestrator/turn-types.ts` — type addition only.
- `src/lib/orchestrator/derive-output.ts` — copy `options` onto `headline` in the two
  question branches.
- `src/lib/orchestrator/agent-manager.ts` — persist `pendingOptions` into `output` at both
  exit sites where a headline with options exists.
- `src/daemon/server.ts` — attach `pendingOptions` next to the existing `pendingQuestion`
  attachment in GET `/tasks/:id`.
- `src/daemon/console.ts` — `taskActionsHtml` signature + choice-button rendering + new
  client submit helper + new scoped CSS.
- New test file `src/lib/orchestrator/derive-output.test.ts` (none exists today) covering
  the headline/options behavior directly as a pure function.
- New tests appended to `src/daemon/console.test.ts` following its existing
  extract-and-regex-assert style, alongside (not replacing) the current reply-box tests.

## Explicitly out of scope (noted for a future pass, not actioned here)

- The global Approvals dock (`renderApprovals()`, `buildApprovalQueue()`) — already
  correct for the stuck path; untouched by this fix.
- iOS / any non-console surface — this repo has no such UI; out of scope by construction.
- Using the already-computed `resultStatus` (`needs_confirmation` vs `needs_selection`)
  to visually differentiate button styling (e.g. Yes/No coloring for exactly-2-option
  confirmations) — a reasonable future refinement, not required to make choices visible
  and clickable at all, which is the reported bug.
- A combined global "all pending decisions" view that also lists AskUserQuestion tasks
  inside the Approvals dock (Option 1 above) — additive future idea, not this fix.
- **Test-strength caveat**, same as prior console.ts design docs in this repo: `console.
  test.ts` has no jsdom/live-DOM harness — its tests are static regex/substring
  assertions against the extracted script source, proving the source takes the intended
  shape (button markup present, correct onclick wiring, correct field reads), not a live
  "click and observe the DOM" test. The new tests here follow that same, already-accepted
  convention rather than introducing a new one.
