import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";

/**
 * Reads a nested `<key>.desktopFallback` value out of a HiveConfig-shaped
 * object, tolerating a missing/non-object block. Mirrors the exact
 * object-shape check jobs.ts's readBrowserBeeDesktopFallbackEnabled already
 * uses for these same two keys.
 */
function readDesktopFallbackFlag(config: Record<string, unknown>, key: "browserLane" | "browserbee"): unknown {
  const block = config[key];
  if (block && typeof block === "object" && !Array.isArray(block)) {
    return (block as Record<string, unknown>).desktopFallback;
  }
  return undefined;
}

export interface AutoEnableDesktopFallbackResult {
  /** True only if this call actually wrote browserLane.desktopFallback = true. */
  enabled: boolean;
}

/**
 * Auto-enable the opt-in Browser Lane Desktop fallback (see
 * readBrowserBeeDesktopFallbackEnabled, jobs.ts) the moment the operator
 * adds their first authenticated browser site. Every browser_sites row is
 * inherently "authenticated" — authStrategy has no anonymous/public value
 * (contracts.ts) — so the caller (store.ts's upsertBrowserSite) determines
 * "first" by checking the table had zero rows immediately before the
 * insert, and calls this function only in that case.
 *
 * Never overrides an explicit operator choice: a no-op unless BOTH the
 * canonical `browserLane.desktopFallback` and legacy
 * `browserbee.desktopFallback` keys are entirely absent from config.
 * Present-but-false, present-but-true (including the canonical key already
 * being true, which would otherwise be a redundant write), and
 * present-under-the-legacy-key are all left exactly as the operator set
 * them. See DECISIONS.md's 2026-06-14 Browser Lane entry: Desktop fallback
 * is a deliberate reliability trade-off (lower-reliability local-model
 * browser driving vs. Codex Computer Use) the operator opts into — this
 * auto-enable exists to help operators who never knew the flag existed, not
 * to silently flip anyone's already-made choice.
 */
export function autoEnableDesktopFallbackOnFirstSite(): AutoEnableDesktopFallbackResult {
  const config = loadHiveConfig();
  const canonical = readDesktopFallbackFlag(config, "browserLane");
  const legacy = readDesktopFallbackFlag(config, "browserbee");
  if (canonical !== undefined || legacy !== undefined) {
    return { enabled: false };
  }

  const existingBrowserLane = config.browserLane;
  const browserLaneBlock =
    existingBrowserLane && typeof existingBrowserLane === "object" && !Array.isArray(existingBrowserLane)
      ? (existingBrowserLane as Record<string, unknown>)
      : {};

  saveHiveConfig({
    ...config,
    browserLane: { ...browserLaneBlock, desktopFallback: true },
  });
  return { enabled: true };
}
