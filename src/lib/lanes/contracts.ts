import { ContractValidationError } from "@/lib/central/contracts";

export const LANE_IDS = ["browser", "desktop", "mail", "message", "memory", "review"] as const;
export type LaneId = (typeof LANE_IDS)[number];

const LANE_DISPLAY_NAMES: Record<LaneId, string> = {
  browser: "Browser Lane",
  desktop: "Desktop Lane",
  mail: "Mail Lane",
  message: "Message Lane",
  memory: "Memory Lane",
  review: "Review Lane",
};

// Worker kind -> canonical lane. The keys here MUST cover every worker kind in
// lanes/catalog.ts: normalizeLaneId() THROWS on anything it cannot resolve, and
// it is called on stored records (workflows/registry.ts, coo/routing-rules.ts).
// "brainbee" was missing — the map said "brain" while the catalog kind is
// "brainbee" — so normalizing Memory Lane's own worker kind threw "Unknown
// lane: brainbee". contracts.test.ts now asserts this map covers the catalog.
const LEGACY_CAPABILITY_TO_LANE: Record<string, LaneId> = {
  browserbee: "browser",
  webbee: "browser",
  desktopbee: "desktop",
  mailbee: "mail",
  messagebee: "message",
  brainbee: "memory",
  /** Older persisted records used the bare "brain" token. */
  brain: "memory",
  authbee: "browser",
  /** @deprecated Review Lane emits "review" directly; kept for old records. */
  managerbee: "review",
};

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+lane$/, "").replace(/\s+/g, "-");
}

export function isLaneId(value: string): value is LaneId {
  return (LANE_IDS as readonly string[]).includes(value);
}

export function normalizeLaneId(value: unknown): LaneId {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContractValidationError("lane is required");
  }
  const normalized = normalizeToken(value);
  const legacy = LEGACY_CAPABILITY_TO_LANE[normalized];
  if (legacy) return legacy;
  if (isLaneId(normalized)) return normalized;
  throw new ContractValidationError(`Unknown lane: ${value}`);
}

export function laneDisplayName(lane: LaneId): string {
  return LANE_DISPLAY_NAMES[lane];
}

export function legacyCapabilityToLane(capability: string): LaneId | null {
  return LEGACY_CAPABILITY_TO_LANE[normalizeToken(capability)] ?? null;
}

export function normalizeLaneDisplayName(value: unknown): string {
  return laneDisplayName(normalizeLaneId(value));
}
