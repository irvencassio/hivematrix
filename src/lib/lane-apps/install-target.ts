import type { LaneAppDescriptor } from "./contracts";

// User-writable install location: no admin, no sudo, never races a running
// /Applications copy.
export const LANE_APPS_DIR_NAME = "HiveMatrix Lanes";

export interface InstallTargetDeps {
  /** Absolute home directory. */
  home: string;
  /** Predicate: does this bundle path exist on disk? Injected for tests. */
  exists: (path: string) => boolean;
}

export interface InstallTarget {
  /** Where install writes (always the user-writable path in MVP). */
  preferredPath: string;
  /** ~/Applications/HiveMatrix Lanes/<App>.app */
  userPath: string;
  /** /Applications/<App>.app — detected, but not an MVP install target. */
  applicationsPath: string;
  /** The bundle macOS would launch by id: /Applications copy if present, else the user copy. */
  activePath: string | null;
  /** Every detected copy. */
  installedPaths: string[];
  /** True when the app exists in BOTH locations (operator should resolve). */
  duplicated: boolean;
}

export function resolveInstallTarget(descriptor: LaneAppDescriptor, deps: InstallTargetDeps): InstallTarget {
  const bundleName = `${descriptor.displayName}.app`;
  const userPath = `${deps.home}/Applications/${LANE_APPS_DIR_NAME}/${bundleName}`;
  const applicationsPath = `/Applications/${bundleName}`;

  const appsPresent = deps.exists(applicationsPath);
  const userPresent = deps.exists(userPath);
  const installedPaths: string[] = [];
  if (appsPresent) installedPaths.push(applicationsPath);
  if (userPresent) installedPaths.push(userPath);

  // /Applications wins as "active" because LaunchServices resolves a bundle id
  // to the /Applications copy when both exist.
  const activePath = appsPresent ? applicationsPath : userPresent ? userPath : null;

  return {
    preferredPath: userPath,
    userPath,
    applicationsPath,
    activePath,
    installedPaths,
    duplicated: appsPresent && userPresent,
  };
}
