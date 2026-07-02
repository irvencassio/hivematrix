/**
 * Telemetry — opt-in and local-first.
 *
 * Privacy is a selling point for the local-AI buyer, so the default is OFF and
 * nothing is recorded unless `config.telemetry.enabled` is true. Events land in
 * the local `telemetry_events` table only; nothing leaves the machine without
 * the operator explicitly enabling telemetry, at which point aggregate counters
 * (never raw payloads) are batched and sent to the first-party endpoint daily.
 * recordTelemetryEvent is sync, never throws, and reads connectivity/version
 * from a context the daemon sets at boot (so it stays cheap and test-safe).
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";

const TELEMETRY_PING_URL = "https://telemetry.hivematrix.app/v1/ping";

// Random UUID generated once per daemon boot — never persisted, never tied to
// a user identity. Used only to deduplicate duplicate pings within a session.
const SESSION_ID = randomUUID();

export interface TelemetryConfig {
  enabled: boolean;
}

export function getTelemetryConfig(): TelemetryConfig {
  const cfg = loadHiveConfig();
  const t = (cfg.telemetry ?? {}) as Record<string, unknown>;
  return { enabled: t.enabled === true };
}

export function isTelemetryEnabled(): boolean {
  return getTelemetryConfig().enabled;
}

export function setTelemetryEnabled(enabled: boolean): TelemetryConfig {
  const cfg = loadHiveConfig();
  const existing = (cfg.telemetry ?? {}) as Record<string, unknown>;
  cfg.telemetry = { ...existing, enabled };
  saveHiveConfig(cfg);
  return { enabled };
}

let context: { connectivity: string | null; version: string | null } = { connectivity: null, version: null };

/** Set by the daemon at boot (and on connectivity change) so events are tagged. */
export function setTelemetryContext(ctx: { connectivity?: string | null; version?: string | null }): void {
  context = {
    connectivity: ctx.connectivity ?? context.connectivity,
    version: ctx.version ?? context.version,
  };
}

export interface TelemetryEventInput {
  category: string;
  event: string;
  payload?: Record<string, unknown>;
}

/** Record one event. No-ops unless telemetry is enabled; never throws. */
export function recordTelemetryEvent(input: TelemetryEventInput): boolean {
  if (!isTelemetryEnabled()) return false;
  try {
    getDb()
      .prepare("INSERT INTO telemetry_events (category, event, payload, connectivity, version) VALUES (?, ?, ?, ?, ?)")
      .run(input.category, input.event, JSON.stringify(input.payload ?? {}), context.connectivity, context.version);
    return true;
  } catch {
    return false;
  }
}

export interface TelemetrySummary {
  enabled: boolean;
  total: number;
  byCategory: Record<string, number>;
  byEvent: Record<string, number>;
  since: string | null;
}

/** Local-first analytics: counts only, no event payloads leave this function. */
export function getTelemetrySummary(): TelemetrySummary {
  const enabled = isTelemetryEnabled();
  const rows = getDb()
    .prepare("SELECT category, event, createdAt FROM telemetry_events ORDER BY _id ASC")
    .all() as Array<{ category: string; event: string; createdAt: string }>;

  const byCategory: Record<string, number> = {};
  const byEvent: Record<string, number> = {};
  for (const r of rows) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    const key = `${r.category}.${r.event}`;
    byEvent[key] = (byEvent[key] ?? 0) + 1;
  }

  return { enabled, total: rows.length, byCategory, byEvent, since: rows[0]?.createdAt ?? null };
}

/** Privacy purge: drop every recorded event. */
export function clearTelemetry(): number {
  const info = getDb().prepare("DELETE FROM telemetry_events").run();
  return info.changes;
}

/**
 * Send aggregate counters to the first-party telemetry endpoint.
 * Only fires when telemetry is enabled. Never sends raw payloads — just
 * category.event counts, version, connectivity, and a per-boot session ID.
 * Fails silently on network error (endpoint may not be reachable yet).
 */
export async function flushTelemetryPing(): Promise<boolean> {
  if (!isTelemetryEnabled()) return false;
  try {
    const summary = getTelemetrySummary();
    const body = JSON.stringify({
      sessionId: SESSION_ID,
      version: context.version,
      connectivity: context.connectivity,
      counters: summary.byEvent,
    });
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(TELEMETRY_PING_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: ctrl.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}
