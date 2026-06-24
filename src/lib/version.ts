/**
 * HiveMatrix version metadata, surfaced in Settings.
 * Bump BUILD_NUMBER + BUILD_DATE when cutting a build.
 */
export const VERSION = "0.1.83";
export const BUILD_NUMBER = 635;
export const BUILD_DATE = "2026-06-18";

export interface VersionInfo {
  version: string;
  build: number;
  date: string;
}

export function versionInfo(): VersionInfo {
  return { version: VERSION, build: BUILD_NUMBER, date: BUILD_DATE };
}
