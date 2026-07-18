# Task Reply Panel Choice Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-18-task-choice-buttons-design.md` (Option 3 —
thread `options` through the existing `output` JSON blob and the existing
`pendingQuestion`-style runtime-attached row field; render buttons client-side in the
existing reply section; clicking a button submits through the existing `replyTask()`
pipeline. No schema change, no new endpoint.)

**Before starting each task below:** re-read the current source at the cited location
directly — line numbers are approximate and will drift as earlier tasks land. Do not
transcribe this plan's code samples on trust.

**Security note baked into Task 4 below, read before implementing it:** `esc()`
(`console.ts:2031`) only escapes `&`, `<`, `>` — not quotes. The existing `.appr-btn`
buttons (`renderApprovals()`) embed raw option text straight into an inline `onclick`
attribute string, which is only safe today because that vocabulary is fixed
(`approve`/`deny`/`retry`/`skip`/`abort`). The options this plan surfaces come from
LLM-authored `AskUserQuestion` labels, which can contain apostrophes (e.g. "Don't deploy
yet") — embedding that text directly into an onclick attribute the same way would be a
real JS-breakout risk. Task 4 instead dispatches by array index (always a safe plain
integer) and looks the real string up from a module-level object, never round-tripping
agent-authored text through an HTML attribute. Do not "simplify" this back to the
`.appr-btn` string-embedding pattern — that would reintroduce the risk this plan
deliberately avoids. Do not fix the pre-existing `.appr-btn` issue either — it's a latent,
separate, out-of-scope bug (today's only caller always uses the fixed
retry/skip/abort vocabulary, so it's not live); mention it in a code comment at most.

---

## Task 1 — `deriveOutput()` preserves `options` on its headline

- [ ] Create `src/lib/orchestrator/derive-output.test.ts` (new file — none exists today).
      Build minimal `Turn[]` fixtures by hand (check `turn-types.ts` for the exact `Turn`/
      `QuestionContent` shape before writing these — fields are `id, taskId, sequence,
      role, kind, label, startedAt, content, signals, signalsVersion`; an
      `ask_user_question` turn's `content` is `{ type: "question", prompt, options,
      answeredBy? }`). Add:

  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";
  import { deriveOutput } from "./derive-output";
  import type { Turn } from "./turn-types";

  function questionTurn(overrides: Partial<Turn> & { content: Partial<Turn["content"]> }): Turn {
    return {
      id: overrides.id ?? "t1",
      taskId: "task1",
      sequence: 0,
      role: "assistant",
      kind: "ask_user_question",
      label: "question",
      startedAt: new Date().toISOString(),
      signals: [],
      signalsVersion: 1,
      ...overrides,
      content: { type: "question", prompt: "Which do you want?", ...overrides.content } as Turn["content"],
    } as Turn;
  }

  test("deriveOutput copies multi-choice options onto the headline, not just the prompt text", () => {
    const turns = [questionTurn({ content: { options: ["Implement", "Defer", "Skip"] } })];
    const view = deriveOutput(turns);
    assert.equal(view.headline?.text, "Which do you want?");
    assert.deepEqual(view.headline?.options, ["Implement", "Defer", "Skip"]);
  });

  test("deriveOutput leaves headline.options undefined for a plain (no-option) question", () => {
    const turns = [questionTurn({ content: {} })];
    const view = deriveOutput(turns);
    assert.equal(view.headline?.text, "Which do you want?");
    assert.equal(view.headline?.options, undefined);
  });

  test("deriveOutput does not surface options from an already-answered question", () => {
    const turns = [questionTurn({ content: { options: ["Implement", "Defer"], answeredBy: "operator" } })];
    const view = deriveOutput(turns);
    assert.equal(view.awaiting, null);
  });
  ```

  Verify the third test's exact current behavior first (re-read `derive-output.ts`'s
  `answered` handling, lines ~57-66 and ~137-146) before trusting this assertion — it's
  documenting existing behavior, not new behavior, so confirm it already passes before
  relying on it as a regression guard.

- [ ] Run `npm test -- --test-name-pattern="deriveOutput copies multi-choice options"`.
      Confirm it **fails** (RED) — `view.headline` today only has `{turnId, text, kind}`,
      so `.options` is `undefined` even when the turn carried options.

- [ ] In `src/lib/orchestrator/turn-types.ts`, change `OutputView.headline` (~line 134):

  ```ts
  headline: { turnId: string; text: string; kind: TurnKind; options?: string[] } | null;
  ```

- [ ] In `src/lib/orchestrator/derive-output.ts`, both places that build `view.headline`
      from a question turn (~lines 147-153) currently read:

  ```ts
    if (latestQuestion?.content.type === "question") {
      view.headline = {
        turnId: latestQuestion.id,
        text: latestQuestion.content.prompt,
        kind: latestQuestion.kind,
      };
      return view;
    }
  ```

  Add the options field:

  ```ts
    if (latestQuestion?.content.type === "question") {
      view.headline = {
        turnId: latestQuestion.id,
        text: latestQuestion.content.prompt,
        kind: latestQuestion.kind,
        options: latestQuestion.content.options,
      };
      return view;
    }
  ```

  (The other headline-building branches below it — final_answer, workflow_step_end,
  latest assistant message, CLI result summary — are plain-text sources with no options
  concept; leave them unchanged. `options` stays `undefined` for all of them, which is
  exactly what Task 1's second test pins down.)

- [ ] Run the three new tests again — confirm all **pass** (GREEN).

- [ ] Run `npm run typecheck` — zero errors (confirms nothing else destructured
      `view.headline` in a way that breaks with the new optional field — it's additive,
      so this should be a no-op check, but verify rather than assume).

---

## Task 2 — persist the options as `output.pendingOptions` on task exit

- [ ] Re-read `src/lib/orchestrator/agent-manager.ts`'s exit handler fresh, specifically:
      (a) the success-path `output` construction (search for
      `transientRetries: 0, // reset on success`), and (b) the failure-path equivalent
      further down (search for the next `output: { ...accumulatedOutput, summary`-shaped
      literal after it). Confirm `view` (from `deriveOutput(turns, ...)`, built earlier in
      the same function for `summary`) is in scope at both sites — it should be, since
      both sites run after the `summary`-building block that already calls
      `deriveOutput()`, but confirm this directly rather than trusting this plan.

- [ ] At the success-path site, change:

  ```ts
        let output: Record<string, unknown> = {
          ...accumulatedOutput,
          summary,
          filesChanged: [],
          transientRetries: 0, // reset on success
        };
  ```

  to:

  ```ts
        let output: Record<string, unknown> = {
          ...accumulatedOutput,
          summary,
          filesChanged: [],
          transientRetries: 0, // reset on success
          pendingOptions: view.awaiting && view.headline?.options?.length ? view.headline.options : null,
        };
  ```

  Gating on `view.awaiting` (not just `view.headline?.options`) matters: `view.headline`
  can still carry a stale answered question's shape in edge cases the headline-priority
  fallback chain walks through — `view.awaiting` is the field `derive-output.ts` already
  uses (line ~92-115) to mean "there's a genuinely open, unanswered question right now."
  Gate on the same signal `agent-manager.ts` already gates `reviewState` on (the
  `summary.startsWith("❓ Awaiting your reply:")` check a few lines below) so
  `pendingOptions` and the `needs_input` state can never disagree about whether this task
  is actually awaiting a reply.

- [ ] Apply the equivalent change at the failure-path site (`output: { ...accumulatedOutput,
      summary }`) — add the same `pendingOptions` key, same gating expression. Confirm
      `view` is in scope there too (re-read fresh; if it turns out this branch runs
      before `view` is computed, or in a code path that never has `turns`, adjust the
      guard to `typeof view !== "undefined" && ...` or hoist the computation — re-check
      against the real code rather than assuming this plan's structure is exactly right).

- [ ] There is no existing unit test for the exit handler itself (confirmed:
      `agent-manager.test.ts` only tests already-extracted pure helpers like
      `shouldAutoArchiveSubtask`/`shouldEnterWaitingChildren`, not `handleExit` directly —
      matching that established convention, this task does not invent a new harness for
      the whole method). Confidence instead comes from: Task 1's `deriveOutput` tests
      (the data feeding this), Task 4's console tests (the data consumed downstream), and
      Task 5's end-to-end trace. Do not skip re-reading the actual current code before
      editing — this is the one step in the plan without an automated RED/GREEN guard
      rail, so get the two edits right by inspection.

- [ ] Run `npm run typecheck` — zero errors.

---

## Task 3 — attach `pendingOptions` next to `pendingQuestion` for stuck requests

- [ ] In `src/lib/orchestrator/stuck.ts`, add a small pure helper (near `getPendingStuck`,
      which already returns `StuckRequest[]`):

  ```ts
  /** Most-recent-first tiebreak for a task's pending stuck requests, or null if none. */
  export function selectLatestPendingStuck(pending: StuckRequest[]): StuckRequest | null {
    if (!pending.length) return null;
    return [...pending].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  }
  ```

  This extracts logic that's today inlined in `server.ts`'s GET `/tasks/:id` handler
  (`pending.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]`), so it becomes
  unit-testable without a filesystem or an HTTP server — matching this codebase's
  existing convention of extracting small pure helpers out of I/O-heavy code for cheap
  direct testing (see `agent-manager.test.ts`'s existing style).

  Why not test this via a real HTTP round-trip through `getPendingStuck()` instead: that
  function reads `APPROVALS_DIR`, a `const` computed from `process.env.HOME` **once, at
  first dynamic `import("@/lib/orchestrator/stuck")`** — not read fresh per call. Because
  `server.ts` only ever imports `stuck.ts` dynamically (`await import(...)`, both in the
  GET `/tasks/:id` handler and the `/tasks/:id/reply` handler — confirmed no static
  top-level import of `stuck.ts` or `agent-manager.ts` exists in `server.ts`), the first
  test *anywhere in `server.test.ts`'s run order* that ever exercises either route
  permanently fixes `APPROVALS_DIR` for every later test in that file, regardless of each
  test's own `withTempHome()` temp dir. That's an order-dependent trap not worth building
  a new test on top of — the pure-function extraction sidesteps it entirely.

- [ ] Create `src/lib/orchestrator/stuck.test.ts` (new file — none exists today):

  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";
  import { selectLatestPendingStuck } from "./stuck";
  import type { StuckRequest } from "./stuck";

  function req(overrides: Partial<StuckRequest>): StuckRequest {
    return {
      taskId: "task1", timestamp: "1000", reason: "r", lastOutput: "",
      options: ["retry", "skip", "abort"], missionId: null, source: "watchdog",
      ...overrides,
    };
  }

  test("selectLatestPendingStuck returns null when there are no pending requests", () => {
    assert.equal(selectLatestPendingStuck([]), null);
  });

  test("selectLatestPendingStuck picks the most recent by timestamp", () => {
    const older = req({ timestamp: "1000", reason: "old" });
    const newer = req({ timestamp: "2000", reason: "new" });
    assert.equal(selectLatestPendingStuck([older, newer])?.reason, "new");
    assert.equal(selectLatestPendingStuck([newer, older])?.reason, "new");
  });

  test("selectLatestPendingStuck carries the options array through unchanged", () => {
    const r = req({ timestamp: "1000", options: ["Implement", "Defer", "Skip"] });
    assert.deepEqual(selectLatestPendingStuck([r])?.options, ["Implement", "Defer", "Skip"]);
  });
  ```

- [ ] Run `npm test -- --test-name-pattern="selectLatestPendingStuck"`. Confirm it
      **fails** (RED) — the function doesn't exist yet (import error counts as a valid
      RED here, but confirm the test file itself is otherwise well-formed by checking the
      error is specifically about the missing export).

- [ ] Add the `selectLatestPendingStuck` function from above. Run the same tests again —
      confirm **pass** (GREEN).

- [ ] In `src/daemon/server.ts`, the GET `/tasks/:id` handler currently reads:

  ```ts
        if (row.reviewState === "needs_input") {
          const { getPendingStuck } = await import("@/lib/orchestrator/stuck");
          const pending = getPendingStuck().filter(r => r.taskId === taskMatch[1]);
          if (pending.length) {
            const latest = pending.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
            (row as Record<string, unknown>).pendingQuestion = latest.reason;
          }
        }
  ```

  Change to:

  ```ts
        if (row.reviewState === "needs_input") {
          const { getPendingStuck, selectLatestPendingStuck } = await import("@/lib/orchestrator/stuck");
          const pending = getPendingStuck().filter(r => r.taskId === taskMatch[1]);
          const latest = selectLatestPendingStuck(pending);
          if (latest) {
            (row as Record<string, unknown>).pendingQuestion = latest.reason;
            (row as Record<string, unknown>).pendingOptions = latest.options?.length ? latest.options : null;
          }
        }
  ```

- [ ] Run `npm run typecheck` — zero errors.

---

## Task 4 — render choice buttons in the task detail reply panel

- [ ] Re-read `src/daemon/console.ts`'s `taskActionsHtml(t)` (search for
      `function taskActionsHtml`) and its one call site inside `selectTask()` (search for
      `taskActionsHtml(t)` — the call, not the definition) fresh before editing; confirm
      the call site already has a local `out` in scope from
      `const out = t.output ? (typeof t.output==="string"?JSON.parse(t.output):t.output) : {};`
      a few lines above, the same `out` already passed to `taskProvenancePills(t, out, ...)`
      and `taskTelemetryStrip(t, out)` right next to it.

- [ ] Add a new test to `src/daemon/console.test.ts`, directly after the existing
      `"live steerable tasks do not render Reply controls"` test:

  ```ts
  // ─── Task reply panel: predefined choices render as buttons, not just a textarea (2026-07-18) ───
  // See docs/superpowers/specs/2026-07-18-task-choice-buttons-design.md and
  // docs/superpowers/plans/2026-07-18-task-choice-buttons.md, Task 4.

  test("taskActionsHtml renders a clickable button per pending choice, sourced from either the stuck-request row field or the task output, without embedding the raw label in an onclick attribute", () => {
    const js = extractScript(CONSOLE_HTML);
    const fn = fnBody(js, "taskActionsHtml");

    // Reads choices from both sources this bug traced: the stuck-path runtime-attached
    // row field, and the AskUserQuestion-path persisted output field.
    assert.match(fn, /t\.pendingOptions/, "reads the stuck-request choices off the row");
    assert.match(fn, /out\.pendingOptions/, "reads the AskUserQuestion choices off task output");

    // Renders one button per choice, keyed by index — not by embedding the raw label
    // into the onclick attribute (LLM-authored labels can contain quotes; only a plain
    // integer index and the already-safe hex t._id may appear inside the onclick string).
    assert.match(fn, /class="reply-choice-btn"/, "choice buttons use a dedicated class");
    assert.match(fn, /onclick="submitReplyChoice\(/, "choice buttons dispatch through submitReplyChoice");
    assert.doesNotMatch(
      fn,
      /submitReplyChoice\([^)]*\+\s*esc\(/,
      "must not embed the escaped label text inside the onclick attribute — index-only dispatch",
    );

    // Signature actually takes out (so it can read out.pendingOptions) and the one call
    // site passes it.
    assert.match(js, /function taskActionsHtml\(t,\s*out\)/, "signature accepts out");
    assert.match(js, /taskActionsHtml\(t,\s*out\)/, "call site passes out");
  });

  test("submitReplyChoice fills the reply textarea from the stored choice list by index and submits, never trusting attribute-embedded text", () => {
    const js = extractScript(CONSOLE_HTML);
    const fn = fnBody(js, "submitReplyChoice");
    assert.match(fn, /_replyChoices\[id\]/, "looks the real choice text up from module state, not a function argument string");
    assert.match(fn, /replyText/, "fills the existing reply textarea");
    assert.match(fn, /replyTask\(id\)/, "submits through the existing reply pipeline — no new endpoint");
  });
  ```

  Before trusting these regexes, check whether this file already has an `fnBody(js, name)`
  helper (used elsewhere, e.g. in the Tools-panel plan above) — if so reuse it as-is; if
  the exact helper name differs, adjust the test to match what's actually there.

- [ ] Run the two new tests — confirm both **fail** (RED); `taskActionsHtml` doesn't take
      an `out` param yet, `submitReplyChoice` doesn't exist, no `.reply-choice-btn` class
      is emitted anywhere.

- [ ] In `src/daemon/console.ts`, change the function signature and call site:
      `function taskActionsHtml(t) {` → `function taskActionsHtml(t, out) {`;
      `+ taskActionsHtml(t)` (in `selectTask`) → `+ taskActionsHtml(t, out)`.

- [ ] Inside `taskActionsHtml`, in the `if (!steerable) { ... }` block, currently:

  ```js
      const isOpen = t.reviewState === "needs_input";
      const q = t.pendingQuestion ? '<div class="reply-question">'+esc(t.pendingQuestion)+'</div>' : '';
      html += '<div id="replySection_'+t._id+'" class="reply-section'+(isOpen?' open needs':' subtle')+'">'
        + (isOpen
            ? '<div class="reply-head">✋ Awaiting your reply</div>'
            : '<div class="reply-subhead">↩ Reply — your message is added and the task re-runs</div>')
        + q
        + '<textarea id="replyText" class="reply-input" placeholder="'+(isOpen?'Type your reply…':'Reply to this task…')+'" rows="'+(isOpen?'7':'2')+'" oninput="onCtxDraft(\'reply\',this)"></textarea>'
  ```

  Change to (new `choices`/`choicesHtml` lines inserted before the `html +=`, and
  `choicesHtml` spliced in right after `q`):

  ```js
      const isOpen = t.reviewState === "needs_input";
      const q = t.pendingQuestion ? '<div class="reply-question">'+esc(t.pendingQuestion)+'</div>' : '';
      // Two independent sources carry predefined choices: a stuck/watchdog nudge
      // (t.pendingOptions, attached to the row) and an agent AskUserQuestion answer
      // (out.pendingOptions, persisted in task output). Not expected to both be set for
      // the same task at once — a plain precedence, not a merge, is correct here.
      const choices = (t.pendingOptions && t.pendingOptions.length) ? t.pendingOptions
        : ((out && out.pendingOptions && out.pendingOptions.length) ? out.pendingOptions : null);
      // Rendered by index, never by embedding the label in the onclick attribute —
      // esc() only escapes &<>, not quotes, and these labels are LLM-authored text that
      // can contain apostrophes. _replyChoices holds the real strings; the onclick only
      // ever carries the safe hex t._id plus a plain integer index.
      let choicesHtml = "";
      if (choices) {
        _replyChoices[t._id] = choices;
        choicesHtml = '<div class="reply-choices">' + choices.map(function (c, idx) {
          return '<button type="button" class="reply-choice-btn" onclick="submitReplyChoice(\''+t._id+'\','+idx+')">'+esc(c)+'</button>';
        }).join("") + '</div>';
      }
      html += '<div id="replySection_'+t._id+'" class="reply-section'+(isOpen?' open needs':' subtle')+'">'
        + (isOpen
            ? '<div class="reply-head">✋ Awaiting your reply</div>'
            : '<div class="reply-subhead">↩ Reply — your message is added and the task re-runs</div>')
        + q
        + choicesHtml
        + '<textarea id="replyText" class="reply-input" placeholder="'+(isOpen?'Type your reply…':'Reply to this task…')+'" rows="'+(isOpen?'7':'2')+'" oninput="onCtxDraft(\'reply\',this)"></textarea>'
  ```

  (Everything after the textarea line — `attachPickerHtml('reply')`, the action-bar,
  the closing tags — is unchanged.)

- [ ] Add the module-level state object and the click handler. Place `_replyChoices` near
      the other per-task ephemeral UI state declarations (search for `let _ctxDraft` or
      `let _ctxAttach` and add it alongside them):

  ```js
  // Per-task predefined choice lists for the reply panel, keyed by task id — set by
  // taskActionsHtml when it renders the buttons, read by submitReplyChoice on click.
  // Holding the real strings here (rather than embedding them in the onclick attribute)
  // is deliberate: see the security note in this file's Task 4 plan.
  let _replyChoices = {};
  ```

  Add `submitReplyChoice` near `replyTask` (search for `async function replyTask`):

  ```js
  function submitReplyChoice(id, idx) {
    const list = _replyChoices[id];
    const choice = list && list[idx];
    if (choice == null) return;
    const el = document.getElementById("replyText");
    if (el) el.value = choice;
    replyTask(id);
  }
  ```

- [ ] Add CSS for the new button row, directly after the existing `.reply-toggle.active`
      rule (`console.ts` ~line 733):

  ```css
    .reply-choices { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }
    .reply-choice-btn { border: 1px solid var(--border); border-radius: 6px; padding: 5px 12px;
      background: var(--panel-2); color: var(--text); font-size: 12px; cursor: pointer; }
    .reply-choice-btn:hover { border-color: var(--accent-2); color: var(--accent-2); }
  ```

  (Deliberately not reusing `.appr-btn`'s `.yes`/`.no` color variants — those encode
  approve/deny semantics baked into the Approvals dock; arbitrary labels like
  "Implement"/"Defer"/"Skip" don't map onto that binary, so a neutral style is correct.)

- [ ] Run the two new tests again — confirm both **pass** (GREEN).

- [ ] Run the full existing reply-related test block (`--test-name-pattern="[Rr]eply"`)
      and confirm all previously-passing tests **still pass** — the signature change
      (`taskActionsHtml(t)` → `taskActionsHtml(t, out)`) and the `choicesHtml` insertion
      must not disturb the `isOpen`/`subtle`/`canReply`/steerable-skip assertions from the
      existing tests (`console.test.ts` lines ~179-262 in the pre-change file).

- [ ] Run `npm run typecheck` — zero errors.

---

## Task 5 — full verification + functional trace

- [ ] Run the full gates:
      1. `npm run typecheck` — zero errors
      2. `npm test` — all tests passing (report the actual pass/fail counts — do not
         declare done on a self-report without showing the run's output)
      3. `node scripts/scope-wall.mjs` — zero violations (expected: no new persistent
         store or concept was added — `pendingOptions` rides inside the existing `output`
         JSON blob and an existing runtime-attached row field, both established patterns —
         so no DECISIONS.md entry should be required; confirm the tripwire agrees rather
         than assuming it)

- [ ] Trace the full path end to end by reading the actual code (this bug's nature —
      an operator having to look at rendered HTML/click a button — can't be fully proven
      by the static regex-style tests above; name that limitation rather than overclaiming):
      an agent calls `AskUserQuestion` with options → `turn-builder.ts`'s
      `parseAskUserQuestion` captures them onto the turn → `deriveOutput()` (Task 1) puts
      them on `view.headline.options` → `agent-manager.ts`'s exit handler (Task 2) writes
      `output.pendingOptions` → `GET /tasks/:id` returns that `output` blob as-is (no
      server-side involvement needed for this path, since `output` already round-trips
      unchanged) → console's `selectTask()` parses it into `out` → `taskActionsHtml(t,
      out)` (Task 4) reads `out.pendingOptions` and renders buttons → clicking one fills
      `#replyText` and calls the existing `replyTask()`, which POSTs to `/tasks/:id/reply`
      exactly as a hand-typed reply would. Separately: a watchdog stuck request →
      `stuck.ts` `raiseStuck` writes the request file with `options` → `GET /tasks/:id`
      (Task 3) attaches `row.pendingOptions` → same `taskActionsHtml` rendering path.
      Confirm each arrow by reading the real code, not by re-asserting this plan's claims.

- [ ] If feasible, launch the actual app (see the `run` skill/project convention for
      starting the daemon + console) and manually trigger one real `needs_input` task with
      options (e.g. a small task whose prompt asks the agent to call `AskUserQuestion`) to
      see the buttons render and confirm a click resolves the task. If not feasible in
      this environment, say so explicitly rather than claiming an unverified UI outcome.

- [ ] Do NOT release. Per the dispatching instructions, the operator releases — leave the
      branch ready for review (typecheck/tests/scope-wall all green, working tree clean or
      a clear diff) and stop there.
