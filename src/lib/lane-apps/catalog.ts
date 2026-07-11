import type { LaneAppDescriptor, LaneAppId } from "./contracts";

// The standalone lane app(s) HiveMatrix knows how to install/verify. Bundle
// ids and executable names verified against the shipped bundles on 2026-06-26.
//
// These apps use normal generic Keychain access only — no restricted Keychain
// access-groups entitlement (removing it fixed a prior launch blocker; do not
// reintroduce it).
export const LANE_APPS: LaneAppDescriptor[] = [
  {
    id: "browser-lane",
    displayName: "Browser Lane",
    bundleId: "com.irvcassio.hivematrix.browserlane",
    executable: "BrowserLane",
  },
];

export function getLaneApp(id: LaneAppId): LaneAppDescriptor {
  const app = LANE_APPS.find((a) => a.id === id);
  if (!app) throw new Error(`Unknown lane app: ${id}`);
  return app;
}
