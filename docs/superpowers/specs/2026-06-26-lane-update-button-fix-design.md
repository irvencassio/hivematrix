# Lane "Update" button — dead route + visibility fix — Design

> Date: 2026-06-26
> Status: Approved (operator-reported bug)

## Problem

On Settings → Lanes, the Terminal Lane card showed "Update available" with a
primary **Update** button. Clicking it did nothing, and the button was less
visible than the secondary buttons.

Two root causes:

1. **Dead route.** `renderLaneSetup` builds the primary action from
   `nextAction.action`. For an outdated lane that action is `"update"`, and
   `laneActionCall` maps it to `laneAppAction(id, "update")` → `POST
   /lane-apps/<id>/update`. **There is no `/update` route** (only `/install`,
   which installs/updates from the bundled artifact), so the request fails
   silently. (`repair` and `run_readiness` are mapped to their handlers; `open` →
   `launch`; but `update` was never mapped.)

2. **Unstyled primary.** The primary button uses `class="create"`, but `.create`
   is only styled inside a form (`.form button.create`). The lane card isn't a
   form, so the button falls back to the bare default — *less* prominent than the
   styled `.copybtn` secondaries. The operator asked for clear coloring when an
   update is involved.

## Decisions

1. **Map `update` → the install endpoint.** In `laneActionCall`, treat `"update"`
   like `"install"` (both call `laneAppAction(id, "install")` → `POST
   /lane-apps/<id>/install`, which copies the freshly bundled app over the user
   copy). No server change needed; `/install` already installs *or* updates.

2. **Prominent, colored primary button.** Add a globally-scoped `.lane-primary`
   button style (filled accent) plus a `.lane-primary.update` variant in the
   **warning/amber** color for action-needed states. The card's primary button
   uses `.lane-primary` always, and adds the `update` modifier when the action is
   `install` / `update` / `repair` (i.e. "an update/repair is involved"). The
   "Update Lane Apps" banner button gets the same `.lane-primary update` style.

## Non-goals

No server route changes; no change to Browser/Terminal Lane behavior; the other
`.create` buttons elsewhere keep their current styling (we add a *new* class
rather than redefining `.create`).

## Tests (TDD)

- `laneActionCall(id, "update")` resolves to `laneAppAction('<id>','install')`
  (not a dead `update` action); `repair`/`run_readiness`/`open` mappings unchanged.
- The card primary button uses `lane-primary`, and the `update` color modifier is
  applied for update/install/repair actions; CSS defines `.lane-primary` and
  `.lane-primary.update`.
- The banner "Update Lane Apps" button is prominent (`lane-primary`).

## Gates

`npm run typecheck`, `npm test`, `node scripts/scope-wall.mjs`.
