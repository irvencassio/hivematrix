// Compatibility facade — the lane service manager now lives in
// @/lib/lanes/service-manager. New code should import the Lane*/laneWorker*
// names from there directly. This module keeps the legacy Bee* identifiers
// working for older imports during the migration.

import {
  type LaneRuntimeMode,
  type LaneLaunchAgentSettings,
  type LaneHealthSnapshot,
  type LaneWorkerStatus,
  resolveLaneLaunchAgentSettings,
  updateLaneLaunchAgentSettings,
  getLaneWorkerRuntimeDescriptor,
  listLaneWorkerStatuses,
  setLaneWorkerAutoStart,
  ensureLaneWorkerLoaded,
  restartLaneWorkerService,
  laneWorkerExists,
} from "@/lib/lanes/service-manager";

// Pass-through exports that were never Bee-branded.
export {
  buildLaunchAgentPlist,
  resolveNodeBin,
  summarizeEmbeddedHealthDetail,
  embeddedHealthRoute,
} from "@/lib/lanes/service-manager";

export type BeeRuntimeMode = LaneRuntimeMode;
export type BeeLaunchAgentSettings = LaneLaunchAgentSettings;
export type BeeHealthSnapshot = LaneHealthSnapshot;
export type BeeServiceStatus = LaneWorkerStatus;

export const resolveBeeLaunchAgentSettings = resolveLaneLaunchAgentSettings;
export const updateBeeLaunchAgentSettings = updateLaneLaunchAgentSettings;
export const getBeeRuntimeDescriptor = getLaneWorkerRuntimeDescriptor;
export const listBeeServiceStatuses = listLaneWorkerStatuses;
export const setBeeAutoStart = setLaneWorkerAutoStart;
export const ensureBeeServiceLoaded = ensureLaneWorkerLoaded;
export const restartBeeService = restartLaneWorkerService;
export const beeServiceExists = laneWorkerExists;
