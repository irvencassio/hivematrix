# Running Task Reply Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide Reply controls from active `in_progress` task sessions so running tasks show only Cancel, Delete, and the Steer form.

**Architecture:** Keep the existing string-rendered daemon console and add a narrow render guard around Reply controls in `taskActionsHtml(t)`. Reuse the existing `steerable` boolean as the live-run signal so non-live Reply flows keep their current behavior.

**Tech Stack:** TypeScript, Node `node:test`, raw HTML/JavaScript template in `src/daemon/console.ts`.

## Global Constraints

- Do not run a build command for this request.
- Treat `status === "in_progress"` as the active running state because it is the state that renders Steer.
- Preserve `needs_input`, failed, review, and cancelled Reply behavior when the task is not steerable.
- No local-model readiness gate is required because this change does not touch local-model paths.

---

## File Structure

- Modify `src/daemon/console.test.ts`: add regression coverage to the existing console script string tests.
- Modify `src/daemon/console.ts`: guard Reply button and Reply section rendering behind `!steerable`.

### Task 1: Hide Reply During Live Steerable Runs

**Files:**
- Modify: `src/daemon/console.test.ts`
- Modify: `src/daemon/console.ts`

**Interfaces:**
- Consumes: `CONSOLE_HTML` from `src/daemon/console.ts`; `extractScript(html)` helper in `src/daemon/console.test.ts`.
- Produces: `taskActionsHtml(t)` behavior where `steerable` tasks render Steer but not Reply controls.

- [x] **Step 1: Write the failing test**

In `src/daemon/console.test.ts`, update the existing review/failed Reply expectation and add this test after it:

```ts
test("review/failed tasks get a subtle Reply box, distinct from the needs_input standout", () => {
  const js = extractScript(CONSOLE_HTML);
  // Reply is offered on review/failed/cancelled (retryable) tasks, not just needs_input,
  // but live steerable runs use the Steer form instead.
  assert.match(js, /const canReply = !steerable && t\.reviewState !== "needs_input" && \(t\.pendingQuestion \|\| retryable\)/);
  assert.match(js, /if \(canReply\) b\.push/);
  // Two visual treatments: the standout "needs" card vs the subtle box.
  assert.match(js, /' open needs':' subtle'/);
  assert.match(js, /reply-subhead/);
  assert.match(CONSOLE_HTML, /\.reply-section\.subtle\.open/, "subtle reply style present");
  // Distinct from the needs_input standout header.
  assert.match(js, /✋ Awaiting your reply/);
});

test("live steerable tasks do not render Reply controls", () => {
  const js = extractScript(CONSOLE_HTML);
  assert.match(js, /const steerable = t\.status === "in_progress"/);
  assert.match(js, /if \(steerable\) \{[\s\S]*submitSteer/, "steer form remains available");
  assert.match(js, /if \(!steerable\) \{\s*const isOpen = t\.reviewState === "needs_input"/, "Reply section is skipped for live steerable runs");
  assert.match(js, /const canReply = !steerable &&/, "Reply toggle is skipped for live steerable runs");
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts
```

Expected: FAIL because `canReply` is not gated by `!steerable` and the Reply section is rendered unconditionally.

- [x] **Step 3: Write minimal implementation**

In `src/daemon/console.ts`, update `taskActionsHtml(t)` to:

```js
  // Reply: answer the agent / continue a finished task (review, failed, cancelled)
  // — except needs_input, which already shows the fully-standout reply card.
  const canReply = !steerable && t.reviewState !== "needs_input" && (t.pendingQuestion || retryable);
  if (canReply) b.push('<button class="reply-toggle" id="replyToggle_'+t._id+'" onclick="toggleReply(\''+t._id+'\')">↩ Reply</button>');
```

Then wrap the Reply section block:

```js
  // Reply box. needs_input → the fully-standout card (auto-open). Otherwise a
  // subtler "reply to continue" box (toggled open from the ↩ Reply button).
  if (!steerable) {
    const isOpen = t.reviewState === "needs_input";
    const q = t.pendingQuestion ? '<div class="reply-question">'+esc(t.pendingQuestion)+'</div>' : '';
    html += '<div id="replySection_'+t._id+'" class="reply-section'+(isOpen?' open needs':' subtle')+'">'
      + (isOpen
          ? '<div class="reply-head">✋ Awaiting your reply</div>'
          : '<div class="reply-subhead">↩ Reply — your message is added and the task re-runs</div>')
      + q
      + '<textarea id="replyText" class="reply-input" placeholder="'+(isOpen?'Type your reply…':'Reply to this task…')+'" rows="'+(isOpen?'3':'2')+'" oninput="onCtxDraft(\'reply\',this)"></textarea>'
      + attachPickerHtml('reply')
      + '<div class="reply-row" style="margin-top:6px"><button class="reply-primary" onclick="replyTask(\''+t._id+'\')">Reply</button></div></div>';
  }
```

- [x] **Step 4: Run targeted test to verify it passes**

Run:

```bash
node --import tsx/esm --test src/daemon/console.test.ts
```

Expected: PASS.

- [x] **Step 5: Run required verification without building**

Run:

```bash
npm run typecheck
npm test
node scripts/scope-wall.mjs
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit and push main**

Run:

```bash
git status --short
git add docs/superpowers/specs/2026-06-19-running-task-reply-suppression-design.md docs/superpowers/plans/2026-06-19-running-task-reply-suppression.md src/daemon/console.test.ts src/daemon/console.ts
git commit -m "fix(console): hide reply while steering live tasks"
git push origin main
```
