# Remove "+ New task" Sidebar Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design doc: `docs/superpowers/specs/2026-07-18-remove-new-task-button-design.md` (Option 3 —
remove the sidebar button + its `syncNav()` entry, add a static hint pointing at Chat;
leave the now-UI-unreachable form/backend code in place, out of scope for this pass.)

**Before starting each task below:** re-read the current source at the cited location
directly — line numbers are approximate and will drift as earlier tasks land. Do not
transcribe this plan's code samples on trust.

---

## Task 1 — Update `console.test.ts` to expect the button gone (RED)

- [ ] In `src/daemon/console.test.ts`, update the five tests that assert the `＋ New task`
      button's presence/position, per the design doc's Scope section:

  1. `"+ New task and task creation remain after removing the shortcut"` (~line 1821):
     remove the `assert.match(CONSOLE_HTML, /＋ New task/, ...)` and
     `assert.match(CONSOLE_HTML, /showNewTaskPanel\(\)/, ...)` lines (the button is gone),
     keep the two function-existence asserts (`createTask`/`showNewTaskPanel` are still
     real functions, just unreachable from the sidebar). Rename the test to
     `"task creation functions remain after removing the sidebar shortcut"`.

  2. `"board column has Flash nav directly under New task"` (~line 1829): rename to
     `"board column's Flash nav is the first button"`. Replace the ordering assertions —
     remove `newTaskIdx`/the "Flash sits below New task" assert; keep confirming Flash nav
     is present and sits above `#taskForm`:
     ```ts
     test("board column's Flash nav is the first button", () => {
       assert.match(CONSOLE_HTML, /id="flashNav"/, "Flash nav control present");
       assert.match(CONSOLE_HTML, /id="flashNav"[^>]*onclick="showFlashPanel\(\)"/, "Flash nav opens center pane");
       const boardStart = CONSOLE_HTML.indexOf('<section class="col board">');
       const flashIdx = CONSOLE_HTML.indexOf('id="flashNav"');
       const taskFormIdx = CONSOLE_HTML.indexOf('id="taskForm"');
       assert.ok(boardStart >= 0 && flashIdx > boardStart, "Flash nav is inside the board column");
       assert.ok(taskFormIdx >= 0 && flashIdx < taskFormIdx, "Flash sits above the task form");
     });
     ```

  3. `"board column's Overview nav is gone; + New task is the first button"` (~line 1848):
     rename to `"board column's Overview nav is gone; Flash nav is the first button"` and
     change the final assertion's expected onclick from `showNewTaskPanel\(\)` to
     `showFlashPanel\(\)`.

  4. `"new task and task selection remain intact"` (~line 1881): remove the
     `assert.match(CONSOLE_HTML, /onclick="showNewTaskPanel\(\)"/, "+ New task opens the
     task form")` line; keep the `createTask`/`_closeNewTaskPanel`/`selectTask` function
     assertions (still real functions).

  5. `"primary left nav uses a single active color convention"` (~line 2928): remove
     `assert.match(CONSOLE_HTML, /id="newTaskNav"/, ...)` and the
     `assert.match(sync, /newTaskNav:\s*_taskFormInSession/, ...)` line. Keep the
     `.addbtn`/`.addbtn.active` CSS assertions (that CSS is shared, untouched), the
     `flashNav`/`rolesNav` sync assertions, and the `closeSession` assertions (all
     untouched).

  6. Add a new test confirming the hint text and button absence:
     ```ts
     test("+ New task button is removed; a hint points at Chat instead", () => {
       assert.doesNotMatch(CONSOLE_HTML, /＋ New task/, "+ New task button markup is gone");
       assert.doesNotMatch(CONSOLE_HTML, /id="newTaskNav"/, "newTaskNav id is gone");
       assert.match(CONSOLE_HTML, /Create tasks via Chat escalation/, "hint tells users where to create tasks");
       const boardStart = CONSOLE_HTML.indexOf('<section class="col board">');
       const hintIdx = CONSOLE_HTML.indexOf("Create tasks via Chat escalation");
       const flashIdx = CONSOLE_HTML.indexOf('id="flashNav"');
       assert.ok(boardStart >= 0 && hintIdx > boardStart && hintIdx < flashIdx, "hint sits at the top of the board column, where the button used to be");
     });
     ```

