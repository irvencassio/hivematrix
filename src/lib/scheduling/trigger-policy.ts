/**
 * Directive trigger policy types and nextRunAt computation.
 *
 * Schedule type uses ISO 8601 durations (e.g. "PT4H" = every 4 hours,
 * "P1D" = daily). Time-of-day pinning uses "dailyAt" (local 24h hour).
 */

export type TriggerType = "schedule" | "watcher" | "dependency" | "manual" | "continuous";

export interface ScheduleTrigger {
  type: "schedule";
  interval?: string;       // ISO 8601 duration, e.g. "PT4H", "P1D", "PT30M"
  dailyAt?: number;        // 0-23: run once per day at this local hour (overrides interval)
  quietHours?: QuietHoursPolicy;
}

export interface WatcherTrigger {
  type: "watcher";
  watchPath?: string;
  eventKinds?: string[];
}

export interface DependencyTrigger {
  type: "dependency";
  dependsOnDirectiveId?: string;
}

export interface ManualTrigger {
  type: "manual";
}

export interface ContinuousTrigger {
  type: "continuous";
  minIntervalMs?: number;
}

export type TriggerPolicy =
  | ScheduleTrigger
  | WatcherTrigger
  | DependencyTrigger
  | ManualTrigger
  | ContinuousTrigger;

export interface QuietHoursPolicy {
  startHour: number;  // 0-23 (local time)
  endHour: number;    // 0-23 (local time); run deferred until after endHour
  timezone?: string;  // IANA tz name (default: local)
}

// ---------------------------------------------------------------------------
// ISO 8601 duration → milliseconds
// ---------------------------------------------------------------------------

export function parseDurationMs(iso: string): number | null {
  // Matches PT<n>H, PT<n>M, PT<n>S, P<n>D, P<n>W
  const m = iso.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const weeks   = Number(m[1] ?? 0);
  const days    = Number(m[2] ?? 0);
  const hours   = Number(m[3] ?? 0);
  const minutes = Number(m[4] ?? 0);
  const seconds = Number(m[5] ?? 0);
  const ms = (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 * 1000 + seconds * 1000;
  return ms > 0 ? ms : null;
}

// ---------------------------------------------------------------------------
// nextRunAt computation
// ---------------------------------------------------------------------------

function isInQuietHours(date: Date, policy: QuietHoursPolicy): boolean {
  // Simple local-time check (timezone param is surfaced but not used in stdlib
  // without Intl.DateTimeFormat; acceptable for v1 since most users are single-mac)
  const h = date.getHours();
  const { startHour, endHour } = policy;
  if (startHour < endHour) {
    return h >= startHour && h < endHour;
  }
  // Wraps midnight (e.g. 22–06)
  return h >= startHour || h < endHour;
}

function advancePastQuietHours(date: Date, policy: QuietHoursPolicy): Date {
  if (!isInQuietHours(date, policy)) return date;
  const result = new Date(date);
  result.setHours(policy.endHour, 0, 0, 0);
  if (result <= date) {
    // endHour is earlier in the day (wrapped midnight case) — advance to tomorrow
    result.setDate(result.getDate() + 1);
  }
  return result;
}

/**
 * Compute the next run time for a schedule trigger.
 *
 * @param trigger  Schedule trigger policy
 * @param lastRunAt  ISO string of last run, or null for first-ever run
 * @param now  Current time (defaults to new Date())
 * @returns ISO string for next run, or null if not a schedule trigger
 */
export function computeNextRunAt(
  trigger: TriggerPolicy,
  lastRunAt: string | null,
  now: Date = new Date()
): string | null {
  if (trigger.type !== "schedule") return null;

  let next: Date;

  if (trigger.dailyAt !== undefined) {
    // Daily at a specific hour
    next = new Date(now);
    next.setHours(trigger.dailyAt, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
  } else if (trigger.interval) {
    const ms = parseDurationMs(trigger.interval);
    if (!ms) return null;
    const base = lastRunAt ? new Date(lastRunAt) : now;
    next = new Date(base.getTime() + ms);
    // If we've already passed the next time (e.g. missed a tick), schedule from now
    if (next < now) {
      next = new Date(now.getTime() + ms);
    }
  } else {
    return null;
  }

  if (trigger.quietHours) {
    next = advancePastQuietHours(next, trigger.quietHours);
  }

  return next.toISOString();
}

/**
 * Check whether a directive is due to run now.
 */
export function isDue(nextRunAt: string | null, now: Date = new Date()): boolean {
  if (!nextRunAt) return false;
  return new Date(nextRunAt) <= now;
}

/**
 * Parse a TriggerPolicy from a JSON string stored in the directives table.
 */
export function parseTriggerPolicy(raw: string | null | undefined): TriggerPolicy | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const type = obj.type;
    if (
      type === "schedule" ||
      type === "watcher" ||
      type === "dependency" ||
      type === "manual" ||
      type === "continuous"
    ) {
      return obj as unknown as TriggerPolicy;
    }
    return null;
  } catch {
    return null;
  }
}
