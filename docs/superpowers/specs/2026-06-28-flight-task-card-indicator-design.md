# Flight Task Card Indicator Design

## Problem

Board review cards can show `ready_for_review` without revealing that the task is linked to a Flight item. When a linked Flight item is in `review`, the task is not just another review card: it can be the visible blocker that prevents the Flight from landing its next count. Operators currently have to open the Flight detail or infer the relationship from task content.

## Goals

- Show Flight context directly on board task cards when a task is linked to a `work_package_items.createdTaskId`.
- Make review blockers understandable without opening the task.
- Include the Flight title or short label, item status, and landed count.
- Keep non-Flight cards visually unchanged.
- Avoid duplicating Flight lookup logic in browser JavaScript.

## Proposed Design

The daemon enriches `/tasks` rows with a lightweight `flightContext` object for tasks that are linked to a Flight item:

```ts
{
  packageId: string;
  packageTitle: string;
  itemId: string;
  itemStatus: string;
  landedCount: number;
  totalCount: number;
}
```

The lookup joins `tasks._id` to `work_package_items.createdTaskId`, then joins the owning `work_packages` row. Counts are computed per package from item statuses. `done` items count as landed, matching the existing Flight progress UI; intentionally skipped scope remains a Flight-detail concept rather than being folded into the board chip. The payload stays read-only and secret-free: titles already pass through the work-package store redaction path, and no prompts or task output are exposed.

The console board renderer adds a compact meta line for `t.flightContext`:

```text
Blocks Flight · <truncated Flight title> · item review · 5/6 landed
```

The copy uses `Blocks Flight` when the Flight item status is `review`; otherwise it uses `Flight` so active or done Flight-linked tasks remain contextual without overstating a blocker.

## Alternatives Considered

1. **Client fetches `/work-packages` and joins locally.** Rejected because the board refresh would need an extra request and duplicate count/status logic in browser JavaScript.
2. **Only render for review-lane tasks.** Rejected because the relationship is useful for active Flight-linked tasks too, and the acceptance only requires review-lane visibility. The chip remains conditional on Flight linkage, so non-Flight cards are unchanged.
3. **Put the indicator only in task detail.** Rejected because the problem is discoverability at the board lane level.

## Acceptance Criteria

- `/tasks` returns `flightContext` for tasks linked through `work_package_items.createdTaskId`.
- Review cards linked to Flight items render a board-level Flight indicator with title/label, item status, and landed count.
- Non-Flight cards render without the Flight indicator.
- Focused tests cover payload shaping and console board rendering.
- Required gates pass: `npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