- [ ] Run `npm test -- console.test.ts` (or the repo's actual test invocation — check
      `package.json`) and confirm these tests now FAIL (RED) against the current,
      unmodified `console.ts` — the button is still there, so assertions like
      `doesNotMatch(CONSOLE_HTML, /＋ New task/)` should fail. This proves the tests
      actually exercise the change before touching source.

**Two-stage review after this task:** (1) spec compliance — do the renamed/updated tests
match the design doc's Scope section exactly, with no leftover assertions referencing the
removed button? (2) code quality — do new assertions follow the file's existing
extract-and-regex-assert style (see neighboring tests), no stray console.log, no
unrelated changes.

---

## Task 2 — Remove the button and its `syncNav()` entry; add the hint (GREEN)

- [ ] In `src/daemon/console.ts`, locate the board column section (currently near line
      1812) and remove the `＋ New task` button line:
      ```html
      <button class="addbtn" id="newTaskNav" onclick="showNewTaskPanel()">＋ New task</button>
      ```
      Replace it with a static hint, matching whatever muted/secondary text convention
      already exists in this stylesheet (grep for `.hint` or `.muted` class definitions
      near the top `<style>` block before inventing a new one):
      ```html
      <div class="new-task-hint">Create tasks via Chat escalation</div>
      ```
      If no existing muted-text class fits, add a minimal scoped rule next to `.addbtn`'s
      definition (currently near line 225):
      ```css
      .new-task-hint { padding: 8px 4px; font-size: 12px; color: var(--muted, #888); }
      ```
      (Check the actual CSS custom property name for muted text in this file — e.g.
      `--text-dim`/`--muted`/`--sub` — before guessing `--muted`.)

- [ ] In the same file's `syncNav()` function (currently near line 2095-2108), remove the
      `newTaskNav: _taskFormInSession,` line from the `active` map.

- [ ] Run `npm test -- console.test.ts` and confirm all tests from Task 1 now PASS (GREEN),
      and no other existing test in the file broke (full file run, not just the new/changed
      tests — other tests reference `.col.board` structure and could be sensitive to
      markup changes here).

**Two-stage review after this task:** (1) spec compliance — button and its `syncNav()`
entry gone, hint text present in the right place, `#taskForm`/`showNewTaskPanel`/
`_closeNewTaskPanel`/`createTask`/`POST /tasks`/Board all untouched per the design doc's
"Unchanged" list. (2) code quality — hint markup uses an existing CSS convention rather
than inventing a one-off color value; no leftover reference to `newTaskNav` anywhere in
the file (`grep -n newTaskNav src/daemon/console.ts` should return nothing).

---

## Task 3 — Full verification gate

- [ ] `npm run typecheck` — zero errors.
- [ ] `npm test` — all tests passing (full suite, not just `console.test.ts`).
- [ ] `node scripts/scope-wall.mjs` — zero violations.
- [ ] `grep -n newTaskNav src/daemon/console.ts` — no output (confirms full removal, not
      just the two edited spots).
- [ ] `grep -n '＋ New task' src/daemon/console.ts` — no output.

---

## Task 4 — Finish

- [ ] Stage exactly the touched files by name (`git add src/daemon/console.ts
      src/daemon/console.test.ts docs/superpowers/specs/2026-07-18-remove-new-task-button-design.md
      docs/superpowers/plans/2026-07-18-remove-new-task-button.md`) — never `git add -A`.
- [ ] Commit with a message describing the change and why (redundant entry point now that
      Chat → `escalate_to_task` exists), per AGENTS.md git hygiene: commit to the branch
      this work was started on, or a new `hive/task-<id>` branch if starting fresh. Do
      **not** merge to main and do not push unless explicitly instructed to use the
      fast-forward-only integration script — that decision belongs to the operator.
