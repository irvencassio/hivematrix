/**
 * Telemetry — opt-in and local-first.
 *
 * Privacy is a selling point for the local-AI buyer, so the default is OFF and
 * nothing is recorded unless `config.telemetry.enabled` is true. Events land in
 * the local `telemetry_events` table only; nothing leaves the machine without
 * an explicit "send diagnostics". recordTelemetryEvent is sync, never throws,
 * and reads connectivity/version from a context the daemon sets at boot (so it
 * stays cheap and test-safe — no heavy singletons pulled in on the hot path).
 */

import { getDb } from "@/lib/db";
import { loadHiveConfig, saveHiveConfig } from "@/lib/central/config";

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
