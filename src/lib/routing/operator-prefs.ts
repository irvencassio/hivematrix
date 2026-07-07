/**
 * Operator routing preferences — the router learns from what you actually do.
 *
 * The bandit learns routing from telemetry (first-pass, cost). This learns it from
 * a stronger, explicit signal: when you RE-ROUTE a task (change its model after the
 * fact), that's a revealed preference for that class of task. Once you've re-routed
 * a class to the same model consistently, the router adopts it as that class's
 * default — so you stop having to re-route the same kind of task over and over.
 *
 * Deliberately conservative: it only overrides the GLOBAL default, never an explicit
 * per-task pick, and only after a stable streak. Stored locally in a small JSON,
 * keyed by task class (the task's `source`). Best-effort; never throws.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Re-routes of the same class→model in a row before the router adopts it. */
export const DEFAULT_PREF_THRESHOLD = 3;
/** How many recent picks to keep per class (a later change of mind wins). */
const RECENT_CAP = 6;

/** class → recent model picks (newest last). */
export type RoutePrefLedger = Record<string, string[]>;

/**
 * Pure: the learned route for a class, or null. Returns a model only when the last
 * `threshold` picks all agree — a stable revealed preference, not one-off noise.
 */
export function learnedRoute(recent: string[] | undefined, threshold = DEFAULT_PREF_THRESHOLD): string | null {
  if (!recent || recent.length < threshold) return null;
  const tail = recent.slice(-threshold);
  return tail.every((m) => m === tail[0]) ? tail[0] : null;
}

/** Pure: fold one re-route pick into a class's recent list (capped). */
export function applyPick(recent: string[] | undefined, model: string): string[] {
  return [...(recent ?? []), model].slice(-RECENT_CAP);
}

// --- Store ------------------------------------------------------------------

function ledgerPath(): string {
  const dir = join(homedir(), ".hivematrix");
  mkdirSync(dir, { recursive: true });
  return join(dir, "route-prefs.json");
}

export function readRoutePrefs(): RoutePrefLedger {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(), "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as RoutePrefLedger) : {};
  } catch {
    return {};
  }
}

function writeRoutePrefs(ledger: RoutePrefLedger): void {
  try {
    writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2));
  } catch { /* best-effort — a preference is an optimization, never a dependency */ }
}

/** Record one operator re-route: class (task source) → the model they moved it to. */
export function recordRoutePreference(taskClass: string, model: string): void {
  if (!taskClass || !model) return;
  try {
    const ledger = readRoutePrefs();
    ledger[taskClass] = applyPick(ledger[taskClass], model);
    writeRoutePrefs(ledger);
  } catch { /* best-effort */ }
}

/** The learned route for a class, or null when there's no stable preference yet. */
export function getLearnedRoute(taskClass: string | null | undefined): string | null {
  if (!taskClass) return null;
  return learnedRoute(readRoutePrefs()[taskClass]);
}

/** All learned preferences (for the routing advisory / observability surface). */
export function getLearnedRoutes(): Array<{ taskClass: string; model: string }> {
  const ledger = readRoutePrefs();
  const out: Array<{ taskClass: string; model: string }> = [];
  for (const [taskClass, recent] of Object.entries(ledger)) {
    const model = learnedRoute(recent);
    if (model) out.push({ taskClass, model });
  }
  return out;
}
