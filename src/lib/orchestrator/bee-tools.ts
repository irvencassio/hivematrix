// Compatibility facade — the lane tool loop now lives in ./lane-tools. New code
// should import the Lane* names from there directly. This module keeps the
// legacy Bee* identifiers working for older imports during the migration.

import {
  LANE_TOOL_DEFINITIONS,
  resolveLaneToolName,
  isLaneTool,
  availableLaneTools,
  executeLaneTool,
  type LaneToolContext,
} from "./lane-tools";

// Pass-through exports whose names were never Bee-branded or are channel handlers
// kept under their existing names.
export {
  capabilityRoutingGuide,
  readAttachments,
  executeMailBeeSend,
  executeMailBeeDraft,
  executeMessageBeeSend,
  type MailBeeSendIO,
  type MessageBeeSendIO,
} from "./lane-tools";

export const BEE_TOOL_DEFINITIONS = LANE_TOOL_DEFINITIONS;
export const resolveBeeToolName = resolveLaneToolName;
export const isBeeTool = isLaneTool;
export const availableBeeTools = availableLaneTools;
export const executeBeeTool = executeLaneTool;
export type BeeToolContext = LaneToolContext;
