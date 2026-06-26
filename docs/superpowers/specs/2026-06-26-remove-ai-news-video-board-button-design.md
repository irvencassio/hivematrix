# Remove the hardcoded "AI-news video" board button — Design

> Date: 2026-06-26
> Status: Approved (recommendation pre-approved; code inspection confirms safe removal)

## Problem

The board column renders a hardcoded `🎬 AI-news video` button next to
`＋ New task`:

```html
<button class="addbtn" onclick="draftVideoNow()" title="Draft today's AI-news
  video script and pause for your review">🎬 AI-news video</button>
```

A one-off, bespoke shortcut on the primary task UI makes HiveMatrix feel
demo-like and inconsistent with its intent as a *general* autonomous solo-founder
operator. Repeatable/canned actions should live in a future Command Library /
Workflows surface, not as ad-hoc board buttons.

## Code inspection

- `draftVideoNow()` is referenced in exactly two places: the board button
  (`console.ts:1012`) and its own definition (`console.ts:3751`). Removing the
  button makes the function fully unused → remove it too.
- The AI-news video *capability* does not depend on the button. Free-form task
  creation and voice both route through `src/lib/video/news-intent.ts`
  (`isAiNewsVideoRequest()` matches "create an AI news video", "make an AI-news
  video", "generate a news video for me", etc.) into the news-review flow
  (`news-review.ts`, `review.ts`, `voice-turn.ts`, and the `/video/news/draft`
  server endpoint). None of that is touched.
- The center Overview hint already says only "…or ＋ New task to start one." — it
  references universal task creation, not the shortcut, so no copy change needed.
- No "Bee" naming is involved.

## Decision

1. Remove the `🎬 AI-news video` board button from `section.col.board`.
2. Remove the now-unused `draftVideoNow()` function (and its comment).
3. Leave all video workflow/backend code, the HeyGen portal flow, review gates,
   intent detection, and their tests untouched. The capability remains reachable
   via task creation and voice intent.

## Preserved capability (manual verification path)

- Task: `＋ New task` → "create an AI news video" → `isAiNewsVideoRequest()` true
  → routed to the news-video review draft (same path the button used).
- Voice: "make an AI-news video" → `voice-turn.ts` → same flow.

## Future-facing: Repeatable Commands / Command Library (spec note, not built here)

Canned actions like "AI-news video" should eventually live in a dedicated
**Command Library** surface backed by *registered workflows*, not board buttons.
That surface (a later slice — **not** implemented now, since no generic
workflow/command UI exists on the board to safely host it) would list, per entry:

- **command name**
- **description**
- **required inputs** (typed; validated before run)
- **approval policy** (auto / review-required / blocked — reuse the COO gate)
- **runbook / workflow id** (links the canonical runbook + registered workflow)
- **last run status** (with timestamp)
- an explicit **Run** button (no silent execution)

It would draw from the existing Workflows registry (Settings → Lanes →
Workflows) rather than inventing a parallel catalog, and route runs through COO
dispatch so approval/readiness gates still apply. This keeps repeatable actions
discoverable and governed without special-casing the primary task board.

## Out of scope

- No new macro/command UI in this slice (no safe generic host exists yet).
- No changes to video lib, HeyGen portal, review gates, or video intent tests.

## Tests (TDD, console source-level)

1. The board no longer renders "AI-news video" and no longer wires `draftVideoNow`.
2. `＋ New task` remains (`toggleForm('taskForm')`, `＋ New task`).
3. No hardcoded board shortcut calls `draftVideoNow()` (function gone from script).
4. Existing AI-news/video intent tests still pass (`news-intent.test.ts`).
5. Existing HeyGen portal workflow tests still pass (`npm run verify:portal`).
6. No "Bee" naming regressions (`scope-wall` + existing console name tests).

## Gates

- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
- `npm run verify:portal`
