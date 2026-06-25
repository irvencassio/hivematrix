# Brain Scaffold Lane Copy Design

## Context

HiveMatrix now uses lane names publicly, but the canonical Hive brain scaffold still creates and teaches `Bee`-branded memory docs. That is especially risky because these docs become model-facing context through `buildBrainMemoryBundle`.

The internal option name `bee` and existing persisted ids still exist in code, but generated memory docs should use lane language.

## Goal

Move the generated Hive brain scaffold from `projects/hive/bees/*` docs to `projects/hive/lanes/*` docs and rename model-facing copy from Bee names to lane names.

Preserve a read fallback for old `bees/<id>.md` and `bees/domains/<domain>.md` files so existing user memory still works while new scaffolds and bundle section names prefer lanes.

## Acceptance Criteria

1. `ensureHiveBrainScaffold` creates lane docs under `projects/hive/lanes/`.
2. Generated memory scaffold content uses `Message Lane`, `Mail Lane`, `Manager Lane`, `Memory Lane`, `Desktop Lane`, `Terminal Lane`, and `Capability Design Lane`.
3. Generated scaffold content no longer contains visible `ManagerBee`, `BrainBee`, `TermBee`, `MessageBee`, `MailBee`, `InventorBee`, `new Bees`, or `other Bees` copy.
4. `buildBrainMemoryBundle({ bee: "managerbee" })` emits `Lane Playbook (manager)` from the new `lanes/manager.md` file.
5. Focused tests, `npm run typecheck`, `npm test`, and `node scripts/scope-wall.mjs` pass.
