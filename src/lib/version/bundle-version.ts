/**
 * The single runtime source of the app version.
 *
 * When packaged, the daemon is launched by the bundled Node inside
 *   /Applications/HiveMatrix.app/Contents/Resources/daemon/bin/node
 * so the app's Info.plist (CFBundleShortVersionString) is the authoritative
 * version — it's stamped from the same release bump as tauri.conf.json. In a dev
 * run (tsx, no bundle) we fall back to the compiled-in VERSION constant.
 *
 * This replaces the previously hardcoded CURRENT_VERSION in daemon-update.ts so
 * the version can never drift from what was actually shipped.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { VERSION as FALLBACK_VERSION } from "@/lib/version";
import { getAppBundleRoot } from "@/lib/onboarding/app-bundle";

/** Parse CFBundleShortVersionString out of an Info.plist XML string. */
export function parseInfoPlistVersion(plistXml: string): string | null {
  const m = plistXml.match(
    /<key>\s*CFBundleShortVersionString\s*<\/key>\s*<string>\s*([^<\s][^<]*?)\s*<\/string>/,
  );
  return m ? m[1].trim() : null;
}

/**
 * The running app's version. Reads Info.plist when bundled; falls back to the
 * compiled-in VERSION otherwise. `execPath`/`readPlist` are injectable for tests.
 */
export function getBundledVersion(
  execPath: string = process.execPath,
  readPlist: (path: string) => string = (p) => readFileSync(p, "utf-8"),
): string {
  const appRoot = getAppBundleRoot(execPath);
  if (appRoot) {
    try {
      const v = parseInfoPlistVersion(readPlist(join(appRoot, "Contents", "Info.plist")));
      if (v) return v;
    } catch {
      // fall through to the compiled-in version
    }
  }
  return FALLBACK_VERSION;
}
