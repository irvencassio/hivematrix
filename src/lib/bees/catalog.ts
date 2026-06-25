// Compatibility facade — the capability catalog now lives in @/lib/lanes/catalog.
// New code should import the Lane* names directly from there. This module keeps
// the legacy Bee* identifiers working for older imports during the migration.

import {
  type LaneRole,
  type LaneDefinition,
  listLaneDefinitions,
  getLaneDefinition,
} from "@/lib/lanes/catalog";

export {
  FIRST_WORKER_SET,
  CAPABILITY_SUBSTRATE_SET,
  HIGHER_RISK_SURFACE_SET,
} from "@/lib/lanes/catalog";

export type BeeRole = LaneRole;
export type BeeDefinition = LaneDefinition;

export const listBeeDefinitions = listLaneDefinitions;
export const getBeeDefinition = getLaneDefinition;
