// Lane App Manager — shared types.
//
// HiveMatrix updates itself automatically; the standalone lane apps (Browser
// Lane, Terminal Lane) are installed EXPLICITLY through this surface. The lane
// apps use normal generic Keychain service/account access; a prior launch
// blocker was fixed by removing a restricted Keychain access-groups entitlement.
// Do not reintroduce that entitlement.

export const LANE_APP_IDS = ["browser-lane", "terminal-lane"] as const;
export type LaneAppId = (typeof LANE_APP_IDS)[number];

export const LANE_APP_STATUSES = [
  "missing",
  "installed",
  "update_available",
  "launch_failed",
  "invalid_signature",
] as const;
export type LaneAppStatus = (typeof LANE_APP_STATUSES)[number];

export interface LaneAppVersion {
  /** CFBundleShortVersionString, e.g. "0.1.86". */
  short: string;
  /** CFBundleVersion, e.g. "2". */
  build: string;
}

export interface LaneAppDescriptor {
  id: LaneAppId;
  /** Human name and the .app bundle base name (e.g. "Browser Lane"). */
  displayName: string;
  bundleId: string;
  /** Mach-O executable name inside Contents/MacOS (e.g. "BrowserLane"). */
  executable: string;
}

export function isLaneAppId(value: unknown): value is LaneAppId {
  return typeof value === "string" && (LANE_APP_IDS as readonly string[]).includes(value);
}
