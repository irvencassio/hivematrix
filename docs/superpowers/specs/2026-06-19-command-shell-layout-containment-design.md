# Command Shell Layout Containment Design

## Context

The Commands panel in the right context column renders local profile slash commands and folder skills. The panel is constrained to the existing 320px context column, but command metadata is rendered as a row of pill chips. Short metadata, such as `import-all`, fits. Longer metadata, such as `weekly-ai-roundup` with a long skill description, can force the command shell wider than the column and push the action row out of view.

## Root Cause

The metadata row is a flex container, and each metadata chip uses `white-space: nowrap`, `overflow: hidden`, and `text-overflow: ellipsis`. That is the right visual treatment, but the flex/grid items do not consistently opt into shrinkage with `min-width: 0`. As a result, a long description chip can keep its min-content width and widen the card instead of ellipsizing inside it.

## Approaches Considered

1. Add CSS containment and shrink rules to the existing command shell.
   - Pros: Minimal, preserves the current UI, keeps long metadata available through the existing `title` tooltip, and fixes all command choices that produce long metadata.
   - Cons: The description is still a compact chip, so it remains secondary information.

2. Move command descriptions to a separate wrapped muted line below the pills.
   - Pros: More readable long descriptions.
   - Cons: Increases panel height and changes the compact command-shell design more than the current bug requires.

3. Remove long descriptions from the compact metadata row and show them only in Inspect.
   - Pros: Most compact.
   - Cons: Hides useful context until the operator clicks Inspect.

## Decision

Use approach 1. Keep the command shell design and make the layout resilient:

- The command shell and command grid must not exceed the context column width.
- Grid children inside the command shell must be allowed to shrink.
- The metadata row must allow its flex items to shrink.
- Metadata chips must ellipsize within the available row width.
- The Run and Inspect buttons must remain visible regardless of selected command metadata length.

## Components

- `src/daemon/console.ts`
  - Update command shell CSS only.
  - No command API, catalog, launch, or metadata content changes.

- `src/daemon/console.test.ts`
  - Add a regression test that asserts the command-shell CSS includes shrink/containment rules for `.command-shell`, `.command-grid`, `.command-grid > *`, `.command-meta`, and `.command-chip`.

## Testing

Use TDD:

1. Add a failing console regression test for the command-shell CSS contract.
2. Run the targeted console test and confirm it fails.
3. Add the minimal CSS containment rules.
4. Run the targeted console test and confirm it passes.
5. Run required repo gates:
   - `npm run typecheck`
   - `npm test`
   - `node scripts/scope-wall.mjs`

No local-model readiness gate is required because this change does not touch local-model code.
