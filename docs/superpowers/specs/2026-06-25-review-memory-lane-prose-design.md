# Review And Memory Lane Prose Design

## Context

HiveMatrix is moving from Bee-branded public language to lane language. The control-plane and memory-curation modules still expose compatibility symbols such as `ManagerBeeReport` and `BrainBeeStatus`, but their explanatory prose should teach the lane strategy.

## Approved Direction

Continue the lane-name migration without breaking stable code contracts. Public-facing and explanatory text should say:

- `Review Lane` for control-plane heartbeat, diagnostics, directives, and autonomy-loop reporting.
- `Memory Lane` for playbook hygiene and brain-root curation.
- `Mail Lane` and `Message Lane` when referencing channel poller patterns.

Compatibility names may remain in exported TypeScript symbols, route payload types, event names, directories, and tests that verify those contracts.

## Scope

Update prose/comments in:

- `src/lib/managerbee/report.ts`
- `src/lib/managerbee/heartbeat.ts`
- `src/lib/brainbee/curate.ts`
- `src/lib/brainbee/poller.ts`
- `src/lib/orchestrator/directive-store.ts`

Add a focused regression test that fails while the old prose remains and passes once lane prose is present.

## Non-Goals

- Do not rename exported TypeScript interfaces, functions, event names, database columns, directories, or route paths.
- Do not change runtime behavior.
- Do not attempt the broader Message/Mail/Desktop/Terminal prose cleanup in this slice.

## Verification

- Focused new test for Review/Memory Lane prose.
- `npm run typecheck`
- `npm test`
- `node scripts/scope-wall.mjs`
